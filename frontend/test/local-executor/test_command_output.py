"""通过真实执行器 HTTP 接口检查常用 Shell 命令和输出分页，只操作临时目录。"""
import os
from pathlib import Path
import time
import unittest

import test_executor as fixture


@unittest.skipIf(os.name == 'nt', '此组检查 Unix sh；Windows 输出由 PowerShell 定向测试覆盖')
class ShellOutputTest(unittest.TestCase):
    # 复用 HTTP 夹具，不继承无关用例，避免本次定向测试扩成全部执行器测试。
    setUp = fixture.ExecutorTest.setUp
    tearDown = fixture.ExecutorTest.tearDown
    request = fixture.ExecutorTest.request
    submit = fixture.ExecutorTest.submit
    wait_task = fixture.ExecutorTest.wait_task
    python = fixture.ExecutorTest.python

    def read_all(self, task_id):
        task = self.wait_task(task_id)
        result = task['output']
        while task['has_more']:
            previous_cursor = task['cursor']
            status, _, task = self.request('GET', '/v1/tasks/' + task_id + '?cursor=' + str(previous_cursor))
            self.assertEqual(status, 200)
            self.assertGreater(task['cursor'], previous_cursor)
            result += task['output']
        return task, result

    def test_output_page_contract(self):
        """读取量按完整字符计算，游标续读不重复、不遗漏，也不过滤 XML 外观的原文。"""
        expected = '中文😀�\n#< CLIXML\n<Objs>原文</Objs>\n'
        task_id, _ = self.submit(self.python('print(' + repr(expected) + ', end="")'))
        self.wait_task(task_id)
        for limit in (1, 7, 20000):
            cursor, output = 0, ''
            while True:
                status, _, page = self.request('GET', '/v1/tasks/%s?cursor=%d&max_chars=%d' % (task_id, cursor, limit))
                self.assertEqual(status, 200)
                self.assertLessEqual(len(page['output']), limit)
                self.assertFalse(page['decoding_loss'])
                output += page['output']
                cursor = page['cursor']
                if not page['has_more']:
                    break
            self.assertEqual(output, expected)
        for value in ('0', '20001', '1.5'):
            self.assertEqual(self.request('GET', '/v1/tasks/' + task_id + '?max_chars=' + value)[0], 400)

    def test_decoding_loss_is_separate_from_exit_status(self):
        """非法及末尾不完整字节会标记损失，但保留实际退出码并继续采集。"""
        data = '前😀�'.encode() + b'\xff' + '后'.encode() + b'\xe2\x82'
        task_id, _ = self.submit(self.python('import os; os.write(1, ' + repr(data) + ')'))
        task, output = self.read_all(task_id)
        self.assertEqual(output, '前😀��后�')
        self.assertTrue(task['decoding_loss'])
        self.assertEqual(task['status'], 'completed')
        self.assertEqual(task['exit_code'], 0)

    def test_目录及中文特殊文件路径读取(self):
        (Path(self.directory.name) / '中文 文件 [1]&.txt').write_text('第一行\n第二行\n', encoding='utf-8')
        task_id, _ = self.submit("pwd; cat '中文 文件 [1]&.txt'; test -f '中文 文件 [1]&.txt' && printf 'EXISTS=True\\n'")
        task, output = self.read_all(task_id)
        self.assertEqual(task['exit_code'], 0)
        self.assertEqual(output, self.directory.name+'\n第一行\n第二行\nEXISTS=True\n')

    def test_排序过滤管道与文件重定向(self):
        task_id, _ = self.submit("printf 'beta\\nalpha\\nbeta\\ngamma\\n' | grep -v gamma | sort -u > result.txt; cat result.txt")
        task, output = self.read_all(task_id)
        self.assertEqual(task['status'], 'completed')
        self.assertEqual(output, 'alpha\nbeta\n')
        self.assertEqual(Path(self.directory.name, 'result.txt').read_text(), output)

    def test_失败命令保留错误输出与非零状态(self):
        for command in ("cat ./executor-file-does-not-exist", 'executor-command-does-not-exist'):
            with self.subTest(command=command):
                task_id, _ = self.submit(command)
                task, output = self.read_all(task_id)
                self.assertEqual(task['status'], 'failed')
                self.assertNotEqual(task['exit_code'], 0)
                self.assertIn('executor-', output)

    def test_任务运行期间可以读取输出且末尾不会重复(self):
        task_id, _ = self.submit("printf '开始\\n'; sleep 1.5; printf '结束\\n'")
        deadline = time.monotonic()+10
        while time.monotonic() < deadline:
            status, _, task = self.request('GET', '/v1/tasks/'+task_id)
            if task['output']:
                break
            time.sleep(.02)
        self.assertEqual(task['status'], 'running')
        self.assertEqual(task['output'], '开始\n')
        first_cursor = task['cursor']
        self.wait_task(task_id)
        _, _, tail = self.request('GET', '/v1/tasks/'+task_id+'?cursor='+str(first_cursor))
        self.assertEqual(tail['output'], '结束\n')
        _, _, repeated = self.request('GET', '/v1/tasks/'+task_id+'?cursor='+str(tail['cursor']))
        self.assertEqual(repeated['output'], '')

    def test_多页中文输出逐字节内容完整(self):
        expected = ''.join('第%05d行：中文与符号 & []\n' % index for index in range(5000))
        command = self.python("import sys; sys.stdout.write(''.join('第%05d行：中文与符号 & []\\n' % i for i in range(5000))); sys.stdout.flush()")
        task_id, _ = self.submit(command)
        task, output = self.read_all(task_id)
        self.assertEqual(task['status'], 'completed')
        self.assertFalse(task['truncated'])
        self.assertFalse(task['output_lost'])
        self.assertEqual(output, expected)


if __name__ == '__main__':
    unittest.main()
