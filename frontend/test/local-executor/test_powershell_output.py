"""使用已有 PowerShell 验证两个执行端的真实命令包装，不启动 Windows 进程管理代码。"""
import base64
import hashlib
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


POWERSHELL = os.environ.get('EXECUTOR_TEST_POWERSHELL') or shutil.which('powershell') or shutil.which('pwsh')
ROOT = Path(__file__).resolve().parents[2] / 'public/local-executor/v1'
spec = importlib.util.spec_from_file_location('executor_output', ROOT / 'executor.py')
executor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(executor)


@unittest.skipUnless(POWERSHELL, '未找到 PowerShell，可通过 EXECUTOR_TEST_POWERSHELL 指定已有环境')
class PowerShellOutputTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 只加载降级端生成启动参数的函数，测试不监听端口，也不调用 Windows API。
        source = r"""
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:EXECUTOR_TEST_EXECUTOR_PS1, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw '执行端语法错误' }
$function = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'New-PowerShellTaskArguments'
}, $true)
if (-not $function) { throw '未找到命令包装函数' }
. ([scriptblock]::Create($function.Extent.Text))
New-PowerShellTaskArguments '__EXECUTOR_OUTPUT_TEST_COMMAND__'
"""
        result = subprocess.run(
            [POWERSHELL, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
             base64.b64encode(source.encode('utf-16le')).decode()],
            env={**os.environ, 'EXECUTOR_TEST_EXECUTOR_PS1': str(ROOT / 'executor.ps1')},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        if result.returncode:
            raise RuntimeError('加载命令包装函数失败：' + result.stderr.decode('utf-8', errors='replace'))
        cls.fallback_arguments = result.stdout.decode('utf-8').strip().split()
        cls.fallback_script = base64.b64decode(cls.fallback_arguments[-1]).decode('utf-16le')

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='executor-output-')
        self.addCleanup(self.directory.cleanup)
        (Path(self.directory.name) / 'config.toml').write_text('name = "测试"', encoding='utf-8')

    def command_arguments(self, command):
        fallback_script = self.fallback_script.replace('__EXECUTOR_OUTPUT_TEST_COMMAND__', command)
        return {
            'Python 执行端': executor.powershell_arguments(command),
            'PowerShell 执行端': self.fallback_arguments[:-1] + [base64.b64encode(fallback_script.encode('utf-16le')).decode()],
        }

    def check_command(self, command, expected, exit_code=0, absent=(), exact=None):
        for runtime, argv in self.command_arguments(command).items():
            with self.subTest(runtime=runtime):
                result = subprocess.run([POWERSHELL, *argv], cwd=self.directory.name,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
                output = result.stdout.decode('utf-8')
                self.assertEqual(result.returncode, exit_code, output)
                for value in expected:
                    self.assertIn(value, output)
                for value in ('#< CLIXML', '<Objs ', '\ufffd', *absent):
                    self.assertNotIn(value, output)
                if exact is not None:
                    self.assertEqual(output.replace('\r\n', '\n'), exact)

    def check_native_result(self, command, expected, exit_code, absent=(), exact=None):
        # 原生 CLI 是状态语义的对照组，只设置输出编码，不改错误策略及用户控制流。
        source = "[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false);\n" + command
        native = subprocess.run([POWERSHELL, '-NoLogo', '-NoProfile', '-NonInteractive',
                                 '-OutputFormat', 'Text', '-EncodedCommand',
                                 base64.b64encode(source.encode('utf-16le')).decode()],
                                cwd=self.directory.name, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
        self.assertEqual(native.returncode, exit_code, native.stdout.decode('utf-8', errors='replace'))
        self.check_command(command, expected, exit_code=native.returncode, absent=absent, exact=exact)

    def native_failure_command(self):
        executable = str(POWERSHELL).replace("'", "''")
        return "& '" + executable + "' -NoLogo -NoProfile -NonInteractive -Command 'exit 9'"

    def test_目录对象及后续存在性文本完整输出(self):
        self.check_command("Get-ChildItem -Force | Select-Object Name,Mode; Write-Output ('CONFIG_EXISTS=' + (Test-Path -LiteralPath './config.toml'))",
                           ['Name', 'Mode', 'config.toml', 'CONFIG_EXISTS=True'])

    def test_中文对象使用默认表格格式化(self):
        self.check_command("[pscustomobject]@{Name='中文对象'; Exists=$true} | Select-Object Name,Exists",
                           ['Name', 'Exists', '中文对象', 'True'])

    def test_显式列表和JSON输出保持原样(self):
        self.check_command("[pscustomobject]@{Name='中文列表'} | Format-List; @{Name='中文JSON'} | ConvertTo-Json -Compress",
                           ['Name', '中文列表', '{"Name":"中文JSON"}'])

    def test_进度不混入日志且保留中文警告错误及信息(self):
        self.check_command("Write-Progress -Activity '不应显示的进度' -Status '执行中'; Write-Warning '中文警告'; Write-Error '中文错误'; Write-Information '中文信息' -InformationAction Continue; Write-Output '继续执行'",
                           ['中文警告', '中文错误', '中文信息', '继续执行'], absent=['不应显示的进度'])

    def test_显式退出保留文本和退出码(self):
        self.check_native_result("Write-Output '退出前文本'; exit 7", ['退出前文本'], exit_code=7)

    def test_外部程序失败遵循原生CLI返回非零状态(self):
        self.check_native_result(self.native_failure_command(), [], exit_code=1)

    def test_显式传出外部程序原始退出码(self):
        self.check_native_result(self.native_failure_command()+"; exit $LASTEXITCODE", [], exit_code=9)

    def test_外部程序失败后成功命令不被残留退出码覆盖(self):
        self.check_native_result(self.native_failure_command()+"; Write-Output '恢复成功'",
                                 ['恢复成功'], exit_code=0)

    def test_终止异常返回非零退出码和中文错误(self):
        self.check_native_result("throw '中文异常'", ['中文异常'], exit_code=1)

    def test_return正常完成对象格式化(self):
        self.check_native_result("[pscustomobject]@{Name='返回前对象'}; return; Write-Output '不应执行'",
                                 ['返回前对象'], exit_code=0, absent=['不应执行'])

    def test_中文特殊路径及多行内容读取(self):
        (Path(self.directory.name) / '中文 文件 [1]&.txt').write_text('第一行\n第二行\n', encoding='utf-8')
        self.check_command("Get-Content -LiteralPath './中文 文件 [1]&.txt' -Encoding UTF8; Test-Path -LiteralPath './中文 文件 [1]&.txt'",
                           [], exact='第一行\n第二行\nTrue\n')

    def test_常见过滤排序和计数管道(self):
        self.check_command("'beta','alpha','beta','gamma' | Where-Object { $_ -ne 'gamma' } | Sort-Object -Unique; ('one','two','three' | Measure-Object).Count",
                           [], exact='alpha\nbeta\n3\n')

    def test_文件哈希读取完整值(self):
        expected = hashlib.sha256((Path(self.directory.name) / 'config.toml').read_bytes()).hexdigest().upper()
        self.check_command("(Get-FileHash -LiteralPath './config.toml' -Algorithm SHA256).Hash",
                           [], exact=expected+'\n')

    def test_空输出与不存在路径明确区分(self):
        self.check_command("Get-ChildItem -Filter '*.does-not-exist'", [], exact='')
        self.check_command("Test-Path -LiteralPath './does-not-exist'", [], exact='False\n')

    def test_文件重定向后内容可正常读取(self):
        self.check_command("Write-Output '中文重定向' > './redirect.txt'; Get-Content -LiteralPath './redirect.txt'",
                           [], exact='中文重定向\n')

    def test_普通文本在任务结束之前实时输出(self):
        command = "Write-Output '开始输出'; Start-Sleep -Milliseconds 1600; Write-Output '结束输出'"
        for runtime, argv in self.command_arguments(command).items():
            with self.subTest(runtime=runtime):
                process = subprocess.Popen([POWERSHELL, *argv], cwd=self.directory.name,
                                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                try:
                    # 首行必须在子进程结束之前可见，不能等待整段任务结束后统一格式化。
                    import queue
                    import threading
                    first_line = queue.Queue()
                    threading.Thread(target=lambda: first_line.put(process.stdout.readline()), daemon=True).start()
                    self.assertEqual(first_line.get(timeout=10).decode('utf-8').strip(), '开始输出')
                    self.assertIsNone(process.poll())
                    remainder, _ = process.communicate(timeout=10)
                    self.assertEqual(process.returncode, 0)
                    self.assertEqual(remainder.decode('utf-8').strip(), '结束输出')
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait(timeout=5)
                    process.stdout.close()

    def test_最后一条命令失败返回原生非零退出码(self):
        self.check_native_result("Get-Content -LiteralPath './executor-does-not-exist'",
                                 ['executor-does-not-exist'], exit_code=1)

    def test_不存在的命令返回原生失败状态(self):
        self.check_native_result('executor-command-does-not-exist', ['executor-command-does-not-exist'], exit_code=1)

    def test_非终止错误结束时失败但用户继续成功时恢复成功(self):
        self.check_native_result("Write-Error '非终止错误'", ['非终止错误'], exit_code=1)
        self.check_native_result("Write-Error '非终止错误'; Write-Output '继续成功'",
                                 ['非终止错误', '继续成功'], exit_code=0)

    def test_静默错误保留用户策略且最终状态仍表示失败(self):
        self.check_native_result("$ErrorActionPreference='SilentlyContinue'; Get-Content -LiteralPath './executor-does-not-exist'",
                                 [], exit_code=1, exact='')

    def test_用户忽略错误后继续执行不会被强制终止(self):
        self.check_native_result("Get-Content -LiteralPath './executor-does-not-exist' -ErrorAction Ignore; Write-Output '用户继续'",
                                 ['用户继续'], exit_code=0, absent=['executor-does-not-exist'])

    def test_用户指定Stop后停止执行并返回失败(self):
        self.check_native_result("Get-Content -LiteralPath './executor-does-not-exist' -ErrorAction Stop; Write-Output '不应执行'",
                                 ['executor-does-not-exist'], exit_code=1, absent=['不应执行\n'])


if __name__ == '__main__':
    unittest.main()
