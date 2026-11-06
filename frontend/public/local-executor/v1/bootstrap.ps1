param(
    [Parameter(Mandatory=$true)][string]$BaseUrl,
    [Parameter(Mandatory=$true)][string]$Origin,
    [string]$ListenAddress = '127.0.0.1',
    [int]$Port = 0,
    [string]$PublicUrl = '',
    [string]$Token = ''
)
$ErrorActionPreference='Stop'
if ($Token -and $Token -cnotmatch '\A[A-Za-z0-9_-]+\z') { throw 'Token must contain only letters, digits, underscores or hyphens.' }
$uri=[Uri]$BaseUrl
if ($uri.Scheme -ne 'https' -and -not ($uri.Scheme -eq 'http' -and $uri.Host -in @('127.0.0.1','localhost'))) { throw 'Use HTTPS for script downloads.' }
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
    if (-not $downloadUri -or ($downloadUri.Scheme -ne 'https' -and -not ($downloadUri.Scheme -eq 'http' -and $downloadUri.Host -in @('127.0.0.1','localhost')))) { throw 'Refusing an insecure script redirect' }
    # PS 5.1 对二进制 MIME 返回 byte[]；保存原始字节，避免数字列表和中文乱码。
    $bytes = $response.RawContentStream.ToArray()
    if ($bytes.Length -gt 524288) { throw 'Executor script is too large' }
    [IO.File]::WriteAllBytes($path, $bytes)
    if ($python) {
        $networkArgs = @('--listen-address', $ListenAddress, '--port', [string]$Port)
        if ($PublicUrl) { $networkArgs += @('--public-url', $PublicUrl) }
        if ($Token) { $networkArgs += @('--token='+$Token) }
        & $python @pythonArgs $path --origin $Origin @networkArgs
        if ($LASTEXITCODE -ne 0) { throw "Python executor exited with code $LASTEXITCODE." }
    } else {
        Write-Host 'Python 3 unavailable; using system Windows PowerShell.'
        & ([scriptblock]::Create([IO.File]::ReadAllText($path))) -Origin $Origin -ListenAddress $ListenAddress -Port $Port -PublicUrl $PublicUrl -Token $Token
    }
} finally {
    Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
}
