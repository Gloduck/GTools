# 使用内存响应复现二进制 MIME，不访问公网，也不安装运行环境。
param([string]$ExecutorRoot = (Join-Path $PSScriptRoot '../../public/local-executor/v1'))
$ErrorActionPreference = 'Stop'
$bootstrap = [scriptblock]::Create([IO.File]::ReadAllText((Join-Path $ExecutorRoot 'bootstrap.ps1')))
foreach ($runtime in @('powershell', 'python')) {
    foreach ($responseVersion in @(5, 7)) {
        foreach ($tokenCase in @('', 'x', 'short', '-short', ('A'*129), ('B'*1024))) {
        & {
            $script:downloaded = $false
            $script:executed = $false
            $script:downloadPath = $null
            $script:payload = "param([string]`$Origin,[string]`$ListenAddress,[int]`$Port,[string]`$PublicUrl,[string]`$Token='')`nif (`$ListenAddress -ne '192.168.1.25' -or `$Port -ne 8321 -or `$PublicUrl -ne 'https://executor.example') { throw '监听参数传递错误' }; if (`$Origin -ne 'https://example.test') { throw '参数传递错误' }; if (`$Token -cne '$tokenCase') { throw '自定义凭据传递错误' }; '中文下载成功'"
            function Get-Command {
                param($Name, $CommandType, $ErrorAction)
                if ($runtime -eq 'python') { [pscustomobject]@{Source='Test-Python'} }
            }
            function Test-Python {
                if ($args[0] -ne '-c') {
                    $script:downloadPath = $args[0]
                    if ([IO.File]::ReadAllText($args[0]) -cne $script:payload) { throw 'Python 下载字节发生改变' }
                    $expected = @{ '--origin'='https://example.test'; '--listen-address'='192.168.1.25'; '--port'='8321'; '--public-url'='https://executor.example' }
                    foreach ($name in $expected.Keys) {
                        $index = [Array]::IndexOf([object[]]$args,$name)
                        if ($index -lt 0 -or $index+1 -ge $args.Count -or [string]$args[$index+1] -cne $expected[$name]) { throw 'Python 启动参数传递错误' }
                    }
                    # 空值允许省略参数或显式传空；自定义值必须逐字传递，不能重新生成。
                    $tokenArguments = @($args | Where-Object { $_ -is [string] -and $_.StartsWith('--token=') })
                    if ($tokenCase -and $tokenArguments.Count -ne 1) { throw 'Python 未以独立参数传递自定义凭据' }
                    if ($tokenArguments.Count -gt 1 -or ($tokenArguments.Count -eq 1 -and $tokenArguments[0] -cne ('--token='+$tokenCase))) { throw 'Python 凭据内容发生改变' }
                    if ([Array]::IndexOf([object[]]$args,'--token') -ge 0) { throw 'Python 凭据应使用等号参数以支持连字符开头的值' }
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
            $output = & $bootstrap -BaseUrl 'https://example.test/local-executor/v1' -Origin 'https://example.test' -ListenAddress '192.168.1.25' -Port 8321 -PublicUrl 'https://executor.example' -Token $tokenCase
            if (-not $script:downloaded) { throw '未下载执行器' }
            if ($runtime -eq 'powershell' -and $output -cne '中文下载成功') { throw 'PowerShell 下载解析失败' }
            if ($runtime -eq 'python' -and (-not $script:executed -or (Test-Path -LiteralPath $script:downloadPath))) { throw 'Python 下载执行或临时目录清理失败' }
        }
        $tokenMode = if ($tokenCase) { '自定义凭据（长度 '+$tokenCase.Length+'）' } else { '随机凭据' }
        Write-Output "场景通过：$runtime 下载保留 UTF-8 字节，兼容 PowerShell $responseVersion 响应，$tokenMode 参数传递"
        }
    }
}

# 非法凭据应在下载、路径解析或监听之前拒绝，不让回归测试意外启动服务。
$executor = [scriptblock]::Create([IO.File]::ReadAllText((Join-Path $ExecutorRoot 'executor.ps1')))
foreach ($invalidToken in @("x`n", "x`r`n", 'x ', 'x+', 'x/', 'x中')) {
    foreach ($entry in @('bootstrap','executor')) {
        & {
            function Get-Command { throw '凭据校验前不应查找运行时' }
            function Resolve-Path { throw '凭据校验前不应解析执行目录' }
            $rejected = $false
            try {
                if ($entry -eq 'bootstrap') {
                    & $bootstrap -BaseUrl 'https://example.test/local-executor/v1' -Origin 'https://example.test' -Token $invalidToken
                } else {
                    & $executor -Origin 'https://example.test' -Token $invalidToken
                }
            } catch {
                if ($_.Exception.Message -notlike 'Token must contain*') { throw }
                $rejected = $true
            }
            if (-not $rejected) { throw '非法凭据未被拒绝' }
        }
    }
}
Write-Output '场景通过：PowerShell 启动入口与执行端拒绝非法字符及尾部换行'
