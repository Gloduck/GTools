#!/usr/bin/env python3
"""通用命令执行端，仅依赖 Python 3.8 及以上版本的标准库。

不连接远程后端，凭据只输出到终端，每个任务使用独立进程组。
命令使用启动服务的当前用户权限执行。
"""
import argparse
import codecs
import ctypes
from collections import deque
import hashlib
import hmac
import json
import ipaddress
import socket
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import threading
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

VERSION = 2
MAX_BODY = 128 * 1024
MAX_OUTPUT_CHARS = 256 * 1024
DEFAULT_READ_CHARS = 5000
MAX_READ_CHARS = 20000
MAX_LOG_CHARS = 256 * 1024
TASK_ID = re.compile(r"^[a-zA-Z0-9_-]{8,80}$")
FINAL = {"completed", "failed", "cancelled"}

# 监管进程持有组身份；控制管道独立于业务输出，停止信号由组内监管者发出。
POSIX_SUPERVISOR = r'''
import os, signal, subprocess, sys, threading
print("READY %d" % os.getpid(), file=sys.stderr, flush=True)
if sys.stdin.readline().strip() != "START":
    sys.exit(1)
root = subprocess.Popen(["/bin/sh", "-c", sys.argv[1]], stdin=subprocess.DEVNULL, stderr=subprocess.STDOUT)
os.close(1)
report_lock = threading.Lock()
reported = False
def report(code):
    global reported
    with report_lock:
        if not reported:
            try:
                print("EXIT %d" % code, file=sys.stderr, flush=True)
            except OSError:
                pass  # 控制接收端已离开时，不能阻断监管者的组清理。
            reported = True
def control():
    for line in sys.stdin:
        if line.strip() == "FINISH":
            os._exit(0)
        if line.strip() == "STOP":
            break
    try:
        root.kill()
        report(root.wait())
    finally:
        os.killpg(os.getpgrp(), signal.SIGKILL)
threading.Thread(target=control, daemon=True).start()
report(root.wait())
threading.Event().wait()
'''


def group_has_business(group):
    # 僵尸已不能执行或产生输出；监管者自身不代表业务仍在运行。
    if sys.platform.startswith("linux"):
        with os.scandir("/proc") as entries:
            for entry in entries:
                if not entry.name.isdigit() or int(entry.name) == group:
                    continue
                try:
                    if os.getpgid(int(entry.name)) != group:
                        continue
                    with open(entry.path + "/stat") as source:
                        stat = source.read()
                    fields = stat[stat.rfind(")") + 1:].split()
                    if int(fields[2]) == group and fields[0] not in ("Z", "X"):
                        return True
                except (FileNotFoundError, ProcessLookupError):
                    continue
                except PermissionError:
                    raise OSError("Cannot inspect task process group")
        return False
    # macOS 沿用系统 ps；不要求 /proc 或额外依赖。
    output = subprocess.check_output(["ps", "-axo", "pid=,pgid=,stat="], text=True)
    return any(int(pid) != group and int(pgid) == group and not state.startswith(("Z", "X"))
               for pid, pgid, state in (line.split() for line in output.splitlines()))


def powershell_arguments(command):
    # 正文在顶层原样执行，由 PowerShell 自己完成格式化并确定最终退出状态。
    # 不追加命令或外层脚本块，避免覆盖 $?、沿用残留 LASTEXITCODE 或提前退出。
    # 原生程序非零结果按 CLI 返回 1；用户可用 exit $LASTEXITCODE 显式传出原值。
    # 先关闭进度并直接构造编码对象，避免模块首次加载发生在编码设置之前。
    script = ("$ProgressPreference='SilentlyContinue'; "
              "[Console]::OutputEncoding = [Activator]::CreateInstance([Text.UTF8Encoding], [object[]]@($false)); "
              "$env:PYTHONIOENCODING='utf-8'; "
              "\n" + command)
    # Windows PowerShell 5.1 的 EncodedCommand 会将重定向的错误流强制序列化。
    # 正文作为独立参数交给 subprocess，由它完成 Windows 参数引用。
    return ["-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text",
            "-Command", script]


class OutputDecoder:
    """保留增量解码状态；只在真实非法字节发生时标记损失，普通的 � 不算错误。"""
    def __init__(self):
        self.decoder = codecs.getincrementaldecoder("utf-8")("strict")
        self.loss = False

    def decode(self, data, final=False):
        state = self.decoder.getstate()
        try:
            return self.decoder.decode(data, final)
        except UnicodeDecodeError:
            self.loss = True
            self.decoder.setstate(state)
            self.decoder.errors = "replace"
            try:
                return self.decoder.decode(data, final)
            finally:
                self.decoder.errors = "strict"


class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class TerminalLog:
    """终端只是输出副本；有界队列避免慢终端阻塞任务或无限占用内存。"""
    def __init__(self, get_stream, language="en-US"):
        self.language = language
        self.get_stream = get_stream
        self.condition = threading.Condition()
        self.pending = deque()
        self.pending_chars = 0
        self.dropped_chars = 0
        self.writing = False
        self.closed = False
        self.worker = threading.Thread(target=self.run, daemon=True)
        self.worker.start()

    def text(self, chinese, english, *args):
        return (chinese if self.language == "zh-CN" else english) % args

    def status(self, value):
        return {"running": "运行中", "completed": "已完成", "failed": "失败", "cancelled": "已取消", "unknown": "未知"}.get(value, value) if self.language == "zh-CN" else value

    def append(self, text):
        with self.condition:
            if self.closed:
                return
            if len(text) > MAX_LOG_CHARS:
                self.dropped_chars += len(text) - MAX_LOG_CHARS
                text = text[-MAX_LOG_CHARS:]
            while self.pending and self.pending_chars + len(text) > MAX_LOG_CHARS:
                removed = self.pending.popleft()
                self.pending_chars -= len(removed)
                self.dropped_chars += len(removed)
            self.pending.append(text)
            self.pending_chars += len(text)
            self.condition.notify_all()

    def run(self):
        while True:
            with self.condition:
                while not self.pending and not self.closed:
                    self.condition.wait()
                if not self.pending:
                    return
                text = self.pending.popleft()
                self.pending_chars -= len(text)
                dropped, self.dropped_chars = self.dropped_chars, 0
                self.writing = True
            try:
                stream = self.get_stream()
                if dropped:
                    stream.write(self.text('[Executor] 终端日志积压，已省略 %d 字符；任务输出请以接口缓存为准。\n', '[Executor] Terminal log backlog: omitted %d characters; use the API buffer for task output.\n', dropped))
                stream.write(text)
                stream.flush()
            except (OSError, ValueError, UnicodeError):
                pass  # 日志失败不改变命令结果，也不能中断后续输出采集。
            finally:
                with self.condition:
                    self.writing = False
                    self.condition.notify_all()

    def flush(self, timeout=1):
        # 仅供退出时尽力排空及测试同步，任务完成不依赖终端写入速度。
        with self.condition:
            return self.condition.wait_for(lambda: not self.pending and not self.writing, timeout)

    def close(self):
        with self.condition:
            self.closed = True
            self.condition.notify_all()
        self.worker.join(timeout=1)


class WindowsJob:
    """在子进程挂起期间加入作业对象，关闭作业时清理整棵进程树。"""
    def __init__(self, process):
        from ctypes import wintypes as w
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        class Basic(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", w.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", w.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", w.DWORD), ("SchedulingClass", w.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(n, ctypes.c_uint64) for n in ("ReadOperationCount", "WriteOperationCount", "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]
        class Extended(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", Basic), ("IoInfo", IO), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]
        k.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        k.CreateJobObjectW.restype = w.HANDLE
        k.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        k.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
        k.QueryInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p]
        k.CloseHandle.argtypes = [w.HANDLE]
        self.k, self.handle = k, k.CreateJobObjectW(None, None)
        limits = Extended()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # 关闭作业对象时终止其进程树
        if not self.handle or not k.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not k.AssignProcessToJobObject(self.handle, w.HANDLE(int(process._handle))):
            self.close()
            raise OSError("Unable to create an isolated process job; command was not started")
        nt = ctypes.WinDLL("ntdll")
        nt.NtResumeProcess.argtypes = [w.HANDLE]
        if nt.NtResumeProcess(w.HANDLE(int(process._handle))) != 0:
            self.close()
            raise OSError("Unable to resume task process")

    def terminate(self):
        if self.handle and not self.k.TerminateJobObject(self.handle, 1):
            failure = ctypes.WinError(ctypes.get_last_error())
            self.close()  # 终止调用失败时仍利用 KILL_ON_JOB_CLOSE 尽力清理。
            raise failure

    def active(self):
        from ctypes import wintypes as w
        if not self.handle:
            raise OSError("Process job cleanup could not be confirmed")
        class Accounting(ctypes.Structure):
            _fields_ = [(name, ctypes.c_int64) for name in ("TotalUserTime", "TotalKernelTime", "ThisPeriodTotalUserTime", "ThisPeriodTotalKernelTime")] + [
                (name, w.DWORD) for name in ("TotalPageFaultCount", "TotalProcesses", "ActiveProcesses", "TotalTerminatedProcesses")]
        result = Accounting()
        if not self.k.QueryInformationJobObject(self.handle, 1, ctypes.byref(result), ctypes.sizeof(result), None):
            failure = ctypes.WinError(ctypes.get_last_error())
            self.k.TerminateJobObject(self.handle, 1)
            self.close()
            raise failure
        return result.ActiveProcesses

    def close(self):
        if self.handle:
            self.k.CloseHandle(self.handle)
            self.handle = None


def validate_origin(origin):
    p = urlsplit(origin)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password or p.path not in ("", "/") or p.query or p.fragment:
        raise ValueError("--origin must be a web origin, e.g. https://tools.example.com")
    return origin.rstrip("/")


class Executor:
    def __init__(self, origin, cwd, log_stream=None, token="", language="en-US"):
        self.origin = validate_origin(origin)
        self.cwd = str(Path(cwd).resolve(strict=True))
        if not Path(self.cwd).is_dir():
            raise ValueError("Working directory is not a directory")
        if not isinstance(token, str) or (token and not re.fullmatch(r"[A-Za-z0-9_-]+", token)):
            raise ValueError("Token must contain only letters, digits, underscores or hyphens")
        self.token = token or secrets.token_urlsafe(32)
        self.tasks = {}
        self.lock = threading.RLock()
        self.closed = False
        self.shells = ["powershell", "cmd"] if os.name == "nt" else ["sh"]
        self.log_stream = log_stream if log_stream is not None else sys.stderr
        self.terminal_log = TerminalLog(lambda: self.log_stream, language)

    def log(self, task_id, text):
        # 每条终端记录带任务编号，便于区分并发命令及对应的 AI 工具结果。
        if not text:
            return
        self.terminal_log.append("[%s] %s%s" % (task_id, text, "" if text.endswith("\n") else "\n"))

    def info(self):
        return {"protocol_version": VERSION, "runtime": "python", "platform": sys.platform,
                "shell": self.shells[0], "shells": self.shells, "default_cwd": self.cwd,
                "output_buffer_chars": MAX_OUTPUT_CHARS}

    def submit(self, body):
        task_id = body.get("id")
        command = body.get("command")
        shell = body.get("shell", self.shells[0])
        lifecycle = body.get("lifecycle", "task")
        if lifecycle not in ("task", "session"):
            raise ApiError(400, "lifecycle must be task or session")
        if not isinstance(shell, str) or shell not in self.shells:
            raise ApiError(400, "Unsupported shell on this computer")
        cwd = body.get("cwd", self.cwd)
        if cwd == "":
            cwd = self.cwd
        if not isinstance(task_id, str) or not TASK_ID.fullmatch(task_id):
            raise ApiError(400, "Invalid task id")
        if not isinstance(command, str) or not command.strip() or "\0" in command or len(command.encode()) > 65536:
            raise ApiError(400, "Invalid command")
        if not isinstance(cwd, str) or "\0" in cwd:
            raise ApiError(400, "Invalid working directory")
        try:
            cwd = str((Path(self.cwd) / cwd).resolve(strict=True))
        except (OSError, ValueError):
            raise ApiError(400, "Working directory does not exist")
        if not Path(cwd).is_dir():
            raise ApiError(400, "Working directory is not a directory")
        fingerprint = hashlib.sha256(json.dumps([command, cwd, shell, lifecycle], ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            if self.closed:
                raise ApiError(410, "Executor is closed")
            if task_id in self.tasks:
                if self.tasks[task_id].fingerprint != fingerprint:
                    raise ApiError(409, "Task id already belongs to different execution content")
                return self.tasks[task_id].snapshot(0)
            task = Task(self, task_id, command, cwd, fingerprint, shell, lifecycle)
            self.tasks[task_id] = task
            threading.Thread(target=task.run, daemon=True).start()
            return task.snapshot(0)

    def get_task(self, task_id):
        with self.lock:
            if task_id not in self.tasks:
                raise ApiError(404, "Task not found")
            return self.tasks[task_id]

    def close(self):
        with self.lock:
            self.closed = True
            tasks = list(self.tasks.values())
        for task in tasks:
            task.stop("cancelled")
        for task in tasks:
            task.done.wait(5)
        self.terminal_log.close()


class Task:
    def __init__(self, executor, task_id, command, cwd, fingerprint, shell, lifecycle="task"):
        self.executor, self.id, self.command, self.cwd = executor, task_id, command, cwd
        self.fingerprint = fingerprint
        self.shell, self.script_path = shell, None
        self.lifecycle = lifecycle
        self.lock = threading.RLock()
        self.status, self.exit_code, self.error = "queued", None, ""
        self.output, self.output_start = "", 0
        self.truncated = False
        self.decoding_loss = False
        self.output_incomplete = False
        self.process, self.job, self.stop_reason = None, None, None
        self.done = threading.Event()
        self.created_at = time.time()
        self.scope_empty = False
        self.scope_stopping = False

    def snapshot(self, cursor, max_chars=DEFAULT_READ_CHARS):
        with self.lock:
            if type(max_chars) is not int or not 1 <= max_chars <= MAX_READ_CHARS:
                raise ApiError(400, "max_chars must be an integer between 1 and 20000")
            total = self.output_start + len(self.output)
            if cursor < 0 or cursor > total:
                raise ApiError(400, "Invalid output cursor")
            start = max(cursor, self.output_start)
            end = min(total, start + max_chars)
            return {"id": self.id, "status": self.status, "cwd": self.cwd, "shell": self.shell, "lifecycle": self.lifecycle,
                    "output": self.output[start - self.output_start:end - self.output_start],
                    "cursor": end, "has_more": end < total, "exit_code": self.exit_code,
                    "truncated": self.truncated, "output_lost": cursor < self.output_start,
                    "decoding_loss": self.decoding_loss, "output_incomplete": self.output_incomplete, "error": self.error, "created_at": self.created_at}

    def append_output(self, text):
        # 仅保留最近的输出；缓存滚动不会停止命令或阻塞输出管道。
        self.output += text
        overflow = len(self.output) - MAX_OUTPUT_CHARS
        if overflow > 0:
            self.output = self.output[overflow:]
            self.output_start += overflow
            self.truncated = True

    def stop(self, reason):
        with self.lock:
            if self.status in FINAL or self.done.is_set():
                return
            if self.stop_reason is None:
                self.stop_reason = reason
            self.status = "cancelling"
            try:
                self.kill_tree()
            except OSError as exc:
                self.error = 'Task cleanup could not be confirmed: ' + str(exc)
                self.status = "unknown"

    def kill_tree(self):
        if self.job:
            self.job.terminate()
        elif self.process:
            try:
                if os.name == "nt":
                    self.process.kill()
                else:
                    self.process.stdin.write(b"STOP\n")
                    self.process.stdin.flush()
                    self.scope_stopping = True
            except (ProcessLookupError, OSError):
                pass

    def wait_job_empty(self):
        while self.job.active():
            time.sleep(0.1)
        self.scope_empty = True

    def wait_group_empty(self):
        stopped_at = None
        while group_has_business(self.process.pid):
            if self.process.poll() is not None:
                stopped_at = stopped_at or time.monotonic()
                if not self.scope_stopping or time.monotonic() - stopped_at >= 1:
                    raise OSError("Task supervisor is gone while owned processes remain; cleanup cannot be confirmed")
            time.sleep(0.1)
        self.scope_empty = True

    def read_output(self):
        decoder = OutputDecoder()
        try:
            while True:
                chunk = self.process.stdout.read(4096)
                if not chunk:
                    break
                with self.lock:
                    text = decoder.decode(chunk)
                    self.decoding_loss = decoder.loss
                    self.append_output(text)
                self.executor.log(self.id, text)
        except Exception as exc:
            with self.lock:
                self.error = 'Output collection failed; output may be incomplete: ' + str(exc)
                self.output_incomplete = True
                self.kill_tree()  # 读取已失效时不能让写满管道的子进程一直阻塞。
        finally:
            with self.lock:
                text = decoder.decode(b"", final=True)
                self.decoding_loss = decoder.loss
                self.append_output(text)
            self.executor.log(self.id, text)
            self.process.stdout.close()

    def run(self):
        reader = None
        reader_started = False
        self.executor.log(self.id, self.executor.terminal_log.text("开始执行 | Shell: %s | 目录: %s\n%s", "Started | Shell: %s | Directory: %s\n%s", self.shell, self.cwd, self.command))
        try:
            with self.lock:
                if self.stop_reason:
                    return
                env = os.environ.copy()
                # 不通过子进程环境变量传递本机连接凭据。
                for key in list(env):
                    if key.startswith("LOCAL_EXECUTOR_"):
                        del env[key]
                if os.name == "nt":
                    system = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
                    if self.shell == "cmd":
                        # 批处理文件原样保存多行命令，避免再次经过 Python 的 argv 引号转换。
                        with tempfile.NamedTemporaryFile(mode="w", suffix=".cmd", prefix="executor-task-", encoding="utf-8", newline="", delete=False) as script_file:
                            self.script_path = script_file.name
                            script_file.write('@echo off\r\nchcp 65001 >nul\r\nset "PYTHONIOENCODING=utf-8"\r\n' + self.command.replace("\r\n", "\n").replace("\n", "\r\n") + "\r\n")
                        executable = os.path.join(system, "cmd.exe")
                        argv = '"%s" /d /s /c ""%s""' % (executable, self.script_path)
                    else:
                        executable = os.path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe")
                        argv = [executable, *powershell_arguments(self.command)]
                    self.process = subprocess.Popen(argv, executable=executable, cwd=self.cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=0x4 | 0x08000000, bufsize=0)
                    self.job = WindowsJob(self.process)
                else:
                    argv = [sys.executable, "-u", "-c", POSIX_SUPERVISOR, self.command]
                    self.process = subprocess.Popen(argv, cwd=self.cwd, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, bufsize=0)
                self.status = "running"
            if os.name != "nt":
                if self.process.stderr.readline(128) != ("READY %d\n" % self.process.pid).encode():
                    raise OSError("Cannot initialize task supervisor")
                with self.lock:
                    if self.stop_reason:
                        return
                    self.process.stdin.write(b"START\n")
                    self.process.stdin.flush()
            reader = threading.Thread(target=self.read_output, daemon=True)
            reader.start()
            reader_started = True
            if os.name == "nt":
                code = self.process.wait()
            else:
                line = self.process.stderr.readline(128)
                if not re.fullmatch(rb"EXIT -?\d+\n", line):
                    if not self.stop_reason:
                        raise OSError("Task supervisor exited before reporting the root command result")
                    code = None
                else:
                    code = int(line[5:])
            with self.lock:
                self.exit_code = code
                if self.lifecycle == "task" or self.stop_reason:
                    self.kill_tree()
            if self.job:
                self.wait_job_empty()
            elif self.process:
                self.wait_group_empty()
                if self.process.poll() is None:
                    try:
                        self.process.stdin.write(b"FINISH\n")
                        self.process.stdin.flush()
                    except BrokenPipeError:
                        pass
        except Exception as exc:
            with self.lock:
                self.error = self.error or str(exc)
        finally:
            # 每个收尾步骤独立尝试，资源清理失败也必须形成可查询的失败结果。
            def cleanup(action):
                try:
                    action()
                except Exception as exc:
                    with self.lock:
                        self.error = self.error or 'Task cleanup failed: ' + str(exc)

            with self.lock:
                cleanup(self.kill_tree)
            if self.process:
                cleanup(lambda: self.process.wait(timeout=5))
                if self.job:
                    cleanup(self.wait_job_empty)
                elif os.name != "nt" and not self.scope_empty:
                    cleanup(self.wait_group_empty)
                # 终态意味着不会再新增输出，不能用超时等待冒充已经读到 EOF。
                if reader_started:
                    cleanup(lambda: reader.join(None if self.scope_empty else 1))
                    if reader.is_alive():
                        with self.lock:
                            self.output_incomplete = True
                            self.error = self.error or 'Output collection is incomplete after losing task supervision'
                if not reader_started or not reader.is_alive():
                    cleanup(self.process.stdout.close)
                if os.name != "nt":
                    cleanup(self.process.stdin.close)
                    cleanup(self.process.stderr.close)
                if os.name == "nt" and self.process.returncode is not None:
                    with self.lock:
                        self.exit_code = self.process.returncode
                    cleanup(self.process._handle.Close)
            if self.job:
                cleanup(self.job.close)
            if self.script_path:
                cleanup(lambda: os.unlink(self.script_path))
            with self.lock:
                confirmed = self.process is None or self.scope_empty or (os.name == "nt" and self.job is None)
                self.status = (self.stop_reason or ("completed" if self.exit_code == 0 and not self.error else "failed")) if confirmed else "unknown"
            try:
                self.executor.log(self.id, self.executor.terminal_log.text("执行结束 | 状态: %s | 退出码: %s%s", "Finished | Status: %s | Exit code: %s%s", self.executor.terminal_log.status(self.status), self.exit_code, " | " + self.error if self.error else ""))
            finally:
                self.done.set()


def validate_public_url(value):
    p = urlsplit(value)
    if (p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password
            or p.path not in ('', '/') or p.query or p.fragment or '%' in p.netloc
            or p.hostname in ('0.0.0.0', '::') or p.port == 0):
        raise ValueError('--public-url must be a reachable HTTP(S) origin without credentials or paths')
    host = p.hostname.lower().encode('idna').decode('ascii')
    host = '[' + host + ']' if ':' in host else host
    port = p.port
    default = 443 if p.scheme == 'https' else 80
    return p.scheme + '://' + host + (':' + str(port) if port and port != default else '')


def url_hosts(url):
    p = urlsplit(url)
    hosts = {p.netloc.lower()}
    # 浏览器通常省略默认端口，也接受代理显式保留默认端口的 Host。
    if p.port is None:
        hosts.add(p.netloc.lower() + (':443' if p.scheme == 'https' else ':80'))
    elif p.port == (443 if p.scheme == 'https' else 80):
        hosts.add(p.netloc.rsplit(':', 1)[0].lower())
    return hosts


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16
    def __init__(self, executor, port, listen_address='127.0.0.1', public_url=''):
        address = ipaddress.ip_address(listen_address)
        if '%' in listen_address or address.is_multicast or str(address) == '255.255.255.255':
            raise ValueError('Listen address must be a local unicast or wildcard IP address')
        public_url = validate_public_url(public_url) if public_url else ''
        if address.is_unspecified and not public_url:
            raise ValueError('--public-url is required when listening on all interfaces')
        self.executor = executor
        self.slots = threading.BoundedSemaphore(16)
        self.address_family = socket.AF_INET6 if address.version == 6 else socket.AF_INET
        super().__init__((str(address), port), Handler)
        host = '[' + str(address) + ']' if address.version == 6 else str(address)
        self.listen_url = 'http://%s:%d' % (host, self.server_port)
        self.connection_url = public_url or self.listen_url
        # 只接受显式配置的访问入口和实际绑定地址，不信任转发头或任意 Host。
        self.allowed_hosts = url_hosts(self.connection_url)
        if not address.is_unspecified:
            self.allowed_hosts.update(url_hosts(self.listen_url))

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "LocalExecutor/1"
    protocol_version = "HTTP/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *args):
        pass  # 不记录凭据、命令正文或浏览器地址。

    def send_json(self, status, body):
        payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        if self.headers.get("Origin") == self.server.executor.origin:
            self.send_header("Access-Control-Allow-Origin", self.server.executor.origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(payload)
        self.close_connection = True

    def check_request(self, preflight=False):
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1 or hosts[0].lower() not in self.server.allowed_hosts:
            raise ApiError(403, "Invalid Host")
        if self.headers.get_all("Origin", []) != [self.server.executor.origin]:
            raise ApiError(403, "Origin is not authorized")
        if not preflight:
            actual = self.headers.get_all("Authorization", [])
            expected = "Bearer " + self.server.executor.token
            if len(actual) != 1 or not hmac.compare_digest(actual[0].encode(), expected.encode()):
                raise ApiError(401, "Invalid connection credentials")

    def handle_api(self):
        try:
            self.check_request(self.command == "OPTIONS")
            parsed = urlsplit(self.path)
            task_match = re.fullmatch(r"/v1/tasks/([a-zA-Z0-9_-]{8,80})(/cancel)?", parsed.path)
            known = parsed.path in ("/v1/info", "/v1/tasks") or task_match
            if not known:
                raise ApiError(404, "Unknown endpoint")
            if self.command == "OPTIONS":
                if self.headers.get("Access-Control-Request-Method") not in ("GET", "POST"):
                    raise ApiError(405, "Unsupported method")
                requested = {s.strip().lower() for s in self.headers.get("Access-Control-Request-Headers", "").split(",") if s.strip()}
                if not requested <= {"authorization", "content-type"}:
                    raise ApiError(403, "Unsupported request headers")
                self.send_json(200, {})
                return
            body = {}
            if self.command == "POST":
                lengths = self.headers.get_all("Content-Length", [])
                if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit():
                    raise ApiError(400, "A single Content-Length is required")
                size = int(lengths[0])
                if size > MAX_BODY:
                    raise ApiError(413, "Request is too large")
                if self.headers.get_content_type() != "application/json":
                    raise ApiError(415, "Expected application/json")
                raw = self.rfile.read(size)
                if len(raw) != size:
                    raise ApiError(400, "Incomplete body")
                body = json.loads(raw)
                if not isinstance(body, dict):
                    raise ApiError(400, "Expected an object")
            if self.command == "GET" and parsed.path == "/v1/info":
                result = self.server.executor.info()
            elif self.command == "POST" and parsed.path == "/v1/tasks":
                result = self.server.executor.submit(body)
            elif task_match:
                task = self.server.executor.get_task(task_match[1])
                if self.command == "POST" and task_match[2]:
                    task.stop("cancelled")
                    result = task.snapshot(0)
                elif self.command == "GET" and not task_match[2]:
                    query = parse_qs(parsed.query, keep_blank_values=True)
                    cursor = int(query.get("cursor", ["0"])[0])
                    max_chars = int(query.get("max_chars", [str(DEFAULT_READ_CHARS)])[0])
                    result = task.snapshot(cursor, max_chars)
                else:
                    raise ApiError(405, "Unsupported method")
            else:
                raise ApiError(405, "Unsupported method")
            self.send_json(200, result)
        except ApiError as exc:
            self.send_json(exc.status, {"error": exc.message})
        except (ValueError, UnicodeError):
            self.send_json(400, {"error": "Invalid request data"})
        except (TimeoutError, ConnectionError, OSError):
            self.close_connection = True

    do_GET = handle_api
    do_POST = handle_api
    do_OPTIONS = handle_api


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--listen-address", default="127.0.0.1")
    parser.add_argument("--public-url", default="")
    parser.add_argument("--token", default="")
    parser.add_argument("--language", choices=["zh-CN", "en-US"], default="en-US", help="Terminal log language")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Invalid port")
    try:
        executor = Executor(args.origin, args.cwd, token=args.token, language=args.language)
        server = Server(executor, args.port, args.listen_address, args.public_url)
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        parser.exit(1, str(exc) + "\n")
    connection = {"url": server.connection_url, "token": executor.token}
    text = executor.terminal_log.text
    print(text("命令执行器：请保持此终端打开，按 Ctrl+C 断开连接。", "Command executor: keep this terminal open. Ctrl+C disconnects."), file=sys.stderr, flush=True)
    print(text("命令使用当前用户权限执行，默认目录：%s。执行日志在此终端显示。", "Commands run with current user permissions. Default directory: %s. Logs appear in this terminal.", executor.cwd), file=sys.stderr, flush=True)
    print(text("请将以下连接信息粘贴到 AI Agent 的执行器连接框：", "Paste this connection into the AI Agent Executor connection dialog:"), file=sys.stderr, flush=True)
    print(text("监听地址：%s；浏览器访问地址：%s", "Listening: %s; browser access: %s", server.listen_url, server.connection_url), file=sys.stderr, flush=True)
    print(json.dumps(connection), flush=True)
    stop = threading.Event()
    def stop_signal(*_):
        stop.set()
    for name in ("SIGINT", "SIGTERM"):
        signal.signal(getattr(signal, name), stop_signal)
    server.timeout = 0.5
    try:
        while not stop.is_set():
            server.handle_request()
    finally:
        executor.close()
        server.server_close()
        print(text("执行器已停止。", "Executor stopped."), file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
