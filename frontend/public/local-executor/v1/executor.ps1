# Windows PowerShell 5.1 降级实现，不下载二进制程序或第三方模块。
param(
    [Parameter(Mandatory=$true)][string]$Origin,
    [string]$Cwd = (Get-Location).Path,
    [int]$Port = 0,
    [string]$ListenAddress = '127.0.0.1',
    [string]$PublicUrl = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$originUri = [Uri]$Origin
if ($originUri.Scheme -notin @('http','https') -or $originUri.UserInfo -or $originUri.AbsolutePath -ne '/' -or $originUri.Query -or $originUri.Fragment) { throw 'Origin must be a web origin.' }
$Origin = $Origin.TrimEnd('/')
$Cwd = (Resolve-Path -LiteralPath $Cwd).ProviderPath
if (-not [IO.Directory]::Exists($Cwd)) { throw 'Working directory must be a filesystem directory.' }
if ($Port -lt 0 -or $Port -gt 65535) { throw 'Invalid port.' }
$listenIp = $null
if ($ListenAddress -notmatch '^[0-9a-fA-F:.]+$' -or -not [Net.IPAddress]::TryParse($ListenAddress, [ref]$listenIp)) { throw 'ListenAddress must be an IPv4 or IPv6 address.' }
if ($listenIp.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $ListenAddress -cne $listenIp.ToString()) { throw 'Use a full dotted IPv4 address.' }
$ListenAddress = $listenIp.ToString()
$wildcard = $ListenAddress -in @('0.0.0.0','::')
if ($listenIp.IsIPv6Multicast -or ($listenIp.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $listenIp.GetAddressBytes()[0] -ge 224)) { throw 'ListenAddress must be a local unicast or wildcard IP address.' }
if ($PublicUrl) {
    $publicUri = [Uri]$PublicUrl
    if (-not $publicUri.IsAbsoluteUri -or $publicUri.Scheme -notin @('http','https') -or -not $publicUri.Host -or $publicUri.UserInfo -or $publicUri.AbsolutePath -ne '/' -or $publicUri.Query -or $publicUri.Fragment -or $publicUri.Host -in @('0.0.0.0','[::]') -or $publicUri.Port -eq 0 -or $PublicUrl.Contains('%')) { throw 'PublicUrl must be a reachable HTTP(S) origin without credentials or paths.' }
    $PublicUrl = $publicUri.GetLeftPart([UriPartial]::Authority)
}
if ($wildcard -and -not $PublicUrl) { throw 'PublicUrl is required when listening on all interfaces.' }


# 使用系统作业对象管理任务进程树。先创建挂起进程并加入作业，
# 再执行用户命令，避免后台子进程抢先脱离任务管理。
# 辅助类型带版本，重新启动时不会复用当前 PowerShell 会话中旧版的已编译类型。
if (-not ('ExecutorTaskV3' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
// 终端日志只是结果副本，独立线程和有界队列避免慢终端阻塞请求及输出采集。
public static class ExecutorTerminalLogV3 {
    static readonly object gate=new object();
    static readonly Queue<string> pending=new Queue<string>();
    const int Limit=262144;
    static int pendingChars;
    static long droppedChars;
    static bool writing;
    static ExecutorTerminalLogV3() {
        var worker=new Thread(WriteLoop); worker.IsBackground=true; worker.Start();
    }
    public static void Append(string text) {
        lock(gate) {
            if(text.Length>Limit) { droppedChars+=text.Length-Limit; text=text.Substring(text.Length-Limit); }
            while(pending.Count>0 && pendingChars+text.Length>Limit) {
                string removed=pending.Dequeue(); pendingChars-=removed.Length; droppedChars+=removed.Length;
            }
            pending.Enqueue(text); pendingChars+=text.Length; Monitor.PulseAll(gate);
        }
    }
    static void WriteLoop() {
        while(true) {
            string text; long dropped;
            lock(gate) {
                while(pending.Count==0) Monitor.Wait(gate);
                text=pending.Dequeue(); pendingChars-=text.Length;
                dropped=droppedChars; droppedChars=0; writing=true;
            }
            try {
                if(dropped>0) Console.Error.WriteLine("[Executor] 终端日志积压，已省略 "+dropped+" 字符；任务输出请以接口缓存为准。");
                Console.Error.Write(text); Console.Error.Flush();
            } catch(IOException) {} catch(ObjectDisposedException) {} catch(EncoderFallbackException) {}
            finally { lock(gate) { writing=false; Monitor.PulseAll(gate); } }
        }
    }
    public static bool Flush(int milliseconds) {
        var clock=System.Diagnostics.Stopwatch.StartNew();
        lock(gate) {
            while(pending.Count>0 || writing) {
                long left=milliseconds-clock.ElapsedMilliseconds;
                if(left<=0) return false;
                Monitor.Wait(gate,(int)left);
            }
            return true;
        }
    }
}
public sealed class ExecutorTaskV3 : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Security { public int size; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
        public int cb; public string reserved, desktop, title;
        public int x,y,xSize,ySize,xChars,yChars,fill,flags; public short show,reservedSize;
        public IntPtr reservedPtr, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
        public long processTime,jobTime; public uint flags; public UIntPtr minSet,maxSet;
        public uint processLimit; public UIntPtr affinity; public uint priority,scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong r,w,o,rb,wb,ob; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
        public BasicLimit basic; public IoCounters io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref Security attr,int size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,ref Security attr,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup si,out ProcessInfo pi);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attr,string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int kind,ref ExtendedLimit info,uint size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    readonly object gate = new object(); readonly StringBuilder output = new StringBuilder();
    IntPtr job, process; Thread reader; long outputStart; string stopReason;
    public string Id, Command, Cwd, Fingerprint, Shell, ScriptPath;
    public string Status = "queued", Error = "";
    public int? ExitCode; public bool Truncated; public double CreatedAt;
    const int Limit = 262144;
    bool completionLogged, processExited, outputFinished, readerStarted;
    void Log(string text) {
        if(String.IsNullOrEmpty(text)) return;
        ExecutorTerminalLogV3.Append("["+Id+"] "+text+(text.EndsWith("\n") ? "" : "\n"));
    }
    void LogCompletion() {
        if(completionLogged) return;
        completionLogged=true;
        Log("执行结束 | 状态: "+Status+" | 退出码: "+ExitCode+(String.IsNullOrEmpty(Error) ? "" : " | "+Error));
    }
    public void Start(string application, string arguments) {
        Log("开始执行 | Shell: "+Shell+" | 目录: "+Cwd+"\n"+Command);
        IntPtr read=IntPtr.Zero,write=IntPtr.Zero,input=IntPtr.Zero;
        Stream outputStream=null;
        ProcessInfo pi = new ProcessInfo();
        var security = new Security { size=Marshal.SizeOf(typeof(Security)), inherit=1 };
        try {
            job=CreateJobObject(IntPtr.Zero,null);
            var limits=new ExtendedLimit(); limits.basic.flags=0x2000;
            if(job==IntPtr.Zero || !SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit)))) throw new Exception("Cannot create process job");
            if(!CreatePipe(out read,out write,ref security,0) || !SetHandleInformation(read,1,0)) throw new Exception("Cannot create output pipe");
            input=CreateFile("NUL",0x80000000,3,ref security,3,0,IntPtr.Zero);
            if(input==new IntPtr(-1)) throw new Exception("Cannot open NUL");
            var si=new Startup { cb=Marshal.SizeOf(typeof(Startup)), flags=0x100,input=input,output=write,error=write };
            var args=new StringBuilder("\""+application+"\" "+arguments);
            if(!CreateProcess(application,args,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,Cwd,ref si,out pi)) throw new Exception("Cannot start shell: "+Marshal.GetLastWin32Error());
            process=pi.process;
            if(!AssignProcessToJobObject(job,process)) throw new Exception("Cannot assign process job");
            if(ResumeThread(pi.thread)==0xffffffff) throw new Exception("Cannot resume task");
            Status="running";
            outputStream=new FileStream(new SafeFileHandle(read,true),FileAccess.Read,4096,false); read=IntPtr.Zero;
            reader=new Thread(()=>ReadOutput(outputStream)); reader.IsBackground=true; reader.Start(); readerStarted=true;
        } catch(Exception e) {
            Error=e.Message; Status="failed";
            if(process!=IntPtr.Zero) { TerminateProcess(process,1); CloseHandle(process); process=IntPtr.Zero; }
            Kill();
            if(!readerStarted && outputStream!=null) outputStream.Dispose();
            CleanupScript(); LogCompletion();
        }
        finally {
            if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
            if(write!=IntPtr.Zero) CloseHandle(write);
            if(read!=IntPtr.Zero) CloseHandle(read);
            if(input!=IntPtr.Zero && input!=new IntPtr(-1)) CloseHandle(input);
        }
    }
    void ReadOutput(Stream stream) {
        var decoder=new UTF8Encoding(false,false).GetDecoder(); byte[] bytes=new byte[4096]; char[] chars=new char[8192];
        try {
            using(stream) { int n; while((n=stream.Read(bytes,0,bytes.Length))>0) {
                lock(gate) {
                    AppendOutput(chars,decoder.GetChars(bytes,0,n,chars,0,false));
                }
            }}
        } catch(Exception e) {
            lock(gate) { Error="Output collection failed; output may be incomplete: "+e.Message; Kill(); }
        } finally {
            lock(gate) {
                AppendOutput(chars,decoder.GetChars(new byte[0],0,0,chars,0,true));
                outputFinished=true;
            }
        }
    }
    void AppendOutput(char[] chars,int count) {
        // 缓存只保留最近输出，达到容量后继续读取，不终止任务。
        output.Append(chars,0,count);
        if(count>0) Log(new string(chars,0,count));
        int overflow=output.Length-Limit;
        if(overflow>0) { output.Remove(0,overflow); outputStart+=overflow; Truncated=true; }
    }
    void CleanupScript() { if(!String.IsNullOrEmpty(ScriptPath)) { try { File.Delete(ScriptPath); ScriptPath=null; } catch(IOException) {} catch(UnauthorizedAccessException) {} } }
    void Kill() { if(job!=IntPtr.Zero) { CloseHandle(job); job=IntPtr.Zero; } }
    public void Stop(string reason) {
        lock(gate) {
            if(Status=="running" || Status=="queued" || Status=="cancelling") {
                if(stopReason==null) stopReason=reason; Status="cancelling"; Kill();
            }
        }
    }
    public void Tick() {
        lock(gate) {
            if(Status!="running" && Status!="cancelling") return;
            if(process!=IntPtr.Zero && WaitForSingleObject(process,0)==0) {
                uint code;
                if(GetExitCodeProcess(process,out code)) ExitCode=unchecked((int)code);
                else Error="Cannot read process exit code";
                Kill(); CloseHandle(process); process=IntPtr.Zero; processExited=true;
            }
            // HTTP 主循环不等待读线程；EOF 和解码收尾完成后才发布稳定终态。
            if(processExited && outputFinished) {
                CleanupScript();
                Status=stopReason ?? (ExitCode==0 && String.IsNullOrEmpty(Error) ? "completed" : "failed");
                LogCompletion();
            }
        }
    }
    public object Snapshot(long cursor) {
        lock(gate) {
            long total=outputStart+output.Length;
            if(cursor<0 || cursor>total) throw new ArgumentException("Invalid output cursor");
            long start=Math.Max(cursor,outputStart), end=Math.Min(total,start+16384);
            // 此实现的游标按 UTF-16 单元计数；浏览器只传回游标，不自行换算。
            return new { id=Id,status=Status,cwd=Cwd,shell=Shell,output=output.ToString((int)(start-outputStart),(int)(end-start)),cursor=end,has_more=end<total,output_lost=cursor<outputStart,
                         exit_code=ExitCode,truncated=Truncated,error=Error,created_at=CreatedAt };
        }
    }
    public void Dispose() {
        Stop("cancelled");
        if(process!=IntPtr.Zero) WaitForSingleObject(process,5000);
        if(readerStarted) reader.Join();
        Tick(); CleanupScript(); LogCompletion();
    }
}
'@
}

if ($Port -eq 0) {
    $probe = New-Object Net.Sockets.TcpListener($listenIp, 0)
    $probe.Start()
    $Port = $probe.LocalEndpoint.Port
    $probe.Stop()
}
$random = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($random)
$rng.Dispose()
$token = [Convert]::ToBase64String($random).TrimEnd('=').Replace('+','-').Replace('/','_')
$listenHost = if ($listenIp.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetworkV6) { "[$ListenAddress]" } else { $ListenAddress }
$listenUrl = "http://${listenHost}:$Port"
$baseUrl = if ($PublicUrl) { $PublicUrl } else { $listenUrl }
$allowedHosts = @(([Uri]$baseUrl).Authority.ToLowerInvariant())
if (([Uri]$baseUrl).IsDefaultPort) { $allowedHosts += ([Uri]$baseUrl).Host.ToLowerInvariant()+':'+([Uri]$baseUrl).Port }
if (-not $wildcard) {
    $allowedHosts += ([Uri]$listenUrl).Authority.ToLowerInvariant()
    if ($Port -eq 80) { $allowedHosts += "${listenHost}:80" }
}
$listener = New-Object Net.HttpListener
# HTTP.sys 使用前缀路由；代理入口可能采用不同 Host，使用通配前缀避免依赖公开域名解析。
# 实际请求仍必须来自指定网卡，并命中明确的 Host 白名单，不放开任意目标。
$proxyHost = $PublicUrl -and ([Uri]$baseUrl).Host -ne $listenHost
$prefixHost = if ($wildcard -or $proxyHost) { '+' } else { $listenHost }
$listener.Prefixes.Add("http://${prefixHost}:$Port/")
try { $listener.Start() } catch {
    $listener.Close()
    throw "Cannot listen on $listenUrl. Check whether this address belongs to the executor machine and whether Windows permits this HTTP prefix (URL ACL). No permissions were changed. $($_.Exception.Message)"
}
$tasks = @{}
$utf8 = New-Object Text.UTF8Encoding($false)

function New-PowerShellTaskArguments([string]$Command) {
    # 顶层原样执行正文，让 PowerShell 自行确定最终状态和完成格式化。
    # 不追加 exit，也不读取可能由更早外部程序残留的 LASTEXITCODE。
    # 原生程序非零结果按 CLI 返回 1；需要原值时由用户显式 exit $LASTEXITCODE。
    $scriptText = '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $env:PYTHONIOENCODING="utf-8"; $ProgressPreference="SilentlyContinue";' + "`n" + $Command
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($scriptText))
    return '-NoLogo -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand '+$encoded
}

function Fail-Request([int]$Status, [string]$Message) {
    $ex = New-Object Exception($Message)
    $ex.Data['HttpStatus'] = $Status
    throw $ex
}
function Send-Json($Context, [int]$Status, $Body) {
    $response = $Context.Response
    $bytes = $utf8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 12 -Compress))
    $response.StatusCode = $Status
    $response.ContentType = 'application/json; charset=utf-8'
    $response.ContentLength64 = $bytes.Length
    $response.KeepAlive = $false
    $response.Headers['Cache-Control'] = 'no-store'
    $response.Headers['X-Content-Type-Options'] = 'nosniff'
    if ($Context.Request.Headers['Origin'] -ceq $Origin) {
        $response.Headers['Access-Control-Allow-Origin'] = $Origin
        $response.Headers['Vary'] = 'Origin'
        $response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        $response.Headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
        $response.Headers['Access-Control-Allow-Private-Network'] = 'true'
    }
    try { $response.OutputStream.Write($bytes,0,$bytes.Length) } finally { $response.Close() }
}

[Console]::Error.WriteLine('Command executor (PowerShell fallback). Keep this terminal open; Ctrl+C disconnects.')
[Console]::Error.WriteLine("命令使用当前用户权限执行，默认目录：$Cwd。执行日志在此终端显示。")
[Console]::Error.WriteLine('Paste this connection into the AI Agent Executor connection dialog:')
[Console]::Error.WriteLine("监听地址：$listenUrl；浏览器访问地址：$baseUrl")
[Console]::WriteLine((ConvertTo-Json -Compress @{ url=$baseUrl; token=$token }))
try {
    $pending = $listener.GetContextAsync()
    while ($listener.IsListening) {
        foreach ($task in $tasks.Values) { $task.Tick() }
        if (-not $pending.Wait(100)) { continue }
        $context = $pending.Result
        $pending = $listener.GetContextAsync()
        try {
            $request = $context.Request
            $localIp = $request.LocalEndPoint.Address
            if ($localIp.IsIPv4MappedToIPv6) { $localIp = $localIp.MapToIPv4() }
            if (-not $wildcard -and -not $localIp.Equals($listenIp)) { Fail-Request 403 'Request arrived on a different interface' }
            if (-not $request.Headers['Host'] -or $allowedHosts -notcontains $request.Headers['Host'].ToLowerInvariant() -or $request.Headers['Origin'] -cne $Origin) { Fail-Request 403 'Invalid Host or Origin' }
            if ($request.HttpMethod -ne 'OPTIONS') {
                if ($request.Headers['Authorization'] -cne "Bearer $token") { Fail-Request 401 'Invalid connection credentials' }
            }
            $path = $request.Url.AbsolutePath
            $taskPath = [regex]::Match($path,'^/v1/tasks/([a-zA-Z0-9_-]{8,80})(/cancel)?$')
            if ($path -notin @('/v1/info','/v1/tasks') -and -not $taskPath.Success) { Fail-Request 404 'Unknown endpoint' }
            if ($request.HttpMethod -eq 'OPTIONS') {
                if ($request.Headers['Access-Control-Request-Method'] -notin @('GET','POST')) { Fail-Request 405 'Unsupported method' }
                foreach ($header in ($request.Headers['Access-Control-Request-Headers'] -split ',')) {
                    if ($header.Trim() -and $header.Trim().ToLowerInvariant() -notin @('authorization','content-type')) { Fail-Request 403 'Unsupported request headers' }
                }
                Send-Json $context 200 @{}
                continue
            }
            $body = $null
            if ($request.HttpMethod -eq 'POST') {
                if ($request.Headers['Transfer-Encoding'] -or $request.ContentLength64 -lt 0) { Fail-Request 400 'Content-Length is required' }
                if ($request.ContentLength64 -gt 131072) { Fail-Request 413 'Request is too large' }
                if (($request.ContentType -split ';')[0].Trim() -ne 'application/json') { Fail-Request 415 'Expected application/json' }
                # 限时读取 HTTP 请求体，等待期间继续收集任务结束状态。
                $buffer = New-Object byte[] ([int]$request.ContentLength64)
                $offset = 0
                $deadline = [DateTime]::UtcNow.AddSeconds(10)
                while ($offset -lt $buffer.Length) {
                    $read = $request.InputStream.ReadAsync($buffer,$offset,$buffer.Length-$offset)
                    while (-not $read.Wait(100)) {
                        foreach ($task in $tasks.Values) { $task.Tick() }
                        if ([DateTime]::UtcNow -gt $deadline) { Fail-Request 408 'Request body timeout' }
                    }
                    if ($read.Result -eq 0) { Fail-Request 400 'Incomplete body' }
                    $offset += $read.Result
                }
                try { $body = ConvertFrom-Json -InputObject $utf8.GetString($buffer) } catch { Fail-Request 400 'Invalid JSON' }
                if ($null -eq $body -or $body -isnot [pscustomobject]) { Fail-Request 400 'Expected an object' }
            }
            if ($request.HttpMethod -eq 'GET' -and $path -eq '/v1/info') {
                $result = @{ protocol_version=1; runtime='powershell'; platform='win32'; shell='powershell'; shells=@('powershell','cmd'); default_cwd=$Cwd;
                    output_buffer_chars=262144 }
            } elseif ($request.HttpMethod -eq 'POST' -and $path -eq '/v1/tasks') {
                if ($body.id -isnot [string] -or $body.id -cnotmatch '^[a-zA-Z0-9_-]{8,80}$') { Fail-Request 400 'Invalid task id' }
                if ($body.command -isnot [string] -or -not $body.command.Trim() -or $body.command.Contains([string][char]0) -or $utf8.GetByteCount($body.command) -gt 65536) { Fail-Request 400 'Invalid command' }
                $shellName = 'powershell'
                if ($body.PSObject.Properties.Name -contains 'shell') {
                    if ($body.shell -isnot [string] -or $body.shell -cnotin @('powershell','cmd')) { Fail-Request 400 'Unsupported shell on this computer' }
                    $shellName = $body.shell
                }
                $directory = $Cwd
                if ($null -ne $body.cwd -and $body.cwd -isnot [string]) { Fail-Request 400 'Invalid working directory' }
                if ($body.cwd -is [string] -and $body.cwd.Length -gt 0) {
                    try {
                        $candidate = $body.cwd
                        if (-not [IO.Path]::IsPathRooted($candidate)) { $candidate = Join-Path $Cwd $candidate }
                        $directory = (Resolve-Path -LiteralPath $candidate).ProviderPath
                    } catch { Fail-Request 400 'Working directory does not exist' }
                    if (-not [IO.Directory]::Exists($directory)) { Fail-Request 400 'Working directory is not a directory' }
                }
                $fingerprint = ConvertTo-Json -Compress @($body.command,$directory,$shellName)
                if ($tasks.ContainsKey($body.id)) {
                    if ($tasks[$body.id].Fingerprint -cne $fingerprint) { Fail-Request 409 'Task id already belongs to different execution content' }
                    $result = $tasks[$body.id].Snapshot(0)
                } else {
                    $task = New-Object ExecutorTaskV3
                    $task.Shell=$shellName; $task.Id=$body.id; $task.Command=$body.command; $task.Cwd=$directory; $task.Fingerprint=$fingerprint
                    $task.CreatedAt=([DateTime]::UtcNow-[DateTime]'1970-01-01').TotalSeconds
                    if ($shellName -eq 'cmd') {
                        # CMD 使用原始批处理文件，保留引号、管道、百分号和多行语义。
                        $task.ScriptPath = Join-Path ([IO.Path]::GetTempPath()) ('executor-task-'+[Guid]::NewGuid().ToString('N')+'.cmd')
                        $scriptText = "@echo off`r`nchcp 65001 >nul`r`nset `"PYTHONIOENCODING=utf-8`"`r`n" + $body.command.Replace("`r`n","`n").Replace("`n","`r`n") + "`r`n"
                        [IO.File]::WriteAllText($task.ScriptPath,$scriptText,$utf8)
                        $application = Join-Path $env:SystemRoot 'System32/cmd.exe'
                        $arguments = '/d /s /c ""'+$task.ScriptPath+'""'
                    } else {
                        $application = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
                        $arguments = New-PowerShellTaskArguments $body.command
                    }
                    $tasks[$body.id]=$task
                    $task.Start($application,$arguments)
                    $result=$task.Snapshot(0)
                }
            } elseif ($taskPath.Success) {
                $taskId=$taskPath.Groups[1].Value
                if (-not $tasks.ContainsKey($taskId)) { Fail-Request 404 'Task not found' }
                $task=$tasks[$taskId]
                if ($request.HttpMethod -eq 'POST' -and $taskPath.Groups[2].Success) { $task.Stop('cancelled'); $result=$task.Snapshot(0) }
                elseif ($request.HttpMethod -eq 'GET' -and -not $taskPath.Groups[2].Success) {
                    [long]$cursor=0
                    if ($request.QueryString['cursor'] -and -not [long]::TryParse($request.QueryString['cursor'],[ref]$cursor)) { Fail-Request 400 'Invalid output cursor' }
                    try { $result=$task.Snapshot($cursor) } catch { Fail-Request 400 'Invalid output cursor' }
                } else { Fail-Request 405 'Unsupported method' }
            } else { Fail-Request 405 'Unsupported method' }
            Send-Json $context 200 $result
        } catch {
            $status=500
            if ($_.Exception.Data.Contains('HttpStatus')) { $status=[int]$_.Exception.Data['HttpStatus'] }
            try { Send-Json $context $status @{error=if($status -eq 500){'Local executor error'}else{$_.Exception.Message}} } catch {}
        }
    }
} finally {
    $listener.Close()
    foreach ($task in $tasks.Values) { $task.Dispose() }
    [void][ExecutorTerminalLogV3]::Flush(1000)
    [Console]::Error.WriteLine('Local executor stopped.')
}
