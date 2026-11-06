"""使用已有 PowerShell 验证降级端；未配置运行环境时跳过，不自动安装。"""
import http.client
import json
import os
from pathlib import Path
import queue
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest

POWERSHELL = os.environ.get('EXECUTOR_TEST_POWERSHELL') or shutil.which('powershell') or shutil.which('pwsh')
SOURCE = Path(__file__).resolve().parents[2] / 'public/local-executor/v1/executor.ps1'
ORIGIN = 'https://tools.example.test'


@unittest.skipUnless(POWERSHELL, '未找到 PowerShell，可通过 EXECUTOR_TEST_POWERSHELL 指定已有运行环境')
class PowerShellApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='executor-powershell-test-')
        # 用显式回环 IP 和模拟 HTTPS 入口验证代理部署，不需要暴露测试端口到外网。
        with socket.socket() as probe:
            probe.bind(('127.0.0.2', 0))
            cls.bind_port = probe.getsockname()[1]
        cls.process = subprocess.Popen([POWERSHELL, '-NoLogo', '-NoProfile', '-File', str(SOURCE), '-Origin', ORIGIN,
                                        '-Cwd', cls.directory.name, '-ListenAddress', '127.0.0.2', '-Port', str(cls.bind_port),
                                        '-PublicUrl', 'https://executor.example.test'],
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8')
        lines = queue.Queue()
        def read_lines():
            for line in cls.process.stdout:
                lines.put(line)
            lines.put(None)
        threading.Thread(target=read_lines, daemon=True).start()
        diagnostic = []
        deadline = time.monotonic() + 30
        try:
            while time.monotonic() < deadline:
                line = lines.get(timeout=max(.1, deadline - time.monotonic()))
                if line is None:
                    raise RuntimeError('PowerShell 提前退出：' + ''.join(diagnostic))
                diagnostic.append(line)
                if line.startswith('{'):
                    cls.connection = json.loads(line)
                    return
            raise RuntimeError('PowerShell 启动超时')
        except Exception:
            cls.process.kill()
            cls.process.wait(timeout=10)
            cls.directory.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)
        cls.process.stdout.close()
        cls.directory.cleanup()

    def request(self, method, path, body=None, headers=None):
        client = http.client.HTTPConnection('127.0.0.2', self.bind_port, timeout=15)
        request_headers = {'Origin': ORIGIN, 'Authorization': 'Bearer ' + self.connection['token']}
        if body is not None:
            request_headers['Content-Type'] = 'application/json'
        request_headers.update(headers or {})
        client.request(method, path, json.dumps(body).encode() if body is not None else None, request_headers)
        response = client.getresponse()
        result = response.status, dict(response.getheaders()), json.loads(response.read())
        client.close()
        return result

    def test_指定监听IP和HTTPS入口同时保留Host校验(self):
        self.assertEqual(self.connection['url'], 'https://executor.example.test')
        self.assertEqual(self.request('GET', '/v1/info', headers={'Host': 'executor.example.test'})[0], 200)
        client = http.client.HTTPConnection('127.0.0.2', self.bind_port, timeout=15)
        try:
            client.request('GET', '/v1/info', headers={'Host': 'evil.example', 'Origin': ORIGIN, 'Authorization': 'Bearer ' + self.connection['token']})
            response = client.getresponse()
            self.assertIn(response.status, (400, 403, 404), '未知 Host 应由 HTTP 前缀或执行端校验拒绝')
            response.read()
        finally:
            client.close()

    def test_降级端提供同版本连接信息且不回传凭据(self):
        status, _, info = self.request('GET', '/v1/info')
        self.assertEqual(status, 200)
        self.assertEqual(info['runtime'], 'powershell')
        self.assertEqual(info['protocol_version'], 1)
        self.assertEqual(info['shells'], ['powershell', 'cmd'])
        self.assertNotIn('permissions', info)
        self.assertNotIn(self.connection['token'], json.dumps(info))

    def test_降级端拒绝跨来源及未认证请求并允许合法预检(self):
        self.assertEqual(self.request('GET', '/v1/info', headers={'Origin': 'https://evil.test'})[0], 403)
        self.assertEqual(self.request('GET', '/v1/info', headers={'Authorization': 'Bearer wrong'})[0], 401)
        status, headers, _ = self.request('OPTIONS', '/v1/tasks', headers={'Authorization': '', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'})
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], ORIGIN)

    def test_降级端拒绝路径穿透和非法任务参数(self):
        self.assertEqual(self.request('GET', '/../../secret')[0], 404)
        self.assertEqual(self.request('POST', '/v1/tasks', {'id': '../invalid', 'command': 'pwd'})[0], 400)
        self.assertEqual(self.request('POST', '/v1/tasks', {'id': 'invalid-command', 'command': 123})[0], 400)
        self.assertEqual(self.request('POST', '/v1/tasks', {'id': 'invalid-directory', 'command': 'pwd', 'cwd': []})[0], 400)

        for shell in [[], {}, 0, None, '', 'sh']:
            self.assertEqual(self.request('POST', '/v1/tasks', {'id': 'invalid-shell', 'command': 'pwd', 'shell': shell})[0], 400)

    @unittest.skipUnless(os.name == 'nt', '任务作业对象需要真实 Windows 系统验证')
    def test_Windows任务返回中文输出及退出码(self):
        status, _, task = self.request('POST', '/v1/tasks', {'id': 'windows-native-test', 'command': "Write-Output '本机执行成功'; exit 7"})
        self.assertEqual(status, 200)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            _, _, task = self.request('GET', '/v1/tasks/windows-native-test')
            if task['status'] in ('completed', 'failed'):
                break
            time.sleep(.05)
        self.assertEqual(task['exit_code'], 7)
        self.assertIn('本机执行成功', task['output'])
