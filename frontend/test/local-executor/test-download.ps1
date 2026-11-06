# 使用内存响应复现二进制 MIME，不访问公网，也不安装运行环境。
param([string]$ExecutorRoot = (Join-Path $PSScriptRoot '../../public/local-executor/v1'))
$ErrorActionPreference = 'Stop'
$bootstrap = [scriptblock]::Create([IO.File]::ReadAllText((Join-Path $ExecutorRoot 'bootstrap.ps1')))
foreach ($runtime in @('powershell', 'python')) {
    foreach ($responseVersion in @(5, 7)) {
        & {
            $script:downloaded = $false
            $script:executed = $false
            $script:downloadPath = $null
            $script:payload = "param([string]`$Origin,[string]`$ListenAddress,[int]`$Port,[string]`$PublicUrl)`nif (`$ListenAddress -ne '192.168.1.25' -or `$Port -ne 8321 -or `$PublicUrl -ne 'https://executor.example') { throw '监听参数传递错误' }; if (`$Origin -ne 'https://example.test') { throw '参数传递错误' }; '中文下载成功'"
            function Get-Command {
                param($Name, $CommandType, $ErrorAction)
                if ($runtime -eq 'python') { [pscustomobject]@{Source='Test-Python'} }
            }
            function Test-Python {
                if ($args[0] -ne '-c') {
                    $script:downloadPath = $args[0]
                    if ([IO.File]::ReadAllText($args[0]) -cne $script:payload) { throw 'Python 下载字节发生改变' }
                    if (($args -join '|') -notlike '*--listen-address|192.168.1.25|--port|8321|--public-url|https://executor.example') { throw 'Python 监听参数传递错误' }
                    $script:executed = $true
                }
                $global:LASTEXITCODE = 0
            }
            function Invoke-WebRequest {
                param([switch]$UseBasicParsing, $Uri, $TimeoutSec)
                $expected = if ($runtime -eq 'python') { 'executor.py' } else { 'executor.ps1' }
                if (-not $Uri.EndsWith('/'+$expected)) { throw '下载路径错误' }
                $script:downloaded = $true
                $bytes = [Text.Encoding]::UTF8.GetBytes($script:payload)
                $response = if ($responseVersion -eq 5) { @{ResponseUri=[Uri]$Uri} } else { @{RequestMessage=@{RequestUri=[Uri]$Uri}} }
                [pscustomobject]@{Content=$bytes; RawContentStream=[IO.MemoryStream]::new($bytes); BaseResponse=[pscustomobject]$response}
            }
            $output = & $bootstrap -BaseUrl 'https://example.test/local-executor/v1' -Origin 'https://example.test' -ListenAddress '192.168.1.25' -Port 8321 -PublicUrl 'https://executor.example'
            if (-not $script:downloaded) { throw '未下载执行器' }
            if ($runtime -eq 'powershell' -and $output -cne '中文下载成功') { throw 'PowerShell 下载解析失败' }
            if ($runtime -eq 'python' -and (-not $script:executed -or (Test-Path -LiteralPath $script:downloadPath))) { throw 'Python 下载执行或临时目录清理失败' }
        }
        Write-Output "场景通过：$runtime 下载保留 UTF-8 字节，兼容 PowerShell $responseVersion 响应"
    }
}
