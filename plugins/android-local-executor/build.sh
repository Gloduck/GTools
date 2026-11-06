#!/usr/bin/env bash
# 使用现有 JDK 构建 Android DEX；下载依赖、编译缓存和测试依赖全部放入临时目录。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_DIR="${SCRIPT_DIR}/src/main/java"
TEST_DIR="${SCRIPT_DIR}/test/java"
OUTPUT_DIR="${SCRIPT_DIR}/build"
RUN_TESTS=false
PUBLISH=false

usage() {
  cat <<'EOF'
Usage: bash plugins/android-local-executor/build.sh [--test] [--publish] [--output-dir DIR]
  --test         Run shared JVM tests and build a separate device-test DEX; no device tools required
  --publish      Copy runtime DEX, checksum, launcher and license into frontend public assets
  --output-dir   Artifact directory (default: plugins/android-local-executor/build)
EOF
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --test) RUN_TESTS=true; shift ;;
    --publish) PUBLISH=true; shift ;;
    --output-dir) [[ $# -ge 2 ]] || { usage >&2; exit 1; }; OUTPUT_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done
for tool in java javac jar curl sha256sum; do
  command -v "$tool" >/dev/null || { printf 'Required build tool: %s\n' "$tool" >&2; exit 1; }
done
BUILD_TMP="$(mktemp -d "${TMPDIR:-/tmp}/executor-android-build.XXXXXXXX")"
trap 'rm -rf -- "$BUILD_TMP"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'Temporary build directory: %s\n' "$BUILD_TMP"

download() {
  local name="$1" url="$2" checksum="$3"
  curl --fail --location --silent --show-error --proto '=https' --tlsv1.2 --retry 2 --max-time 180 "$url" -o "${BUILD_TMP}/${name}"
  printf '%s  %s\n' "$checksum" "${BUILD_TMP}/${name}" | sha256sum --check --status
}
# 固定版本与摘要，避免构建时隐式升级；仅提取 Java 编译所需文件，不安装完整 SDK。
download build-tools.zip https://dl.google.com/android/repository/build-tools_r36_linux.zip 5d9ac77fb6ff43d9da518a337b4fcf8f9097113df531d99ccefe80ef7ce8250b
download platform.zip https://dl.google.com/android/repository/platform-36_r02.zip 37607369a28c5b640b3a7998868d45898ebcb777565a0e85f9acf36f29631d2e
download nanohttpd.jar https://repo.maven.apache.org/maven2/org/nanohttpd/nanohttpd/2.3.1/nanohttpd-2.3.1.jar de864c47818157141a24c9acb36df0c47d7bf15b7ff48c90610f3eb4e5df0e58
(cd "$BUILD_TMP" && jar xf build-tools.zip android-16/lib/d8.jar && jar xf platform.zip android-36/android.jar)
mv "${BUILD_TMP}/android-16/lib/d8.jar" "${BUILD_TMP}/d8.jar"
mv "${BUILD_TMP}/android-36/android.jar" "${BUILD_TMP}/android.jar"
mkdir -p "${BUILD_TMP}/classes" "${BUILD_TMP}/dex"
mapfile -d '' SOURCES < <(find "$SOURCE_DIR" -name '*.java' -print0)
javac -J-Xmx256m -encoding UTF-8 --release 8 \
  -cp "${BUILD_TMP}/android.jar:${BUILD_TMP}/nanohttpd.jar" -d "${BUILD_TMP}/classes" "${SOURCES[@]}"
jar cf "${BUILD_TMP}/executor.jar" -C "${BUILD_TMP}/classes" .
java -Xmx512m -cp "${BUILD_TMP}/d8.jar" com.android.tools.r8.D8 --release --min-api 26 \
  --lib "${BUILD_TMP}/android.jar" --output "${BUILD_TMP}/dex" "${BUILD_TMP}/executor.jar" "${BUILD_TMP}/nanohttpd.jar"

if [[ "$RUN_TESTS" == true ]]; then
  # JVM 测试才使用 JSON 兼容库；Android 产物始终使用系统 org.json。
  download json.jar https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar 3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed
  mkdir -p "${BUILD_TMP}/test-classes" "${BUILD_TMP}/test-dex"
  mapfile -d '' TEST_SOURCES < <(find "$TEST_DIR" -name '*.java' -print0)
  javac -J-Xmx256m -encoding UTF-8 --release 8 \
    -cp "${BUILD_TMP}/android.jar:${BUILD_TMP}/executor.jar:${BUILD_TMP}/nanohttpd.jar" -d "${BUILD_TMP}/test-classes" "${TEST_SOURCES[@]}"
  jar cf "${BUILD_TMP}/tests.jar" -C "${BUILD_TMP}/test-classes" .
  java -Xmx256m -cp "${BUILD_TMP}/tests.jar:${BUILD_TMP}/executor.jar:${BUILD_TMP}/nanohttpd.jar:${BUILD_TMP}/json.jar" dev.executor.test.ExecutorTests "$BUILD_TMP"
  java -Xmx512m -cp "${BUILD_TMP}/d8.jar" com.android.tools.r8.D8 --release --min-api 26 \
    --lib "${BUILD_TMP}/android.jar" --output "${BUILD_TMP}/test-dex" \
    "${BUILD_TMP}/executor.jar" "${BUILD_TMP}/nanohttpd.jar" "${BUILD_TMP}/tests.jar"
fi

[[ $(wc -c < "${BUILD_TMP}/dex/classes.dex") -lt 1048576 ]] || { echo 'Executor exceeds the 1 MiB artifact budget' >&2; exit 1; }
mkdir -p "$OUTPUT_DIR"
cp "${BUILD_TMP}/dex/classes.dex" "${OUTPUT_DIR}/executor.dex"
cp "${SCRIPT_DIR}/NOTICE.txt" "${OUTPUT_DIR}/executor.NOTICE.txt"
cp "${SCRIPT_DIR}/bootstrap.sh" "${OUTPUT_DIR}/bootstrap-android.sh"
(cd "$OUTPUT_DIR" && sha256sum executor.dex > executor.dex.sha256)
if [[ "$RUN_TESTS" == true ]]; then cp "${BUILD_TMP}/test-dex/classes.dex" "${OUTPUT_DIR}/executor-tests.dex"; fi
if [[ "$PUBLISH" == true ]]; then
  cp "${OUTPUT_DIR}/executor.dex" "${OUTPUT_DIR}/executor.dex.sha256" "${OUTPUT_DIR}/executor.NOTICE.txt" "${OUTPUT_DIR}/bootstrap-android.sh" "${PROJECT_ROOT}/frontend/public/local-executor/v1/"
fi
printf 'Built: %s/executor.dex (%s bytes)\n' "$OUTPUT_DIR" "$(wc -c < "${OUTPUT_DIR}/executor.dex")"
if [[ "$RUN_TESTS" == true ]]; then printf 'Device tests: %s/executor-tests.dex (not published)\n' "$OUTPUT_DIR"; fi
