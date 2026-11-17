#!/system/bin/sh
# 下载并启动 DEX，使用当前终端权限；不安装应用、不自动提权。
set -eu
base=${1:?Asset base URL is required}
origin=${2:?Browser origin is required}
listen=${3:-127.0.0.1}
port=${4:-0}
public_url=${5:-}
token=${6:-}
language=${7:-en-US}
case "$language" in zh-CN|en-US) ;; *) echo 'Language must be zh-CN or en-US' >&2; exit 1 ;; esac
message() {
  if [ "$language" = zh-CN ]; then printf '%s\n' "$1"; else printf '%s\n' "$2"; fi
}
base=${base%/}
case "$base" in https://*|http://*) ;; *) message '资源地址必须使用 HTTP(S)' 'Expected an HTTP(S) asset URL' >&2; exit 1 ;; esac
[ -x /system/bin/app_process ] || { message '此启动脚本需要 Android app_process' 'This launcher requires Android app_process' >&2; exit 1; }
if command -v curl >/dev/null 2>&1; then downloader=curl
elif command -v wget >/dev/null 2>&1; then downloader=wget
else
  message "未找到 curl/wget，请用浏览器下载 $base/executor.dex，并通过 Android app_process 手动启动。" "No curl/wget available. Download $base/executor.dex in your browser; manual startup with Android app_process is required." >&2
  exit 1
fi
umask 077
# 普通应用终端未必能写 /data/local/tmp，优先使用终端自己的临时目录。
work=$(mktemp -d "${TMPDIR:-$PWD}/executor-android.XXXXXXXX")
child=
cleanup() {
  if [ -n "$child" ]; then kill "$child" 2>/dev/null || :; wait "$child" 2>/dev/null || :; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
download() {
  if [ "$downloader" = curl ]; then curl -fLsS "$1" -o "$2"
  else wget -q -O "$2" "$1"; fi
}
download "$base/executor.dex" "$work/executor.dex"
download "$base/executor.dex.sha256" "$work/executor.dex.sha256"
# 校验文件只允许描述当前 DEX，不能借校验清单读取其他路径。
expected=$(cat "$work/executor.dex.sha256")
case "$expected" in *'  executor.dex') expected=${expected%'  executor.dex'} ;; *) message '无效的校验文件' 'Invalid checksum file' >&2; exit 1 ;; esac
case "$expected" in *[!0-9a-fA-F]*|'') message '无效的校验值' 'Invalid checksum' >&2; exit 1 ;; esac
[ "${#expected}" -eq 64 ] || { message '校验值长度不正确' 'Invalid checksum length' >&2; exit 1; }
actual=$(/system/bin/toybox sha256sum "$work/executor.dex")
[ "${actual%% *}" = "$expected" ] || { message 'DEX 校验失败' 'DEX checksum mismatch' >&2; exit 1; }
# Android 新版本要求动态加载的代码为只读；下载目录仅当前用户可访问。
chmod 400 "$work/executor.dex"
CLASSPATH="$work/executor.dex" /system/bin/app_process / dev.executor.android.Main \
  --origin "$origin" --listen-address "$listen" --port "$port" --public-url "$public_url" --cwd "$PWD" --token "$token" --language "$language" &
child=$!
wait "$child"
child=
