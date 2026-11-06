"""使用已有 PowerShell 验证两个执行端的真实命令包装，不启动 Windows 进程管理代码。"""
import base64
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


POWERSHELL = os.environ.get('GTOOLS_TEST_POWERSHELL') or shutil.which('powershell') or shutil.which('pwsh')
ROOT = Path(__file__).resolve().parents[2] / 'public/local-executor/v1'
spec = importlib.util.spec_from_file_location('gtools_executor_output', ROOT / 'executor.py')
executor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(executor)


@unittest.skipUnless(POWERSHELL, '未找到 PowerShell，可通过 GTOOLS_TEST_POWERSHELL 指定已有环境')
class PowerShellOutputTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 只加载降级端生成启动参数的函数，测试不监听端口，也不调用 Windows API。
        source = r"""
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:GTOOLS_TEST_EXECUTOR_PS1, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw '执行端语法错误' }
$function = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'New-PowerShellTaskArguments'
}, $true)
if (-not $function) { throw '未找到命令包装函数' }
. ([scriptblock]::Create($function.Extent.Text))
New-PowerShellTaskArguments '__GTOOLS_OUTPUT_TEST_COMMAND__'
"""
        result = subprocess.run(
            [POWERSHELL, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
             base64.b64encode(source.encode('utf-16le')).decode()],
            env={**os.environ, 'GTOOLS_TEST_EXECUTOR_PS1': str(ROOT / 'executor.ps1')},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        if result.returncode:
            raise RuntimeError('加载命令包装函数失败：' + result.stderr.decode('utf-8', errors='replace'))
        cls.fallback_arguments = result.stdout.decode('utf-8').strip().split()
        cls.fallback_script = base64.b64decode(cls.fallback_arguments[-1]).decode('utf-16le')

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='gtools-output-')
        self.addCleanup(self.directory.cleanup)
        (Path(self.directory.name) / 'config.toml').write_text('name = "测试"', encoding='utf-8')

    def check_command(self, command, expected, exit_code=0, absent=()):
        fallback_script = self.fallback_script.replace('__GTOOLS_OUTPUT_TEST_COMMAND__', command)
        arguments = {
            'Python 执行端': executor.powershell_arguments(command),
            'PowerShell 执行端': self.fallback_arguments[:-1] + [base64.b64encode(fallback_script.encode('utf-16le')).decode()],
        }
        for runtime, argv in arguments.items():
            with self.subTest(runtime=runtime):
                result = subprocess.run([POWERSHELL, *argv], cwd=self.directory.name,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
                output = result.stdout.decode('utf-8')
                self.assertEqual(result.returncode, exit_code, output)
                for value in expected:
                    self.assertIn(value, output)
                for value in ('#< CLIXML', '<Objs ', '\ufffd', *absent):
                    self.assertNotIn(value, output)

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
        self.check_command("Write-Output '退出前文本'; exit 7", ['退出前文本'], exit_code=7)

    def test_外部程序失败不会被格式化管道掩盖(self):
        executable = str(POWERSHELL).replace("'", "''")
        self.check_command("& '" + executable + "' -NoLogo -NoProfile -NonInteractive -Command 'exit 9'", [], exit_code=9)

    def test_终止异常返回非零退出码和中文错误(self):
        self.check_command("throw '中文异常'", ['中文异常'], exit_code=1)

    def test_return正常完成对象格式化(self):
        self.check_command("[pscustomobject]@{Name='返回前对象'}; return; Write-Output '不应执行'",
                           ['返回前对象'], absent=['不应执行'])


if __name__ == '__main__':
    unittest.main()
