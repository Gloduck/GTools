#!/bin/sh
# 在目标工作目录运行，不安装依赖或修改系统权限。
set -eu
base=${1:?Usage: bootstrap.sh STATIC_BASE_URL WEB_ORIGIN [LISTEN_IP] [PORT] [PUBLIC_URL]}
origin=${2:?Web origin is required}
listen_address=${3:-127.0.0.1}
port=${4:-0}
public_url=${5:-}
case "$base" in https://*|http://localhost:*|http://127.0.0.1:*) ;; *) echo 'Use HTTPS for script downloads (HTTP is allowed only for local development).' >&2; exit 1;; esac
if [ "$(uname -s)" = Darwin ] && ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
  if [ "$(command -v python3 2>/dev/null || true)" = /usr/bin/python3 ]; then
    echo 'No usable Python 3 found. This script will not trigger developer-tools installation.' >&2
    exit 1
  fi
fi
if ! command -v python3 >/dev/null 2>&1 || ! python3 -c 'import sys; sys.exit(sys.version_info < (3,8))' >/dev/null 2>&1; then
  echo 'Python 3.8 or newer is required. No packages were installed.' >&2
  exit 1
fi
# 使用 Python 验证下载证书，执行端退出后清理私有缓存。
# 保持用户当前工作目录，不切换到脚本缓存目录。
exec python3 - "$base" "$origin" "$listen_address" "$port" "$public_url" <<'PY'
import os, pathlib, signal, subprocess, sys, tempfile, urllib.request
base, origin, listen_address, port, public_url = sys.argv[1:]
url = base.rstrip('/') + '/executor.py'
with tempfile.TemporaryDirectory(prefix='executor-bootstrap-') as directory:
    path = pathlib.Path(directory) / 'executor.py'
    with urllib.request.urlopen(url, timeout=30) as response:
        if not (response.url.startswith('https://') or response.url.startswith(('http://127.0.0.1:', 'http://localhost:'))):
            raise SystemExit('Refusing an insecure script redirect')
        source = response.read(512 * 1024 + 1)
        if len(source) > 512 * 1024:
            raise SystemExit('Executor script is too large')
    path.write_bytes(source)
    child = subprocess.Popen([sys.executable, str(path), '--origin', origin, '--listen-address', listen_address, '--port', port, '--public-url', public_url])
    def stop(*_):
        if child.poll() is None:
            child.terminate()
    signal.signal(signal.SIGTERM, stop)
    try:
        code = child.wait()
    except KeyboardInterrupt:
        stop()
        code = child.wait()
    raise SystemExit(code)
PY
