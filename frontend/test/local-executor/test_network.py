"""验证执行端监听配置与 Host 白名单，测试连接仅使用回环网络。"""
import contextlib
import http.client
import io
import json
import socket
import tempfile
import threading
import unittest
from test_executor import module, ORIGIN


@contextlib.contextmanager
def executor_server(address='127.0.0.1', public_url='', token=''):
    with tempfile.TemporaryDirectory() as directory:
        executor = module.Executor(ORIGIN, directory, log_stream=io.StringIO(), token=token)
        server = module.Server(executor, 0, address, public_url)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield executor, server
        finally:
            executor.close()
            server.shutdown()
            server.server_close()
            thread.join()


def request(executor, server, host=None, address=None, origin=ORIGIN, token=None):
    client = http.client.HTTPConnection(address or server.server_address[0], server.server_port, timeout=5)
    headers = {'Origin': origin, 'Authorization': 'Bearer ' + (executor.token if token is None else token)}
    if host is not None:
        headers['Host'] = host
    client.request('GET', '/v1/info', headers=headers)
    response = client.getresponse()
    status = response.status
    response.read()
    client.close()
    return status


class ExecutorNetworkTest(unittest.TestCase):
    def test_默认绑定仅为本机且拒绝任意Host(self):
        with executor_server() as (executor, server):
            self.assertEqual(server.server_address[0], '127.0.0.1')
            self.assertEqual(request(executor, server), 200)
            self.assertEqual(request(executor, server, host='evil.example'), 403)

    def test_显式IP绑定与代理访问入口均保持来源和凭据验证(self):
        with executor_server('127.0.0.2', 'https://executor.example') as (executor, server):
            self.assertEqual(server.server_address[0], '127.0.0.2')
            self.assertEqual(server.connection_url, 'https://executor.example')
            self.assertEqual(request(executor, server), 200)
            self.assertEqual(request(executor, server, host='executor.example'), 200)
            self.assertEqual(request(executor, server, host='executor.example:443'), 200)
            self.assertEqual(request(executor, server, host='executor.example:444'), 403)
            self.assertEqual(request(executor, server, host='evil.example'), 403)
            self.assertEqual(request(executor, server, host='executor.example', origin='https://evil.example'), 403)
            self.assertEqual(request(executor, server, host='executor.example', token='wrong'), 401)

    def test_通配监听必须配置访问地址且只接受该Host(self):
        with tempfile.TemporaryDirectory() as directory:
            executor = module.Executor(ORIGIN, directory)
            with self.assertRaises(ValueError):
                module.Server(executor, 0, '0.0.0.0')
        with executor_server('0.0.0.0', 'http://executor.example:8321') as (executor, server):
            self.assertEqual(request(executor, server, host='executor.example:8321', address='127.0.0.1'), 200)
            self.assertEqual(request(executor, server, host='evil.example', address='127.0.0.1'), 403)

    @unittest.skipUnless(socket.has_ipv6, '系统未提供 IPv6')
    def test_IPv6回环监听与带括号Host(self):
        try:
            with executor_server('::1') as (executor, server):
                self.assertTrue(server.connection_url.startswith('http://[::1]:'))
                self.assertEqual(request(executor, server), 200)
        except OSError as error:
            self.skipTest('当前环境未启用 IPv6 回环：' + str(error))

    def test_拒绝带凭据路径或通配主机的访问入口(self):
        for value in ['https://user:password@host', 'https://host/path', 'https://host?token=x', 'file:///tmp/a', 'http://0.0.0.0:80', 'http://[::]:80', 'http://host:0']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.validate_public_url(value)


class ExecutorCustomTokenTest(unittest.TestCase):
    def test_custom_token_authentication(self):
        """指定凭据原样用于鉴权，错误凭据和空凭据不能退回已保存值。"""
        token = 'Executor_test-token_' + 'A' * 16
        with executor_server(token=token) as (executor, server):
            self.assertEqual(executor.token, token)
            self.assertEqual(request(executor, server, token=token), 200)
            self.assertEqual(request(executor, server, token='wrong-token-' + 'B' * 24), 401)
            self.assertEqual(request(executor, server, token=token.lower()), 401)
            self.assertEqual(request(executor, server, token=''), 401)
            self.assertNotIn(token, json.dumps(executor.info()))

    def test_custom_tokens_accept_arbitrary_lengths(self):
        """任意长度非空凭据均原样鉴权，覆盖单字符、短值、长值和连字符开头。"""
        for token in ('x', 'short', '-', '-short', 'A' * 129, 'B' * 1024):
            with self.subTest(length=len(token)), executor_server(token=token) as (executor, server):
                self.assertEqual(executor.token, token)
                self.assertEqual(request(executor, server, token=token), 200)

    def test_empty_token_still_generates_random_credentials(self):
        """未填写凭据时仍生成独立随机值，并能用于实际 HTTP 鉴权。"""
        with executor_server(token='') as (first, server):
            self.assertRegex(first.token, r'^[A-Za-z0-9_-]+$')
            self.assertEqual(request(first, server, token=first.token), 200)
            first_token = first.token
        with executor_server(token='') as (second, server):
            self.assertRegex(second.token, r'^[A-Za-z0-9_-]+$')
            self.assertNotEqual(first_token, second.token)
            self.assertEqual(request(second, server, token=second.token), 200)

    def test_invalid_custom_token_is_rejected(self):
        """非法字符和尾部换行必须报错，不能修剪后接受或静默改成随机值。"""
        valid = 'test-token'
        invalid = [' ', valid + '\n', valid + '\r\n',
                   '\n' + valid, valid + '\t', valid + ' ', valid + '/', valid + '+',
                   valid + '=', valid + ':', valid + '中', valid + '\x00']
        with tempfile.TemporaryDirectory() as directory:
            for index, token in enumerate(invalid):
                with self.subTest(case=index), self.assertRaises(ValueError):
                    module.Executor(ORIGIN, directory, log_stream=io.StringIO(), token=token)
