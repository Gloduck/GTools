# 只验证托管输出采集与日志生命周期；使用模拟流，不调用 Windows 作业对象或进程 API。
param([string]$ExecutorRoot = (Join-Path $PSScriptRoot '../../public/local-executor/v1'))
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $ExecutorRoot 'executor.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw '执行端脚本存在语法错误' }
if (-not ('GToolsLocalTaskV3' -as [type])) {
    $addType = $ast.Find({ param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Add-Type'
    }, $true)
    $source = $addType.CommandElements | Where-Object { $_ -is [System.Management.Automation.Language.StringConstantExpressionAst] } | Select-Object -Last 1
    Add-Type -TypeDefinition $source.Value
}

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;

// 第二次读取由测试释放，用于确定性模拟进程已退出但管道尚未到 EOF。
public sealed class GToolsTestGateStream : Stream {
    public readonly ManualResetEvent ContinueRead = new ManualResetEvent(false);
    readonly byte[] first = Encoding.UTF8.GetBytes("开始输出\n");
    readonly byte[] last = Encoding.UTF8.GetBytes("末尾中文😀\n");
    readonly bool fail; int stage;
    public GToolsTestGateStream(bool failRead) { fail=failRead; }
    public override int Read(byte[] buffer,int offset,int count) {
        if(stage==0) { stage++; Array.Copy(first,0,buffer,offset,first.Length); return first.Length; }
        if(stage==1) {
            ContinueRead.WaitOne(); stage++;
            if(fail) throw new IOException("模拟读取失败");
            Array.Copy(last,0,buffer,offset,last.Length); return last.Length;
        }
        return 0;
    }
    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return false; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { throw new NotSupportedException(); } }
    public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
    public override long Seek(long offset,SeekOrigin origin) { throw new NotSupportedException(); }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer,int offset,int count) { throw new NotSupportedException(); }
    public override void Flush() {}
}

public sealed class GToolsTestBlockedWriter : TextWriter {
    public readonly ManualResetEvent Entered = new ManualResetEvent(false);
    public readonly ManualResetEvent ContinueWrite = new ManualResetEvent(false);
    readonly StringBuilder content = new StringBuilder();
    public override Encoding Encoding { get { return Encoding.UTF8; } }
    public override void Write(string text) {
        Entered.Set(); ContinueWrite.WaitOne();
        lock(content) { content.Append(text); }
    }
    public override void WriteLine(string text) { Write(text+Environment.NewLine); }
    public override string ToString() { lock(content) { return content.ToString(); } }
}

// 在线程中调用托管方法，不依赖 PowerShell 子线程的 Runspace。
public sealed class GToolsTestWorker {
    public Thread Thread;
    public Exception Error;
    public static Thread UnstartedThread() { return new Thread(()=>{}); }
    public static GToolsTestWorker Read(object task,Stream stream) {
        var worker = new GToolsTestWorker();
        worker.Thread = new Thread(()=> {
            try { task.GetType().GetMethod("ReadOutput",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(task,new object[]{stream}); }
            catch(Exception error) { worker.Error=error; }
        });
        worker.Thread.IsBackground=true; worker.Thread.Start(); return worker;
    }
    public static GToolsTestWorker Append(object task,string text,int repeats) {
        var worker = new GToolsTestWorker();
        worker.Thread = new Thread(()=> {
            try {
                var append=task.GetType().GetMethod("AppendOutput",BindingFlags.Instance|BindingFlags.NonPublic);
                var chars=text.ToCharArray();
                for(int index=0;index<repeats;index++) append.Invoke(task,new object[]{chars,chars.Length});
            } catch(Exception error) { worker.Error=error; }
        });
        worker.Thread.IsBackground=true; worker.Thread.Start(); return worker;
    }
}
'@

function Assert-True($Value, [string]$Message) { if (-not $Value) { throw "场景失败：$Message" } }
function New-ExitedTask([string]$Id) {
    $task = New-Object GToolsLocalTaskV3
    $task.Id = $Id
    $task.Status = 'running'
    $task.ExitCode = 0
    # 不伪造原生句柄，只标记主进程已退出，真实 Tick 仍必须等待输出读取完成。
    [GToolsLocalTaskV3].GetField('processExited', [Reflection.BindingFlags]'Instance,NonPublic').SetValue($task,$true)
    return $task
}
function Wait-FirstOutput($Task) {
    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        if ($Task.Snapshot(0).output -eq "开始输出`n") { return }
        Start-Sleep -Milliseconds 10
    } while ([DateTime]::UtcNow -lt $deadline)
    throw '场景失败：未及时收到首段输出'
}

foreach ($cancel in @($false,$true)) {
    $task = New-ExitedTask ('eof-'+$cancel)
    $stream = New-Object GToolsTestGateStream($false)
    $worker = [GToolsTestWorker]::Read($task,$stream)
    try {
        Wait-FirstOutput $task
        if ($cancel) { $task.Stop('cancelled') }
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $task.Tick()
        Assert-True ($clock.ElapsedMilliseconds -lt 1000) 'Tick 不应阻塞等待读取 EOF'
        $expectedStatus = if ($cancel) { 'cancelling' } else { 'running' }
        Assert-True ($task.Status -eq $expectedStatus) 'EOF 前不得提前发布终态'
        [void]$stream.ContinueRead.Set()
        Assert-True ($worker.Thread.Join(5000) -and -not $worker.Error) '输出读取正常完成'
        $task.Tick()
        $expectedStatus = if ($cancel) { 'cancelled' } else { 'completed' }
        $final = $task.Snapshot(0)
        Assert-True ($task.Status -eq $expectedStatus) 'EOF 后按成功或取消原因发布终态'
        Assert-True ($final.output -ceq "开始输出`n末尾中文😀`n") '终态前收齐末尾中文输出'
        $task.Tick()
        Assert-True ($task.Snapshot(0).cursor -eq $final.cursor) '发布终态后输出游标稳定'
        Write-Output "场景通过：延迟 EOF 与稳定终态，取消=$cancel"
    } finally {
        [void]$stream.ContinueRead.Set()
        [void]$worker.Thread.Join(5000)
        $stream.ContinueRead.Dispose()
    }
}

$task = New-ExitedTask 'read-error'
$stream = New-Object GToolsTestGateStream($true)
$worker = [GToolsTestWorker]::Read($task,$stream)
try {
    Wait-FirstOutput $task
    [void]$stream.ContinueRead.Set()
    Assert-True ($worker.Thread.Join(5000) -and -not $worker.Error) '采集异常由执行器记录'
    $task.Tick()
    $final = $task.Snapshot(0)
    Assert-True ($final.status -eq 'failed' -and $final.exit_code -eq 0) '零进程退出码不能掩盖输出采集失败'
    Assert-True ($final.error.Contains('模拟读取失败') -and $final.output -ceq "开始输出`n") '采集失败保留已读取文本及错误说明'
    Write-Output '场景通过：输出采集异常标记失败并保留部分输出'
} finally {
    [void]$stream.ContinueRead.Set()
    [void]$worker.Thread.Join(5000)
    $stream.ContinueRead.Dispose()
}

# 模拟线程对象已创建但 Thread.Start 失败，清理不得 Join 未启动线程或覆盖启动错误。
$task = New-Object GToolsLocalTaskV3
$task.Id = 'reader-start-error'
$task.Status = 'failed'
$task.Error = '模拟读取线程启动失败'
$unstarted = [GToolsTestWorker]::UnstartedThread()
[GToolsLocalTaskV3].GetField('reader',[Reflection.BindingFlags]'Instance,NonPublic').SetValue($task,$unstarted)
$task.Dispose()
$task.Dispose()
$final = $task.Snapshot(0)
Assert-True ($unstarted.ThreadState -eq [Threading.ThreadState]::Unstarted) '清理不应启动失败的读取线程'
Assert-True ($final.status -eq 'failed' -and $final.error -ceq '模拟读取线程启动失败') '清理保留原始启动失败结果'
Assert-True ($null -eq $final.exit_code -and $final.output -ceq '') '未启动任务不伪造退出码或输出'
Write-Output '场景通过：读取线程未启动时安全清理且保留失败结果'

Assert-True ([GToolsTerminalLogV3]::Flush(5000)) '先排空已有终端日志'
$previousError = [Console]::Error
$writer = New-Object GToolsTestBlockedWriter
$logTask = New-ExitedTask 'slow-terminal'
$worker = $null
try {
    [Console]::SetError($writer)
    [GToolsTerminalLogV3]::Append('占用终端写入')
    Assert-True ($writer.Entered.WaitOne(5000)) '模拟终端已经阻塞'
    # 每次输出不超采集块大小，累计积压超过日志队列容量。
    $chunk = '中' * 4096
    $worker = [GToolsTestWorker]::Append($logTask,$chunk,100)
    Assert-True ($worker.Thread.Join(2000) -and -not $worker.Error) '慢终端不得阻塞任务输出采集'
    Assert-True (-not [GToolsTerminalLogV3]::Flush(30)) '阻塞时 Flush 应按超时返回'
    $buffered = [GToolsTerminalLogV3].GetField('pendingChars',[Reflection.BindingFlags]'Static,NonPublic').GetValue($null)
    Assert-True ($buffered -le 262144) '日志队列容量有界'
    $snapshot = $logTask.Snapshot(0)
    $output = $snapshot.output
    while ($snapshot.has_more) { $snapshot=$logTask.Snapshot($snapshot.cursor); $output+=$snapshot.output }
    Assert-True ($output -ceq ('中' * 262144) -and $snapshot.truncated) '接口输出只按自身缓存滚动，不受日志丢弃影响'
    [void]$writer.ContinueWrite.Set()
    Assert-True ([GToolsTerminalLogV3]::Flush(5000)) '终端恢复后日志队列排空'
    Assert-True ($writer.ToString().Contains('终端日志积压，已省略')) '日志被省略后有明确说明'
    Write-Output '场景通过：慢终端日志有界、提示省略且不阻塞接口输出'
} finally {
    [void]$writer.ContinueWrite.Set()
    if ($worker) { [void]$worker.Thread.Join(5000) }
    [void][GToolsTerminalLogV3]::Flush(5000)
    [Console]::SetError($previousError)
    $writer.Entered.Dispose()
    $writer.ContinueWrite.Dispose()
    $writer.Dispose()
}
Write-Output '所有 PowerShell 托管生命周期测试通过；未调用 Windows 原生 API。'
