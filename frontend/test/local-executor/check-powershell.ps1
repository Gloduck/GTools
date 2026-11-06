# 仅检查脚本语法和内联系统 API 辅助代码的编译，不在非 Windows 系统执行命令。
param([string]$ExecutorRoot = (Join-Path $PSScriptRoot '../../public/local-executor/v1'), [string]$TestRoot = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
foreach ($name in @('executor.ps1', 'bootstrap.ps1')) {
    $path = (Resolve-Path (Join-Path $ExecutorRoot $name)).ProviderPath
    $tokens = $null
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { $errors | Format-List; throw "场景失败：PowerShell 语法校验：$name" }
    Write-Output "场景通过：PowerShell 语法校验：$name"
    $types = $ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Add-Type'
    }, $true)
    foreach ($type in $types) {
        $source = $type.CommandElements | Where-Object { $_ -is [System.Management.Automation.Language.StringConstantExpressionAst] } | Select-Object -Last 1
        Add-Type -TypeDefinition $source.Value
        Write-Output '场景通过：系统进程管理辅助代码编译'
    }
}

foreach ($name in @('test-download.ps1', 'test-windows.ps1')) {
    $tokens = $null
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $TestRoot $name), [ref]$tokens, [ref]$errors)
    if ($errors.Count) { $errors | Format-List; throw "场景失败：测试脚本语法校验：$name" }
    Write-Output "场景通过：测试脚本语法校验：$name"
}

# 只验证输出缓存与终端日志，不调用 Windows 原生进程 API。
$task = New-Object GToolsLocalTaskV3
$task.Id = 'console-test'
$capture = New-Object IO.StringWriter
$previousError = [Console]::Error
try {
    [Console]::SetError($capture)
    $characters = '中文日志'.ToCharArray()
    $arguments = New-Object object[] 2
    $arguments[0] = $characters
    $arguments[1] = $characters.Length
    $append = [GToolsLocalTaskV3].GetMethod('AppendOutput', [Reflection.BindingFlags]'Instance,NonPublic')
    [void]$append.Invoke($task,$arguments)
    $task.Status = 'completed'
    $task.ExitCode = 0
    [void][GToolsLocalTaskV3].GetMethod('LogCompletion', [Reflection.BindingFlags]'Instance,NonPublic').Invoke($task,@())
    if (-not [GToolsTerminalLogV3]::Flush(3000)) { throw '场景失败：终端日志未完成写入' }
    if (-not $capture.ToString().Contains('[console-test] 中文日志')) { throw '场景失败：命令输出未写入终端' }
    if (-not $capture.ToString().Contains('执行结束 | 状态: completed | 退出码: 0')) { throw '场景失败：结束状态未写入终端' }
    if ($task.Snapshot(0).output -cne '中文日志') { throw '场景失败：终端输出影响了 AI 工具结果' }
} finally { [Console]::SetError($previousError); $capture.Dispose() }
Write-Output '场景通过：终端实时日志与 AI 结果同时保留中文，结束状态和退出码正确'
