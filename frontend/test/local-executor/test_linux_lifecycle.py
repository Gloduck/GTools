"""Linux 执行生命周期定向审查；只运行临时命令，不依赖用户配置。

覆盖结果完整性、输出收尾和终端背压，回归测试不允许成功终态后追加输出。
脱离进程组的守护进程属于明确不支持的能力边界，单独观察并主动清理。
"""
import io
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import unittest
from unittest.mock import patch

import test_executor as fixture


@unittest.skipUnless(sys.platform.startswith('linux'), '此组检查 Linux 进程与管道语义')
class LinuxLifecycleTest(unittest.TestCase):
    setUp = fixture.ExecutorTest.setUp
    tearDown = fixture.ExecutorTest.tearDown
    request = fixture.ExecutorTest.request
    submit = fixture.ExecutorTest.submit
    wait_task = fixture.ExecutorTest.wait_task
    python = fixture.ExecutorTest.python

    def wait_file(self, filename):
        path = Path(self.directory.name, filename)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if path.exists() and path.read_text():
                return path.read_text()
            time.sleep(.01)
        self.fail('临时子进程未写入就绪文件：' + filename)

    def process_running(self, pid):
        try:
            return Path('/proc', str(pid), 'stat').read_text().split()[2] != 'Z'
        except FileNotFoundError:
            return False

    def wait_root_exit(self, task_id, exit_code, output_marker=None):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            status, _, task = self.request('GET', '/v1/tasks/' + task_id)
            self.assertEqual(status, 200)
            if task['exit_code'] == exit_code and (output_marker is None or output_marker in task['output']):
                return task
            time.sleep(.02)
        self.fail('根命令未返回预期退出码')

    def test_session根退出后后代继续输出且终态等待收尾(self):
        command = "(while [ ! -f release-session ]; do sleep .03; done; printf 'TAIL中文😀\\n') & echo $! > session-child.pid; printf 'ROOT\\n'; exit 7"
        task_id, _ = self.submit(command, lifecycle='session')
        child = int(self.wait_file('session-child.pid'))
        try:
            first = self.wait_root_exit(task_id, 7, 'ROOT\n')
            self.assertEqual(first['lifecycle'], 'session')
            self.assertEqual(first['status'], 'running')
            self.assertTrue(self.process_running(child))
            self.assertEqual(first['output'], 'ROOT\n')
            Path(self.directory.name, 'release-session').touch()
            final = self.wait_task(task_id)
            self.assertEqual(final['status'], 'failed')
            self.assertEqual(final['exit_code'], 7)
            self.assertEqual(final['output'], 'ROOT\nTAIL中文😀\n')
            _, _, tail = self.request('GET', '/v1/tasks/' + task_id + '?cursor=' + str(first['cursor']))
            self.assertEqual(tail['output'], 'TAIL中文😀\n')
            time.sleep(.08)
            _, _, stable = self.request('GET', '/v1/tasks/' + task_id)
            self.assertEqual((stable['cursor'], stable['output']), (final['cursor'], final['output']))
        finally:
            if self.process_running(child):
                os.kill(child, signal.SIGKILL)

    def test_session无输出后代仍存活且取消保留根退出码(self):
        task_id, _ = self.submit('sleep 30 >/dev/null 2>&1 & echo $! > silent-child.pid; exit 0', lifecycle='session')
        child = int(self.wait_file('silent-child.pid'))
        try:
            running = self.wait_root_exit(task_id, 0)
            self.assertEqual(running['status'], 'running')
            self.assertEqual(running['output'], '')
            self.assertTrue(self.process_running(child))
            self.request('POST', '/v1/tasks/' + task_id + '/cancel', {})
            final = self.wait_task(task_id)
            self.assertEqual(final['status'], 'cancelled')
            self.assertEqual(final['exit_code'], 0)
            self.assertFalse(self.process_running(child))
        finally:
            if self.process_running(child):
                os.kill(child, signal.SIGKILL)

    def test_session后台进程在执行端关闭时清理(self):
        task_id, _ = self.submit('sleep 30 >/dev/null 2>&1 & echo $! > shutdown-child.pid; exit 0', lifecycle='session')
        child = int(self.wait_file('shutdown-child.pid'))
        try:
            self.assertEqual(self.wait_root_exit(task_id, 0)['status'], 'running')
            self.executor.close()
            final = self.wait_task(task_id)
            self.assertEqual(final['status'], 'cancelled')
            self.assertEqual(final['exit_code'], 0)
            self.assertFalse(self.process_running(child))
        finally:
            if self.process_running(child):
                os.kill(child, signal.SIGKILL)

    def test_lifecycle非法值拒绝且同编号不能改生命周期(self):
        for value in ('background', '', None, 1):
            self.assertEqual(self.request('POST', '/v1/tasks', {'id': 'invalid-lifecycle', 'command': 'true', 'lifecycle': value})[0], 400)
        task_id, body = self.submit('true')
        self.assertEqual(self.wait_task(task_id)['lifecycle'], 'task')
        self.assertEqual(self.request('POST', '/v1/tasks', {**body, 'lifecycle': 'session'})[0], 409)

    def test_监管控制EOF且stderr关闭仍清理自身组(self):
        command = 'sleep 30 & echo $! > eof-child.pid; echo $$ > eof-root.pid; printf BUSINESS; wait'
        process = subprocess.Popen([sys.executable, '-u', '-c', fixture.module.POSIX_SUPERVISOR, command],
                                   cwd=self.directory.name, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True, bufsize=0)
        child = root = None
        try:
            self.assertEqual(process.stderr.readline(), ('READY %d\n' % process.pid).encode())
            process.stdin.write(b'START\n')
            process.stdin.flush()
            child = int(self.wait_file('eof-child.pid'))
            root = int(self.wait_file('eof-root.pid'))
            self.assertEqual(process.stdout.read(8), b'BUSINESS')
            process.stderr.close()
            process.stdin.close()
            process.wait(timeout=5)
            deadline = time.monotonic() + 3
            while self.process_running(child) and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertFalse(self.process_running(child))
            self.assertFalse(self.process_running(root))
            self.assertEqual(process.stdout.read(), b'')
        finally:
            for pid in (child, root):
                if pid and self.process_running(pid):
                    os.kill(pid, signal.SIGKILL)
            if process.poll() is None:
                process.kill()
            process.wait(timeout=5)
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()

    def test_监管进程丢失明确未知且关闭有界不补杀历史进程组(self):
        task_id, _ = self.submit('sleep 30 & echo $! > orphan-child.pid; printf ROOT; wait', lifecycle='session')
        child = int(self.wait_file('orphan-child.pid'))
        task = self.executor.get_task(task_id)
        try:
            deadline = time.monotonic() + 3
            while 'ROOT' not in task.snapshot(0)['output'] and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertIn('ROOT', task.snapshot(0)['output'])
            self.assertIsNone(task.snapshot(0)['exit_code'])
            task.process.kill()
            task.process.wait(timeout=3)
            self.assertTrue(task.done.wait(4), '监管丢失后工作线程不能无界等待后代或输出EOF')
            result = task.snapshot(0)
            self.assertEqual(result['status'], 'unknown')
            self.assertIsNone(result['exit_code'])
            self.assertTrue(result['error'])
            self.assertNotIn('READY ', result['output'])
            self.assertNotIn('EXIT ', result['output'])
            self.assertTrue(self.process_running(child), '失去监管身份后不应向历史进程组补杀')
            started = time.monotonic()
            self.executor.close()
            self.assertLess(time.monotonic() - started, 3)
        finally:
            if self.process_running(child):
                os.kill(child, signal.SIGKILL)
            task.done.wait(5)

    def test_UTF8跨读取边界及不完整尾字节按约定替换(self):
        source = "import os,time; data='中文😀'.encode(); [(os.write(1,bytes([b])),time.sleep(.02)) for b in data]; os.write(1,b'\\xff\\xe4')"
        task_id, _ = self.submit(self.python(source))
        result = self.wait_task(task_id)
        self.assertEqual(result['output'], '中文😀\ufffd\ufffd')
        self.assertEqual(result['exit_code'], 0)

    def test_非交互标准输入立即返回EOF(self):
        task_id, _ = self.submit(self.python("import sys; print('STDIN='+repr(sys.stdin.read()))"))
        result = self.wait_task(task_id)
        self.assertEqual(result['output'], "STDIN=''\n")
        self.assertEqual(result['status'], 'completed')

    def test_管道退出码遵循POSIX最后一项语义(self):
        task_id, _ = self.submit('false | true')
        self.assertEqual(self.wait_task(task_id)['exit_code'], 0)
        task_id, _ = self.submit('true | false')
        self.assertEqual(self.wait_task(task_id)['exit_code'], 1)

    def test_exec进程信号退出保留Python负数退出码(self):
        task_id, _ = self.submit('exec ' + self.python('import os,signal; os.kill(os.getpid(), signal.SIGTERM)'))
        result = self.wait_task(task_id)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['exit_code'], -signal.SIGTERM)

    def test_取消已忽略TERM的同组后代仍可完成清理(self):
        source = "import os,signal,time; from pathlib import Path; signal.signal(signal.SIGTERM,signal.SIG_IGN); Path('ready.pid').write_text(str(os.getpid())); time.sleep(30)"
        task_id, _ = self.submit(self.python(source))
        pid = int(self.wait_file('ready.pid'))
        try:
            self.request('POST', '/v1/tasks/' + task_id + '/cancel', {})
            result = self.wait_task(task_id)
            self.assertEqual(result['status'], 'cancelled')
            self.assertFalse(self.process_running(pid))
            self.assertLess(result['exit_code'], 0)
        finally:
            if self.process_running(pid):
                os.kill(pid, signal.SIGKILL)

    def test_终端写入异常不改变输出与退出码(self):
        class BrokenConsole:
            def write(self, value):
                raise OSError('模拟终端已关闭')

        self.executor.log_stream = BrokenConsole()
        task_id, _ = self.submit("printf '日志依然完整'; exit 7")
        result = self.wait_task(task_id)
        self.assertEqual(result['output'], '日志依然完整')
        self.assertEqual(result['exit_code'], 7)
        self.assertEqual(result['error'], '')

    def test_终端输出阻塞时不能在读完任务输出前发布成功终态(self):
        entered, release = threading.Event(), threading.Event()
        reader_finished = threading.Event()
        original_read_output = fixture.module.Task.read_output

        def observed_read_output(task):
            try:
                original_read_output(task)
            finally:
                reader_finished.set()

        class SlowConsole(io.StringIO):
            def write(self, value):
                if 'A' * 100 in value:
                    entered.set()
                    release.wait(10)
                return super().write(value)

        self.executor.log_stream = SlowConsole()
        with patch.object(fixture.module.Task, 'read_output', observed_read_output):
            task_id, _ = self.submit(self.python("import os; os.write(1,b'A'*6000)"))
            task = self.executor.get_task(task_id)
            try:
                self.assertTrue(entered.wait(3), '日志输出应已遇到慢终端')
                task.process.wait(timeout=3)
                # 跨过当前实现的三秒窗口，只取快照；正确实现可以仍在等待EOF。
                time.sleep(3.3)
                _, _, blocked = self.request('GET', '/v1/tasks/' + task_id)
            finally:
                release.set()
                # 独立观察read_output的退出，避免依赖被审查的done次序。
                reader_stopped = reader_finished.wait(5)
            self.assertTrue(reader_stopped, '解除日志阻塞后读线程必须退出')
            terminal = self.wait_task(task_id)
            self.assertTrue(task.done.wait(5))
        after = task.snapshot(blocked['cursor'])
        print('慢终端修订判据原始证据：阻塞时status=%s，已收集=%s，has_more=%s；读线程结束后总计=%s，新增=%s' % (
            blocked['status'], len(blocked['output']), blocked['has_more'],
            len(terminal['output']), len(after['output'])))
        self.assertEqual(terminal['output'], 'A' * 6000, '解除阻塞后输出必须完整')
        self.assertEqual(task.snapshot(terminal['cursor'])['output'], '')
        if blocked['status'] in fixture.module.FINAL:
            self.assertEqual(blocked['output'], 'A' * 6000,
                             '成功终态和 has_more=false 必须意味着输出已经排空')

    def test_慢终端日志不阻塞其他任务启动和完成(self):
        entered, release = threading.Event(), threading.Event()

        class SlowConsole(io.StringIO):
            def write(self, value):
                entered.set()
                release.wait(10)
                return super().write(value)

        self.executor.log_stream = SlowConsole()
        try:
            first, _ = self.submit("printf 'first'")
            self.assertTrue(entered.wait(3))
            second, _ = self.submit("printf 'second'")
            second_result = self.wait_task(second, seconds=2)
            first_result = self.wait_task(first, seconds=2)
            self.assertEqual(second_result['output'], 'second')
            self.assertEqual(first_result['output'], 'first')
            self.assertEqual(second_result['status'], 'completed')
            self.assertEqual(first_result['status'], 'completed')
        finally:
            release.set()

    def test_采集异常必须返回失败和明确错误(self):
        original_popen = fixture.module.subprocess.Popen

        class BrokenPipe:
            def __init__(self, pipe):
                self.pipe = pipe
                self.read_once = False

            def read(self, size):
                if self.read_once:
                    raise OSError('测试注入：输出管道读取失败')
                self.read_once = True
                return self.pipe.read(size)

            def __getattr__(self, name):
                return getattr(self.pipe, name)

        def start_process(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            process.stdout = BrokenPipe(process.stdout)
            return process

        with patch.object(fixture.module.subprocess, 'Popen', start_process):
            task_id, _ = self.submit("printf 'partial'")
            result = self.wait_task(task_id)
        self.assertEqual(result['status'], 'failed')
        self.assertIn('输出管道读取失败', result['error'])
        self.assertEqual(result['output'], 'partial')

    def test_读线程启动失败仍发布失败终态并回收子进程(self):
        task = fixture.module.Task(self.executor, 'reader-start-fault', 'sleep 30',
                                   self.directory.name, 'test', 'sh')
        original_start = threading.Thread.start

        def start_thread(thread):
            # 只注入当前任务的采集线程，不影响HTTP线程或终端日志线程。
            if getattr(thread, '_target', None) == task.read_output:
                raise RuntimeError('测试注入：cannot start new thread')
            return original_start(thread)

        try:
            with patch.object(threading.Thread, 'start', start_thread):
                task.run()
            self.assertTrue(task.done.is_set(), '启动异常也必须完成任务收尾')
            self.assertEqual(task.snapshot(0)['status'], 'failed')
            self.assertIn('cannot start new thread', task.error)
            self.assertIsNotNone(task.process.returncode, '已启动子进程必须回收')
            self.assertFalse(self.process_running(task.process.pid))
            self.assertTrue(task.process.stdout.closed)
        finally:
            # 即使回归导致run抛异常，测试本身也不能遗留命令和管道。
            task.kill_tree()
            if task.process:
                task.process.wait(timeout=3)
                task.process.stdout.close()

    def test_终端日志积压有界且明确提示省略而接口输出完整(self):
        entered, release = threading.Event(), threading.Event()

        class SlowConsole(io.StringIO):
            def write(self, value):
                entered.set()
                release.wait(10)
                return super().write(value)

        console = SlowConsole()
        self.executor.log_stream = console
        with patch.object(fixture.module, 'MAX_LOG_CHARS', 128):
            try:
                # 先占住终端写线程，确保整个任务期间日志队列都承受背压。
                self.executor.log('log-test', '阻塞终端')
                self.assertTrue(entered.wait(3))
                task_id, _ = self.submit(self.python("import os; os.write(1,b'Q'*6000)"))
                result = self.wait_task(task_id, seconds=2)
                self.assertEqual(result['status'], 'completed')
                self.assertEqual(result['output'], 'Q' * 6000)
                self.assertFalse(result['truncated'])
                self.assertFalse(result['output_lost'])
                with self.executor.terminal_log.condition:
                    self.assertLessEqual(self.executor.terminal_log.pending_chars, 128)
                    self.assertGreater(self.executor.terminal_log.dropped_chars, 0)
            finally:
                release.set()
                flushed = self.executor.terminal_log.flush(timeout=3)
        self.assertTrue(flushed, '释放慢终端后队列应排空')
        self.assertRegex(console.getvalue(), r'终端日志积压，已省略 [1-9][0-9]* 字符')
        self.assertIn('任务输出请以接口缓存为准', console.getvalue())

    def test_终态必须等待EOF解码收尾且之后不再追加(self):
        eof_seen, release = threading.Event(), threading.Event()
        original_popen = fixture.module.subprocess.Popen

        class DelayedEOF:
            def __init__(self, pipe):
                self.pipe = pipe

            def read(self, size):
                chunk = self.pipe.read(size)
                if not chunk:
                    eof_seen.set()
                    release.wait(10)
                return chunk

            def __getattr__(self, name):
                return getattr(self.pipe, name)

        def start_process(*args, **kwargs):
            process = original_popen(*args, **kwargs)
            process.stdout = DelayedEOF(process.stdout)
            return process

        with patch.object(fixture.module.subprocess, 'Popen', start_process):
            task_id, _ = self.submit(self.python("import os; os.write(1,'开始'.encode()+b'\\xe4')"))
            try:
                self.assertTrue(eof_seen.wait(3))
                time.sleep(3.3)
                _, _, before = self.request('GET', '/v1/tasks/' + task_id)
            finally:
                release.set()
            result = self.wait_task(task_id)
        self.assertNotIn(before['status'], fixture.module.FINAL,
                         '解码器尚未收尾时不能发布终态')
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['output'], '开始\ufffd')
        self.assertFalse(result['has_more'])
        for _ in range(3):
            _, _, stable = self.request('GET', '/v1/tasks/' + task_id + '?cursor=' + str(result['cursor']))
            self.assertEqual(stable['output'], '')
            self.assertEqual(stable['cursor'], result['cursor'])
            self.assertEqual(stable['status'], result['status'])

    def test_脱离会话进程属于已知边界且测试负责清理(self):
        # 产品工具说明明确禁止 detached daemon；此项验证边界，不当作新缺陷。
        child = "import os,time; from pathlib import Path; Path('detached.pid').write_text(str(os.getpid())); time.sleep(30)"
        source = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',%r], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(30)" % child
        task_id, _ = self.submit(self.python(source))
        pid = int(self.wait_file('detached.pid'))
        try:
            self.request('POST', '/v1/tasks/' + task_id + '/cancel', {})
            self.assertEqual(self.wait_task(task_id)['status'], 'cancelled')
            print('已知能力边界原始证据：取消后 setsid 后代仍运行=%s；由测试主动清理' % self.process_running(pid))
        finally:
            if self.process_running(pid):
                os.kill(pid, signal.SIGKILL)
            deadline = time.monotonic() + 3
            while self.process_running(pid) and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertFalse(self.process_running(pid), '测试生成的脱离会话进程必须清理')


if __name__ == '__main__':
    unittest.main()
