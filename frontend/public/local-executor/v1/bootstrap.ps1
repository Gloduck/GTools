param(
    [Parameter(Mandatory=$true)][string]$BaseUrl,
    [Parameter(Mandatory=$true)][string]$Origin,
    [string]$ListenAddress = '127.0.0.1',
    [int]$Port = 0,
    [string]$PublicUrl = '',
    [string]$Token = '',
    [ValidateSet('zh-CN','en-US')][string]$Language = 'en-US'
)
$ErrorActionPreference='Stop'
function Get-LauncherText([string]$Chinese, [string]$English) {
    if ($Language -eq 'zh-CN') { return $Chinese }
    return $English
}
if ($Token -and $Token -cnotmatch '\A[A-Za-z0-9_-]+\z') { throw (Get-LauncherText 'Token 只能包含字母、数字、下划线或连字符。' 'Token must contain only letters, digits, underscores or hyphens.') }
$uri=[Uri]$BaseUrl
if ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.Host -in @('127.0.0.1','localhost'))) { throw (Get-LauncherText '请使用 HTTPS 下载脚本。' 'Use HTTPS for script downloads.') }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$python=$null
$pythonArgs=@()
foreach ($candidate in @('python3','python','py')) {
    $command=Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue
    if (-not $command -or $command.Source -match '\\Microsoft\\WindowsApps\\') { continue }
    $testArgs=@()
    if ($candidate -eq 'py') { $testArgs=@('-3') }
    try {
        & $command.Source @testArgs -c 'import sys; sys.exit(sys.version_info < (3,8))' 2>$null
        if ($LASTEXITCODE -eq 0) { $python=$command.Source; $pythonArgs=$testArgs; break }
    } catch {}
}
$directory=Join-Path ([IO.Path]::GetTempPath()) ('executor-bootstrap-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($directory)
try {
    $file=if($python){'executor.py'}else{'executor.ps1'}
    $path=Join-Path $directory $file
    $response=Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl.TrimEnd('/')+'/'+$file) -TimeoutSec 30
    $downloadUri = $response.BaseResponse.ResponseUri
    if (-not $downloadUri) { $downloadUri = $response.BaseResponse.RequestMessage.RequestUri }
    if (-not $downloadUri -or ($downloadUri.Scheme -ne 'https' -and -not ($downloadUri.Scheme -eq 'http' -and $downloadUri.Host -in @('127.0.0.1','localhost')))) { throw (Get-LauncherText '拒绝不安全的脚本下载重定向' 'Refusing an insecure script redirect') }
    # PS 5.1 对二进制 MIME 返回 byte[]；保存原始字节，避免数字列表和中文乱码。
    $bytes = $response.RawContentStream.ToArray()
    if ($bytes.Length -gt 524288) { throw (Get-LauncherText '执行器脚本过大' 'Executor script is too large') }
    [IO.File]::WriteAllBytes($path, $bytes)
    if ($python) {
        $networkArgs = @('--listen-address', $ListenAddress, '--port', [string]$Port, '--language', $Language)
        if ($PublicUrl) { $networkArgs += @('--public-url', $PublicUrl) }
        if ($Token) { $networkArgs += @('--token='+$Token) }
        & $python @pythonArgs $path --origin $Origin @networkArgs
        if ($LASTEXITCODE -ne 0) { throw (Get-LauncherText "Python 执行器已退出，退出码 $LASTEXITCODE。" "Python executor exited with code $LASTEXITCODE.") }
    } else {
        Write-Host (Get-LauncherText '未找到 Python 3，将使用系统 Windows PowerShell。' 'Python 3 unavailable; using system Windows PowerShell.')
        # 每次使用独立进程，停止后直接释放 Add-Type 类型，不在当前会话复用旧实现。
        $powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $parameters = @{Origin=$Origin; Cwd=(Get-Location).Path; ListenAddress=$ListenAddress; Port=$Port; PublicUrl=$PublicUrl; Token=$Token; Language=$Language}
        $launch = "`$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(`$false); & ([scriptblock]::Create([IO.File]::ReadAllText('"+$path.Replace("'","''")+"')))"
        # 按 PowerShell 字符串字面量传参，保留空值及以连字符开头的凭据。
        foreach ($entry in $parameters.GetEnumerator()) {
            $launch += " -"+$entry.Key+" '"+([string]$entry.Value).Replace("'","''")+"'"
        }
        # 不让 PowerShell 的错误上下文回显含凭据的启动表达式。
        $launch = "try { $launch } catch { [Console]::Error.WriteLine(`$_.Exception.Message); exit 1 }"
        $previousEncoding = [Console]::OutputEncoding
        try {
            [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
            & $powershell -NoLogo -NoProfile -NonInteractive -OutputFormat Text -Command $launch
            if ($LASTEXITCODE -ne 0) { throw (Get-LauncherText "PowerShell 执行器已退出，退出码 $LASTEXITCODE。" "PowerShell executor exited with code $LASTEXITCODE.") }
        } finally {
            [Console]::OutputEncoding = $previousEncoding
        }
    }
} finally {
    Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
}
