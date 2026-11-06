"""真实回环 HTTP 接口测试，不依赖远程后端、第三方包或模型凭据。"""
import http.client
import io
import importlib.util
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid

SOURCE = Path(__file__).resolve().parents[2] / 'public/local-executor/v1/executor.py'
spec = importlib.util.spec_from_file_location('local_executor', SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ORIGIN = 'https://tools.example.test'


class ExecutorTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='executor-test-')
        self.console = io.StringIO()
        self.executor = module.Executor(ORIGIN, self.directory.name, log_stream=self.console)
        self.server = module.Server(self.executor, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.executor.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=15)
        full = {'Origin': ORIGIN, 'Authorization': 'Bearer ' + self.executor.token}
        if body is not None:
            full['Content-Type'] = 'application/json'
        full.update(headers or {})
        data = json.dumps(body).encode() if body is not None else None
        connection.request(method, path, data, full)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), json.loads(response.read())
        connection.close()
        return result

    def submit(self, command, **kwargs):
        body = {'id': uuid.uuid4().hex, 'command': command, **kwargs}
        status, _, result = self.request('POST', '/v1/tasks', body)
        self.assertEqual(status, 200, result)
        return result['id'], body

    def wait_task(self, task_id, seconds=8):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            status, _, task = self.request('GET', '/v1/tasks/' + task_id)
            self.assertEqual(status, 200)
            if task['status'] in module.FINAL:
                return task
            time.sleep(.03)
        self.fail('任务未在规定时间内结束')

    def python(self, source):
        if os.name == 'nt':
            quote = lambda value: "'" + value.replace("'", "''") + "'"
            return '& ' + quote(sys.executable) + ' -c ' + quote(source)
        return shlex.quote(sys.executable) + ' -c ' + shlex.quote(source)

    def test_连接鉴权与跨域预检(self):
        status, headers, info = self.request('GET', '/v1/info')
        self.assertEqual(status, 200)
        self.assertNotIn('permissions', info)
        self.assertNotIn(self.executor.token, json.dumps(info))
        self.assertEqual(headers['Cache-Control'], 'no-store')
        for bad in ({'Origin': 'https://evil.test'}, {'Origin': 'null'}, {'Host': 'evil.test'}, {'Authorization': 'Bearer wrong'}):
            status, headers, _ = self.request('GET', '/v1/info', headers=bad)
            self.assertIn(status, (401, 403))
            if 'Origin' in bad:
                self.assertNotIn('Access-Control-Allow-Origin', headers)
        status, headers, _ = self.request('OPTIONS', '/v1/tasks', headers={'Authorization': '', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type', 'Access-Control-Request-Private-Network': 'true'})
        self.assertEqual(status, 200)
        self.assertEqual(headers['Access-Control-Allow-Origin'], ORIGIN)
        self.assertEqual(headers['Access-Control-Allow-Private-Network'], 'true')
        self.assertEqual(self.request('OPTIONS', '/v1/tasks', headers={'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-unexpected'})[0], 403)

    def test_固定路由与请求参数校验(self):
        self.assertEqual(self.request('GET', '/../../etc/passwd')[0], 404)
        self.assertEqual(self.request('GET', '/v1/tasks')[0], 405)
        for body in ([], {'id': '../outside', 'command': 'pwd'}, {'id': 'test-task', 'command': ''}, {'id': 'test-task', 'command': 'pwd', 'cwd': []}, {'id': 'test-task', 'command': 'pwd', 'cwd': '/definitely-missing-executor'}):
            self.assertEqual(self.request('POST', '/v1/tasks', body)[0], 400)
        self.assertEqual(self.request('POST', '/v1/tasks', {'x': 'a' * (module.MAX_BODY + 1)})[0], 413)
        self.assertEqual(self.request('POST', '/v1/tasks', {}, {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request('POST', '/v1/tasks', {}, {'Transfer-Encoding': 'chunked'})[0], 400)

    def test_拒绝不可用或类型错误的Shell(self):
        for shell in [[], {}, 0, None, '', 'bash']:
            self.assertEqual(self.request('POST', '/v1/tasks', {'id': 'invalid-shell', 'command': 'echo hello', 'shell': shell})[0], 400)
        if os.name != 'nt':
            self.assertEqual(self.request('POST', '/v1/tasks', {'id': 'invalid-shell', 'command': 'echo hello', 'shell': 'cmd'})[0], 400)

    def test_任意命令中文输出与退出码(self):
        command = self.python("import sys; print('中文', flush=True); print('error', file=sys.stderr, flush=True); sys.exit(7)")
        if os.name == 'nt':
            command += '; exit $LASTEXITCODE'  # PowerShell CLI 默认将外部失败归为 1，显式保留原值。
        task_id, _ = self.submit(command)
        task = self.wait_task(task_id)
        self.assertEqual(task['status'], 'failed')
        self.assertEqual(task['exit_code'], 7)
        self.executor.get_task(task_id).done.wait(2)
        self.assertTrue(self.executor.terminal_log.flush(2))
        log = self.console.getvalue()
        self.assertIn('[%s]' % task_id, log)
        self.assertIn('中文', log)
        self.assertIn('error', log)
        self.assertIn('执行结束 | 状态: failed | 退出码: 7', log)
        self.assertEqual(task['output'].replace('\r\n', '\n'), '中文\nerror\n')
        status, _, delta = self.request('GET', '/v1/tasks/' + task_id + '?cursor=' + str(task['cursor']))
        self.assertEqual(status, 200)
        self.assertEqual(delta['output'], '')
        self.assertEqual(self.request('GET', '/v1/tasks/' + task_id + '?cursor=-1')[0], 400)

    def test_普通用户模式允许访问其他目录(self):
        outside = Path(self.directory.name).parent
        task_id, _ = self.submit(self.python('import os; print(os.getcwd())'), cwd=str(outside))
        self.assertEqual(self.wait_task(task_id)['output'].strip(), str(outside))

    def test_重复提交不重复执行且禁止替换内容(self):
        task_id, body = self.submit(self.python("with open('counter', 'a') as f: f.write('x')"))
        self.wait_task(task_id)
        self.assertEqual(self.request('POST', '/v1/tasks', body)[0], 200)
        self.assertEqual(Path(self.directory.name, 'counter').read_text(), 'x')
        self.assertEqual(self.request('POST', '/v1/tasks', {**body, 'command': 'echo replaced'})[0], 409)

    def test_任务由用户取消且运行期间仍可接收新任务(self):
        task_ids = []
        for _ in range(6):
            task_id, _ = self.submit(self.python('import time; time.sleep(30)'))
            task_ids.append(task_id)
        self.assertEqual(self.request('GET', '/v1/info')[0], 200)
        for task_id in task_ids:
            _, _, task = self.request('GET', '/v1/tasks/' + task_id)
            self.assertIn(task['status'], ('queued', 'running'))
            self.assertEqual(self.request('POST', '/v1/tasks/' + task_id + '/cancel', {})[0], 200)
        for task_id in task_ids:
            self.assertEqual(self.wait_task(task_id)['status'], 'cancelled')

    def test_累计任务超过原上限仍继续接受任务(self):
        for _ in range(102):
            task_id, _ = self.submit(self.python('pass'))
            self.assertEqual(self.wait_task(task_id)['status'], 'completed')
        self.assertNotIn('limits', self.executor.info())
        self.assertNotIn('idle_seconds', self.executor.info())

    def test_输出缓存滚动不终止命令且旧游标明确提示丢失(self):
        task_id, _ = self.submit(self.python("import sys; from pathlib import Path; sys.stdout.write('x' * 1200000 + '末尾标记'); sys.stdout.flush(); Path('continued').write_text('yes')"))
        task = self.wait_task(task_id)
        self.assertEqual(task['status'], 'completed')
        self.assertTrue(task['truncated'])
        self.assertTrue(task['output_lost'])
        output = task['output']
        while task['has_more']:
            _, _, task = self.request('GET', '/v1/tasks/' + task_id + '?cursor=' + str(task['cursor']))
            output += task['output']
        self.assertEqual(len(output), module.MAX_OUTPUT_CHARS)
        self.assertTrue(output.endswith('末尾标记'))
        self.assertEqual(Path(self.directory.name, 'continued').read_text(), 'yes')

    @unittest.skipIf(os.name == 'nt', '此场景检查 Unix 进程组；Windows 使用作业对象')
    def test_前台任务退出后清理后台子进程(self):
        task_id, _ = self.submit("sleep 30 & echo $! > child.pid; echo done")
        self.assertEqual(self.wait_task(task_id)['status'], 'completed')
        pid = int(Path(self.directory.name, 'child.pid').read_text())
        if sys.platform.startswith('linux'):
            path = Path('/proc') / str(pid) / 'stat'
            self.assertTrue(not path.exists() or path.read_text().split()[2] == 'Z')

    def test_关闭执行端取消任务并拒绝新任务(self):
        task_id, _ = self.submit(self.python('import time; time.sleep(30)'))
        self.executor.close()
        self.assertEqual(self.wait_task(task_id)['status'], 'cancelled')
        self.assertEqual(self.request('POST', '/v1/tasks', {'id': 'closed-task', 'command': 'pwd'})[0], 410)



@unittest.skipIf(os.name == 'nt', '此场景验证 macOS / Linux 的 Shell 启动入口')
class BootstrapTest(unittest.TestCase):
    def test_静态脚本启动保留工作目录并在退出后清理缓存(self):
        import functools
        import queue
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
        class StaticHandler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(StaticHandler, directory=str(SOURCE.parent)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        process = None
        try:
            with tempfile.TemporaryDirectory(prefix='executor-bootstrap-test-') as directory:
                cache = Path(directory, 'cache')
                cache.mkdir()
                process = subprocess.Popen(['sh', str(SOURCE.with_name('bootstrap.sh')),
                                            'http://127.0.0.1:%d' % server.server_port, ORIGIN],
                                           cwd=directory, env={**os.environ, 'TMPDIR': str(cache)},
                                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                lines = queue.Queue()
                def read_lines():
                    for line in process.stdout:
                        lines.put(line)
                    lines.put(None)
                threading.Thread(target=read_lines, daemon=True).start()
                diagnostic = []
                connection = None
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    line = lines.get(timeout=max(.1, deadline - time.monotonic()))
                    if line is None:
                        self.fail('启动脚本提前结束：' + ''.join(diagnostic))
                    diagnostic.append(line)
                    if line.startswith('{'):
                        connection = json.loads(line)
                        break
                self.assertIsNotNone(connection, '未返回连接信息')
                from urllib.parse import urlsplit
                client = http.client.HTTPConnection('127.0.0.1', urlsplit(connection['url']).port)
                client.request('GET', '/v1/info', headers={'Origin': ORIGIN, 'Authorization': 'Bearer ' + connection['token']})
                response = client.getresponse()
                self.assertEqual(response.status, 200)
                info = json.loads(response.read())
                client.close()
                self.assertEqual(info['default_cwd'], directory)
                self.assertEqual(info['runtime'], 'python')
                process.terminate()
                process.wait(timeout=10)
                self.assertEqual(list(cache.iterdir()), [], '启动缓存应在退出后删除')
        finally:
            if process:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=10)
                process.stdout.close()
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
