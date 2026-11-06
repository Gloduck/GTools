# Windows 原生回归测试：仅需系统 PowerShell；可选指定已有 Python，同时检查 Python 执行端。
param(
    [string]$ExecutorRoot = (Join-Path $PSScriptRoot '../../public/local-executor/v1'),
    [string]$PythonPath = '',
    [string]$TestRoot = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw '此测试需要真实 Windows；其他系统请运行 check-powershell.ps1 和 test-download.ps1。' }
$ExecutorRoot = (Resolve-Path -LiteralPath $ExecutorRoot).ProviderPath
& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $TestRoot 'check-powershell.ps1')))) -ExecutorRoot $ExecutorRoot -TestRoot $TestRoot
& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $TestRoot 'test-download.ps1')))) -ExecutorRoot $ExecutorRoot
$utf8 = New-Object Text.UTF8Encoding($false)
$origin = 'https://local-executor-test.example'
$directory = Join-Path ([IO.Path]::GetTempPath()) ('gtools 测试 & '+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($directory)
function Quote-Ps([string]$Value) { return "'"+$Value.Replace("'","''")+"'" }
function Assert-True($Value, [string]$Message) { if (-not $Value) { throw "场景失败：$Message" } }
function Request-Api([string]$Method, [string]$Path, $Body=$null, [int]$Status=200, [string]$RequestOrigin=$origin, [string]$Token=$connection.token) {
    $request = [Net.HttpWebRequest]::Create($connection.url+$Path)
    $request.Method = $Method
    $request.Proxy = $null
    $request.Timeout = 10000
    $request.Headers['Origin'] = $RequestOrigin
    $request.Headers['Authorization'] = 'Bearer '+$Token
    if ($null -ne $Body) {
        $bytes = $utf8.GetBytes((ConvertTo-Json -InputObject $Body -Compress))
        $request.ContentType = 'application/json'
        $request.ContentLength = $bytes.Length
        $stream = $request.GetRequestStream()
        try { $stream.Write($bytes,0,$bytes.Length) } finally { $stream.Dispose() }
    }
    try { $response = $request.GetResponse() } catch [Net.WebException] {
        if (-not $_.Exception.Response) { throw }
        $response = $_.Exception.Response
    }
    try {
        Assert-True ([int]$response.StatusCode -eq $Status) "$Method $Path HTTP 状态应为 $Status，实际为 $([int]$response.StatusCode)"
        $reader = New-Object IO.StreamReader($response.GetResponseStream(),$utf8)
        try { return ConvertFrom-Json -InputObject $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $response.Dispose() }
}
function Wait-Task([string]$Id) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $task = Request-Api GET ('/v1/tasks/'+$Id)
        if ($task.status -in @('completed','failed','cancelled')) { return $task }
        Start-Sleep -Milliseconds 50
    } while ([DateTime]::UtcNow -lt $deadline)
    throw '场景失败：等待测试任务结束超时'
}
$runtimes = @('powershell')
if ($PythonPath) { $runtimes += 'python'; $PythonPath = (Resolve-Path -LiteralPath $PythonPath).ProviderPath }
try {
    foreach ($runtime in $runtimes) {
        $process = New-Object Diagnostics.Process
        $start = New-Object Diagnostics.ProcessStartInfo
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.StandardOutputEncoding = $utf8
        $start.StandardErrorEncoding = $utf8
        $start.WorkingDirectory = $directory
        if ($runtime -eq 'powershell') {
            $start.FileName = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
            $source = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; & ([scriptblock]::Create([IO.File]::ReadAllText('+ (Quote-Ps (Join-Path $ExecutorRoot 'executor.ps1')) +'))) -Origin '+(Quote-Ps $origin)
            $start.Arguments = '-NoLogo -NoProfile -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($source))
        } else {
            $start.FileName = $PythonPath
            $start.Arguments = '-B -u "'+(Join-Path $ExecutorRoot 'executor.py')+'" --origin '+$origin
        }
        $process.StartInfo = $start
        $started = $false
        try {
            $started = $process.Start()
            $errors = $process.StandardError.ReadToEndAsync()
            $line = $process.StandardOutput.ReadLineAsync()
            if (-not $line.Wait(20000) -or -not $line.Result) {
                $detail = if ($errors.IsCompleted) { $errors.Result } else { '启动超时' }
                throw "执行端未返回连接信息：$detail"
            }
            $connection = ConvertFrom-Json -InputObject $line.Result
            $info = Request-Api GET /v1/info
            Assert-True ($info.runtime -eq $runtime -and $info.shells -contains 'cmd' -and $info.shells -contains 'powershell') '连接信息及两个 Shell'
            [void](Request-Api GET /v1/info -Status 401 -Token wrong)
            [void](Request-Api GET /v1/info -Status 403 -RequestOrigin 'https://evil.example')
            [void](Request-Api POST /v1/tasks @{id='invalid-shell'; command='echo hello'; shell=@()} -Status 400)
            foreach ($shell in @('powershell','cmd')) {
                $id = [Guid]::NewGuid().ToString('N')
                $command = if ($shell -eq 'cmd') {
                    "echo 中文执行成功`r`nset `"VALUE=包含 空格`"`r`necho %VALUE%`r`necho 引号与符号 ^& 完成`r`nexit /b 7"
                } else { "Write-Output '中文执行成功'; Write-Output '包含 空格'; Write-Output '引号与符号 & 完成'; exit 7" }
                [void](Request-Api POST /v1/tasks @{id=$id; command=$command; shell=$shell; cwd=$directory})
                $task = Wait-Task $id
                Assert-True ($task.exit_code -eq 7 -and $task.status -eq 'failed') "$shell 返回退出码"
                foreach ($text in @('中文执行成功','包含 空格','引号与符号 & 完成')) { Assert-True ($task.output.Contains($text)) "$shell 保留输出：$text" }
                # 同一任务编号不能通过更换 Shell 再次执行。
                $other = if ($shell -eq 'cmd') { 'powershell' } else { 'cmd' }
                [void](Request-Api POST /v1/tasks @{id=$id; command=$command; shell=$other; cwd=$directory} -Status 409)
                $id = [Guid]::NewGuid().ToString('N')
                $child = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output ("CHILD="+$PID); Start-Sleep -Seconds 60'
                $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($child))
                [void](Request-Api POST /v1/tasks @{id=$id; command=('powershell.exe -NoLogo -NoProfile -EncodedCommand '+$encoded); shell=$shell})
                $deadline = [DateTime]::UtcNow.AddSeconds(15)
                do {
                    $task = Request-Api GET ('/v1/tasks/'+$id)
                    if ($task.output -match 'CHILD=(\d+)') { break }
                    Start-Sleep -Milliseconds 50
                } while ([DateTime]::UtcNow -lt $deadline)
                Assert-True ($task.output -match 'CHILD=(\d+)') "$shell 子进程启动"
                $childId = [int]$Matches[1]
                [void](Request-Api POST ('/v1/tasks/'+$id+'/cancel') @{})
                $task = Wait-Task $id
                Assert-True ($task.status -eq 'cancelled') "$shell 取消任务"
                Start-Sleep -Milliseconds 200
                Assert-True (-not (Get-Process -Id $childId -ErrorAction SilentlyContinue)) "$shell 取消时清理子进程"
                Write-Output "场景通过：$runtime / $shell 中文、多行、路径空格和符号、退出码、取消及子进程清理"
            }
            $process.Kill()
            [void]$process.WaitForExit(10000)
            Assert-True ($errors.Wait(10000)) '终端日志读取结束'
            $terminalLog = $errors.Result
            foreach ($text in @('开始执行','中文执行成功','执行结束','退出码: 7')) { Assert-True ($terminalLog.Contains($text)) "终端记录：$text" }
            Assert-True (-not $terminalLog.Contains($connection.token)) '任务日志不包含连接凭据'
            Write-Output "场景通过：$runtime 回环服务鉴权、来源校验及终端日志"
        } finally {
            if ($started -and -not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(10000) }
            $process.Dispose()
        }
    }
} finally { Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue }
Write-Output '所有 Windows 原生测试通过。'
