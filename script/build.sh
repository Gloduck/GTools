#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
FRONTEND_DIST_DIR="${FRONTEND_DIR}/dist"
BACKEND_DIR="${PROJECT_ROOT}/backend"
BACKEND_FRONT_DIR="${BACKEND_DIR}/src/main/resources/META-INF/resources"
BACKEND_TARGET_DIR="${BACKEND_DIR}/target"
ROOT_TARGET_DIR="${PROJECT_ROOT}/target"
CONFIG_FILE="${BACKEND_DIR}/src/main/resources/config.json"
INCLUDE_DIR="${PROJECT_ROOT}/include"

APP_NAME="GTools"
NATIVE_FILE_EXTENSION=""

case "$(uname -s 2>/dev/null || printf '')" in
  MINGW*|MSYS*|CYGWIN*)
    NATIVE_FILE_EXTENSION=".exe"
    ;;
esac

SHOULD_CLEAN="false"
BUILD_TARGET=""
ARCHIVE_FILE="${ROOT_TARGET_DIR}/${APP_NAME}.tar.gz"
OUTPUT_CONFIG_FILE="${ROOT_TARGET_DIR}/config.json"
OUTPUT_JAR_FILE="${ROOT_TARGET_DIR}/${APP_NAME}.jar"
OUTPUT_NATIVE_FILE="${ROOT_TARGET_DIR}/${APP_NAME}${NATIVE_FILE_EXTENSION}"

usage() {
  cat <<'EOF'
Usage: ./build.sh [clean] [buildJar|buildNative]

Examples:
  ./build.sh buildJar
  ./build.sh buildNative
  ./build.sh clean
  ./build.sh clean buildJar
  ./build.sh buildNative clean
EOF
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    return
  fi
  if [[ "${NATIVE_FILE_EXTENSION}" == ".exe" ]] && command -v "$1.cmd" >/dev/null 2>&1; then
    return
  fi
  local hint="${2:-}"
  fail "missing required command: $1${hint:+; ${hint}}"
}

check_native_toolchain() {
  require_command native-image "install GraalVM Native Image"

  if [[ "$(uname -s 2>/dev/null || printf '')" != "Linux" ]]; then
    return
  fi

  require_command gcc "install build-essential"
  require_command objcopy "install binutils"

  local check_dir
  check_dir="$(mktemp -d)"
  if ! printf '#include <zlib.h>\nint main(void) { return zlibVersion() == 0; }\n' \
    | gcc -x c - -lz -o "${check_dir}/zlib-check" >/dev/null 2>&1; then
    rm -rf "${check_dir}"
    fail "zlib development files are required for native builds; install zlib1g-dev"
  fi
  rm -rf "${check_dir}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      clean)
        SHOULD_CLEAN="true"
        shift
        ;;
      buildJar)
        [[ -z "${BUILD_TARGET}" ]] || fail "build target already set: ${BUILD_TARGET}"
        BUILD_TARGET="jar"
        shift
        ;;
      buildNative)
        [[ -z "${BUILD_TARGET}" ]] || fail "build target already set: ${BUILD_TARGET}"
        BUILD_TARGET="native"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "unsupported argument: $1"
        ;;
    esac
  done

  if [[ "${SHOULD_CLEAN}" != "true" && -z "${BUILD_TARGET}" ]]; then
    fail "at least one action is required: clean, buildJar, buildNative"
  fi
}

clean_artifacts() {
  printf '==> Cleaning build directories\n'
  rm -rf "${FRONTEND_DIST_DIR}"
  rm -rf "${BACKEND_FRONT_DIR}"
  rm -rf "${BACKEND_TARGET_DIR}"
  rm -rf "${ROOT_TARGET_DIR}"
}

prepare_output_dir() {
  mkdir -p "${ROOT_TARGET_DIR}"
  rm -f "${ARCHIVE_FILE}"
  rm -f "${OUTPUT_JAR_FILE}"
  rm -f "${OUTPUT_NATIVE_FILE}"
  rm -f "${OUTPUT_CONFIG_FILE}"
}

copy_frontend_dist() {
  rm -rf "${BACKEND_FRONT_DIR}"
  mkdir -p "${BACKEND_FRONT_DIR}"
  cp -R "${FRONTEND_DIST_DIR}/." "${BACKEND_FRONT_DIR}/"
}

build_frontend() {
  printf '==> Building frontend\n'
  npm run build --prefix "${FRONTEND_DIR}"
  [[ -d "${FRONTEND_DIST_DIR}" ]] || fail "frontend build output not found: ${FRONTEND_DIST_DIR}"
  copy_frontend_dist
}

build_backend_jar() {
  printf '==> Building backend jar\n'
  mvn -f "${BACKEND_DIR}/pom.xml" clean package
  JAVA_ARTIFACT="$(find "${BACKEND_TARGET_DIR}" -maxdepth 1 -type f -name "${APP_NAME}*-runner.jar" | sort | tail -n 1)"
  [[ -f "${JAVA_ARTIFACT}" ]] || fail "jar artifact not found: ${JAVA_ARTIFACT}"
}

build_backend_native() {
  printf '==> Building backend native image\n'
  mvn -f "${BACKEND_DIR}/pom.xml" clean package -Dquarkus.native.enabled=true -Dquarkus.native.native-image-xmx=2g -DskipTests
  JAVA_ARTIFACT="$(find "${BACKEND_TARGET_DIR}" -maxdepth 1 -type f \( -name "${APP_NAME}*-runner" -o -name "${APP_NAME}*-runner.exe" \) | sort | tail -n 1)"
  [[ -f "${JAVA_ARTIFACT}" ]] || fail "native artifact not found: ${JAVA_ARTIFACT}"
}

assemble_artifacts() {
  printf '==> Assembling release package\n'
  case "${BUILD_TARGET}" in
    jar)
      cp "${JAVA_ARTIFACT}" "${OUTPUT_JAR_FILE}"
      PACKAGE_ARTIFACT="$(basename "${OUTPUT_JAR_FILE}")"
      ;;
    native)
      cp "${JAVA_ARTIFACT}" "${OUTPUT_NATIVE_FILE}"
      PACKAGE_ARTIFACT="$(basename "${OUTPUT_NATIVE_FILE}")"
      ;;
    *)
      fail "unsupported build target: ${BUILD_TARGET}"
      ;;
  esac
  cp "${CONFIG_FILE}" "${OUTPUT_CONFIG_FILE}"
  cp -R "${INCLUDE_DIR}/." "${ROOT_TARGET_DIR}/"
  mapfile -t INCLUDE_ARTIFACTS < <(find "${INCLUDE_DIR}" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort)
  (
    cd "${ROOT_TARGET_DIR}"
    archive_items=("${PACKAGE_ARTIFACT}" "$(basename "${OUTPUT_CONFIG_FILE}")")
    for include_artifact in "${INCLUDE_ARTIFACTS[@]}"; do
      archive_items+=("${include_artifact}")
    done
    tar -czf "${ARCHIVE_FILE}" "${archive_items[@]}"
  )
}

run_build() {
  [[ -d "${FRONTEND_DIR}" ]] || fail "frontend directory not found: ${FRONTEND_DIR}"
  [[ -d "${BACKEND_DIR}" ]] || fail "backend directory not found: ${BACKEND_DIR}"
  [[ -d "${INCLUDE_DIR}" ]] || fail "include directory not found: ${INCLUDE_DIR}"
  [[ -f "${CONFIG_FILE}" ]] || fail "config file not found: ${CONFIG_FILE}"

  require_command node
  require_command npm
  require_command java
  require_command mvn
  require_command tar

  if [[ "${BUILD_TARGET}" == "native" ]]; then
    check_native_toolchain
  fi

  prepare_output_dir
  build_frontend

  case "${BUILD_TARGET}" in
    jar)
      build_backend_jar
      ;;
    native)
      build_backend_native
      ;;
    *)
      fail "unsupported build target: ${BUILD_TARGET}"
      ;;
  esac

  assemble_artifacts

  printf '==> Done\n'
  printf 'Build target: %s\n' "${BUILD_TARGET}"
  printf 'Output directory: %s\n' "${ROOT_TARGET_DIR}"
  printf 'Archive file: %s\n' "${ARCHIVE_FILE}"
}

main() {
  parse_args "$@"

  if [[ "${SHOULD_CLEAN}" == "true" ]]; then
    clean_artifacts
  fi

  if [[ -n "${BUILD_TARGET}" ]]; then
    run_build
  fi
}

main "$@"
