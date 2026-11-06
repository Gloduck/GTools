#!/usr/bin/env python3
"""GTools 命令执行端，仅依赖 Python 3.8 及以上版本的标准库。

不连接远程后端，凭据只输出到终端，每个任务使用独立进程组。
命令使用启动服务的当前用户权限执行。
"""
import argparse
import base64
import codecs
import ctypes
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

VERSION = 1
MAX_BODY = 128 * 1024
MAX_OUTPUT_CHARS = 256 * 1024
TASK_ID = re.compile(r"^[a-zA-Z0-9_-]{8,80}$")
FINAL = {"completed", "failed", "cancelled"}


def powershell_arguments(command):
    # 使用终端默认格式化管道，确保对象和后续文本在退出前完成输出。
    # 文本模式保留错误和警告；关闭非交互进度，避免 CLIXML 混入任务日志。
    script = ("[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); "
              "$env:PYTHONIOENCODING='utf-8'; $ProgressPreference='SilentlyContinue'; "
              "$global:LASTEXITCODE=0; & {\n" + command
              + "\n} | Out-Default; if (-not $?) { exit 1 }; exit $LASTEXITCODE")
    return ["-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text",
            "-EncodedCommand", base64.b64encode(script.encode("utf-16le")).decode()]


class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


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
    def __init__(self, origin, cwd, log_stream=None):
        self.origin = validate_origin(origin)
        self.cwd = str(Path(cwd).resolve(strict=True))
        if not Path(self.cwd).is_dir():
            raise ValueError("Working directory is not a directory")
        self.token = secrets.token_urlsafe(32)
        self.tasks = {}
        self.lock = threading.RLock()
        self.closed = False
        self.shells = ["powershell", "cmd"] if os.name == "nt" else ["sh"]
        self.log_stream = log_stream if log_stream is not None else sys.stderr
        self.log_lock = threading.Lock()

    def log(self, task_id, text):
        # 每条终端记录带任务编号，便于区分并发命令及对应的 AI 工具结果。
        # 日志输出异常不改变命令执行结果。
        if not text:
            return
        try:
            with self.log_lock:
                self.log_stream.write("[%s] %s%s" % (task_id, text, "" if text.endswith("\n") else "\n"))
                self.log_stream.flush()
        except (OSError, ValueError, UnicodeError):
            pass

    def info(self):
        return {"protocol_version": VERSION, "runtime": "python", "platform": sys.platform,
                "shell": self.shells[0], "shells": self.shells, "default_cwd": self.cwd,
                "output_buffer_chars": MAX_OUTPUT_CHARS}

    def submit(self, body):
        task_id = body.get("id")
        command = body.get("command")
        shell = body.get("shell", self.shells[0])
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
        fingerprint = hashlib.sha256(json.dumps([command, cwd, shell], ensure_ascii=False).encode()).hexdigest()
        with self.lock:
            if self.closed:
                raise ApiError(410, "Executor is closed")
            if task_id in self.tasks:
                if self.tasks[task_id].fingerprint != fingerprint:
                    raise ApiError(409, "Task id already belongs to different execution content")
                return self.tasks[task_id].snapshot(0)
            task = Task(self, task_id, command, cwd, fingerprint, shell)
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


class Task:
    def __init__(self, executor, task_id, command, cwd, fingerprint, shell):
        self.executor, self.id, self.command, self.cwd = executor, task_id, command, cwd
        self.fingerprint = fingerprint
        self.shell, self.script_path = shell, None
        self.lock = threading.RLock()
        self.status, self.exit_code, self.error = "queued", None, ""
        self.output, self.output_start = "", 0
        self.truncated = False
        self.process, self.job, self.stop_reason = None, None, None
        self.done = threading.Event()
        self.created_at = time.time()

    def snapshot(self, cursor):
        with self.lock:
            total = self.output_start + len(self.output)
            if cursor < 0 or cursor > total:
                raise ApiError(400, "Invalid output cursor")
            start = max(cursor, self.output_start)
            end = min(total, start + 16384)
            return {"id": self.id, "status": self.status, "cwd": self.cwd, "shell": self.shell,
                    "output": self.output[start - self.output_start:end - self.output_start],
                    "cursor": end, "has_more": end < total, "exit_code": self.exit_code,
                    "truncated": self.truncated, "output_lost": cursor < self.output_start,
                    "error": self.error, "created_at": self.created_at}

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
            if self.status in FINAL:
                return
            if self.stop_reason is None:
                self.stop_reason = reason
            self.status = "cancelling"
            self.kill_tree()

    def kill_tree(self):
        if self.job:
            self.job.close()
        elif self.process:
            try:
                if os.name == "nt":
                    self.process.kill()
                else:
                    os.killpg(self.process.pid, signal.SIGKILL)
            except (ProcessLookupError, OSError):
                pass

    def read_output(self):
        decoder = codecs.getincrementaldecoder("utf-8")("replace")
        try:
            while True:
                chunk = self.process.stdout.read(4096)
                if not chunk:
                    break
                with self.lock:
                    text = decoder.decode(chunk)
                    self.append_output(text)
                self.executor.log(self.id, text)
        finally:
            with self.lock:
                text = decoder.decode(b"", final=True)
                self.append_output(text)
            self.executor.log(self.id, text)

    def run(self):
        reader = None
        self.executor.log(self.id, "开始执行 | Shell: %s | 目录: %s\n%s" % (self.shell, self.cwd, self.command))
        try:
            with self.lock:
                if self.stop_reason:
                    self.status = self.stop_reason
                    return
                env = os.environ.copy()
                # 不通过子进程环境变量传递本机连接凭据。
                for key in list(env):
                    if key.startswith("GTOOLS_LOCAL_"):
                        del env[key]
                if os.name == "nt":
                    system = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
                    if self.shell == "cmd":
                        # 批处理文件原样保存多行命令，避免再次经过 Python 的 argv 引号转换。
                        with tempfile.NamedTemporaryFile(mode="w", suffix=".cmd", prefix="gtools-task-", encoding="utf-8", newline="", delete=False) as script_file:
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
                    argv = ["/bin/sh", "-c", self.command]
                    self.process = subprocess.Popen(argv, cwd=self.cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, bufsize=0)
                self.status = "running"
            reader = threading.Thread(target=self.read_output, daemon=True)
            reader.start()
            self.process.wait()
            with self.lock:
                self.kill_tree()  # 前台任务退出时清理同组后台进程。
            reader.join(timeout=3)
            with self.lock:
                self.exit_code = self.process.returncode
                self.status = self.stop_reason or ("completed" if self.exit_code == 0 else "failed")
        except Exception as exc:
            with self.lock:
                self.kill_tree()
                self.status = self.stop_reason or "failed"
                self.error = str(exc)
        finally:
            if self.process:
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                if reader is None or not reader.is_alive():
                    self.process.stdout.close()
                if os.name == "nt" and self.process.returncode is not None:
                    self.process._handle.Close()
            if self.script_path:
                try:
                    os.unlink(self.script_path)
                except OSError as exc:
                    self.error = self.error or "Cannot remove temporary command script: " + str(exc)
            self.executor.log(self.id, "执行结束 | 状态: %s | 退出码: %s%s" % (self.status, self.exit_code, " | " + self.error if self.error else ""))
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
    server_version = "GToolsLocal/1"
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
                    cursor = int(parse_qs(parsed.query).get("cursor", ["0"])[0])
                    result = task.snapshot(cursor)
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
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("Invalid port")
    try:
        executor = Executor(args.origin, args.cwd)
        server = Server(executor, args.port, args.listen_address, args.public_url)
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        parser.exit(1, str(exc) + "\n")
    connection = {"url": server.connection_url, "token": executor.token}
    print("GTools executor — keep this terminal open. Ctrl+C disconnects.", file=sys.stderr, flush=True)
    print("命令使用当前用户权限执行，默认目录：%s。执行日志在此终端显示。" % executor.cwd, file=sys.stderr, flush=True)
    print("Paste this connection into the AI Agent Executor connection dialog:", file=sys.stderr, flush=True)
    print("监听地址：%s；浏览器访问地址：%s" % (server.listen_url, server.connection_url), file=sys.stderr, flush=True)
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
        print("Executor stopped.", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
