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
def executor_server(address='127.0.0.1', public_url=''):
    with tempfile.TemporaryDirectory() as directory:
        executor = module.Executor(ORIGIN, directory, log_stream=io.StringIO())
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
    headers = {'Origin': origin, 'Authorization': 'Bearer ' + (token or executor.token)}
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
