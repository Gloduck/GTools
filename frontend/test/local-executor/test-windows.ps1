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
& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $TestRoot 'test-powershell-lifecycle.ps1')))) -ExecutorRoot $ExecutorRoot
& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $TestRoot 'test-download.ps1')))) -ExecutorRoot $ExecutorRoot
$utf8 = New-Object Text.UTF8Encoding($false)
$origin = 'https://local-executor-test.example'
$directory = Join-Path ([IO.Path]::GetTempPath()) ('executor 测试 & '+[Guid]::NewGuid().ToString('N'))
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
            # 覆盖目录查询的对象输出，避免只测试 Write-Output 而漏掉默认格式化丢失。
            $fixture = Join-Path $directory 'executor-object-check.txt'
            [IO.File]::WriteAllText($fixture,'测试对象输出',$utf8)
            $id = [Guid]::NewGuid().ToString('N')
            $command = "Get-ChildItem -LiteralPath . -Force | Select-Object Name,Mode; Write-Output ('FILE_EXISTS=' + (Test-Path -LiteralPath './executor-object-check.txt')); Write-Progress -Activity '不应显示的进度' -Status '执行中'; Write-Warning '中文警告'; Write-Error '中文错误'; Write-Output '后续文本'"
            [void](Request-Api POST /v1/tasks @{id=$id; command=$command; shell='powershell'; cwd=$directory})
            $task = Wait-Task $id
            Assert-True ($task.exit_code -eq 0 -and $task.status -eq 'completed') '对象输出任务正常结束'
            foreach ($text in @('Name','Mode','executor-object-check.txt','FILE_EXISTS=True','中文警告','中文错误','后续文本')) {
                Assert-True ($task.output.Contains($text)) "对象及普通文本完整输出：$text"
            }
            foreach ($text in @('#< CLIXML','<Objs ','不应显示的进度',[string][char]0xFFFD)) {
                Assert-True (-not $task.output.Contains($text)) "输出不包含序列化进度或乱码：$text"
            }
            Write-Output "场景通过：$runtime 对象格式化、后续文本、中文错误及进度处理"
            # 正文同时包含 here-string、引号和末尾反斜杠，检查 Windows argv 引用未改写命令。
            $literal = '中文😀 "双引号" \"引用" C:\目录\ & | % $ ` #< CLIXML <Objs>原文</Objs>'
            $command = '$value = @' + "'" + "`n" + $literal + "`n'@`n" + '$value' + "`nWrite-Output C:\`n"
            $id = [Guid]::NewGuid().ToString('N')
            [void](Request-Api POST /v1/tasks @{id=$id; command=$command; shell='powershell'; cwd=$directory})
            $task = Wait-Task $id
            Assert-True ($task.output.Replace("`r`n", "`n") -ceq ($literal + "`nC:\`n")) '复杂命令正文和输出原样往返'
            Assert-True (-not $task.decoding_loss -and $task.exit_code -eq 0) '合法字符不产生解码损失'

            # 同一输出中混合合法替换字符和真正非法字节；损失标记独立于命令退出码。
            $command = '[byte[]]$bytes = [Text.Encoding]::UTF8.GetBytes("😀�中文") + [byte[]]@(255,226,130); [Console]::OpenStandardOutput().Write($bytes,0,$bytes.Length)'
            $id = [Guid]::NewGuid().ToString('N')
            [void](Request-Api POST /v1/tasks @{id=$id; command=$command; shell='powershell'; cwd=$directory})
            $task = Wait-Task $id
            Assert-True ($task.output -ceq '😀�中文��' -and $task.decoding_loss -and $task.exit_code -eq 0) '解码损失与退出码分别保留'
            $page = Request-Api GET ('/v1/tasks/' + $id + '?cursor=0&max_chars=1')
            Assert-True ($page.output -ceq '😀' -and $page.has_more -and $page.decoding_loss) '分页按完整字符返回并保留损失标记'
            Write-Output "场景通过：$runtime 命令引用、完整字符分页及解码损失标记"
            # 任务状态遵循原生 PowerShell CLI，不用历史 LASTEXITCODE 推断最后一条命令。
            $nativeFailure = '& '+(Quote-Ps (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'))+" -NoLogo -NoProfile -NonInteractive -Command 'exit 9'"
            $resultCases = @(
                @{Name='最后读取失败'; Command="Get-Content -LiteralPath './executor-does-not-exist'"; Code=1; Text='executor-does-not-exist'},
                @{Name='非终止错误后继续成功'; Command="Write-Error '预期错误'; Write-Output '恢复成功'"; Code=0; Text='恢复成功'},
                @{Name='静默失败仍返回失败'; Command="`$ErrorActionPreference='SilentlyContinue'; Get-Content -LiteralPath './executor-does-not-exist'"; Code=1; Text=''},
                @{Name='外部失败遵循CLI状态'; Command=$nativeFailure; Code=1; Text=''},
                @{Name='显式传出外部原始退出码'; Command=$nativeFailure+'; exit $LASTEXITCODE'; Code=9; Text=''},
                @{Name='外部失败后继续成功'; Command=$nativeFailure+"; Write-Output '恢复成功'"; Code=0; Text='恢复成功'}
            )
            foreach ($case in $resultCases) {
                $id = [Guid]::NewGuid().ToString('N')
                [void](Request-Api POST /v1/tasks @{id=$id; command=$case.Command; shell='powershell'; cwd=$directory})
                $task = Wait-Task $id
                $expectedStatus = if ($case.Code -eq 0) { 'completed' } else { 'failed' }
                Assert-True ($task.exit_code -eq $case.Code -and $task.status -eq $expectedStatus) ("PowerShell 状态："+$case.Name)
                if ($case.Text) { Assert-True ($task.output.Contains($case.Text)) ("PowerShell 输出："+$case.Name) }
            }
            Write-Output "场景通过：$runtime PowerShell 原生退出状态及用户错误策略"
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
