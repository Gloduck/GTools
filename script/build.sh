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
BACKEND_FRONT_BACKUP_DIR=""

case "$(uname -s 2>/dev/null || printf '')" in
  MINGW*|MSYS*|CYGWIN*)
    NATIVE_FILE_EXTENSION=".exe"
    ;;
esac

SHOULD_CLEAN="false"
BUILD_TARGET=""
PACKAGE_MODE="bundled"
ARCHIVE_FILE="${ROOT_TARGET_DIR}/${APP_NAME}.tar.gz"
BACKEND_OUTPUT_DIR="${ROOT_TARGET_DIR}/backend"
FRONTEND_OUTPUT_DIR="${ROOT_TARGET_DIR}/frontend"
BACKEND_ARCHIVE_FILE="${ROOT_TARGET_DIR}/${APP_NAME}-backend.tar.gz"
FRONTEND_ARCHIVE_FILE="${ROOT_TARGET_DIR}/${APP_NAME}-frontend.tar.gz"
OUTPUT_CONFIG_FILE="${ROOT_TARGET_DIR}/config.json"
OUTPUT_JAR_FILE="${ROOT_TARGET_DIR}/${APP_NAME}.jar"
OUTPUT_NATIVE_FILE="${ROOT_TARGET_DIR}/${APP_NAME}${NATIVE_FILE_EXTENSION}"

usage() {
  cat <<'EOF'
Usage: ./build.sh [clean] [buildFrontend|buildJar|buildNative] [--mode bundled|separate]

Examples:
  ./build.sh buildFrontend
  ./build.sh buildJar
  ./build.sh buildNative
  ./build.sh clean buildJar --mode separate
  ./build.sh clean buildNative --mode separate
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
      buildFrontend)
        [[ -z "${BUILD_TARGET}" ]] || fail "build target already set: ${BUILD_TARGET}"
        BUILD_TARGET="frontend"
        shift
        ;;
      buildNative)
        [[ -z "${BUILD_TARGET}" ]] || fail "build target already set: ${BUILD_TARGET}"
        BUILD_TARGET="native"
        shift
        ;;
      --mode)
        [[ $# -ge 2 ]] || fail "--mode requires a value: bundled or separate"
        PACKAGE_MODE="$2"
        shift 2
        ;;
      --mode=*)
        PACKAGE_MODE="${1#*=}"
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
    fail "at least one action is required: clean, buildFrontend, buildJar, buildNative"
  fi

  case "${PACKAGE_MODE}" in
    bundled|separate)
      ;;
    *)
      fail "unsupported package mode: ${PACKAGE_MODE}; expected bundled or separate"
      ;;
  esac
}

clean_artifacts() {
  printf '==> Cleaning build directories\n'
  rm -rf "${FRONTEND_DIST_DIR}"
  rm -rf "${BACKEND_TARGET_DIR}"
  rm -rf "${ROOT_TARGET_DIR}"
}

prepare_output_dir() {
  mkdir -p "${ROOT_TARGET_DIR}"
  rm -f "${ARCHIVE_FILE}"
  rm -f "${OUTPUT_JAR_FILE}"
  rm -f "${OUTPUT_NATIVE_FILE}"
  rm -f "${OUTPUT_CONFIG_FILE}"
  rm -f "${BACKEND_ARCHIVE_FILE}"
  rm -f "${FRONTEND_ARCHIVE_FILE}"
  rm -rf "${BACKEND_OUTPUT_DIR}"
  rm -rf "${FRONTEND_OUTPUT_DIR}"
}

copy_frontend_dist() {
  rm -rf "${BACKEND_FRONT_DIR}"
  mkdir -p "${BACKEND_FRONT_DIR}"
  cp -R "${FRONTEND_DIST_DIR}/." "${BACKEND_FRONT_DIR}/"
}

hide_backend_frontend() {
  [[ -d "${BACKEND_FRONT_DIR}" ]] || return 0

  BACKEND_FRONT_BACKUP_DIR="$(mktemp -d)"
  mv "${BACKEND_FRONT_DIR}" "${BACKEND_FRONT_BACKUP_DIR}/resources"
}

restore_backend_frontend() {
  [[ -n "${BACKEND_FRONT_BACKUP_DIR}" ]] || return 0

  rm -rf "${BACKEND_FRONT_DIR}"
  mkdir -p "$(dirname "${BACKEND_FRONT_DIR}")"
  mv "${BACKEND_FRONT_BACKUP_DIR}/resources" "${BACKEND_FRONT_DIR}"
  rm -rf "${BACKEND_FRONT_BACKUP_DIR}"
  BACKEND_FRONT_BACKUP_DIR=""
}

build_frontend() {
  printf '==> Building frontend\n'
  npm run build --prefix "${FRONTEND_DIR}"
  [[ -d "${FRONTEND_DIST_DIR}" ]] || fail "frontend build output not found: ${FRONTEND_DIST_DIR}"
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

copy_backend_artifacts() {
  local output_dir="$1"

  mkdir -p "${output_dir}"
  case "${BUILD_TARGET}" in
    jar)
      cp "${JAVA_ARTIFACT}" "${output_dir}/${APP_NAME}.jar"
      PACKAGE_ARTIFACT="${APP_NAME}.jar"
      ;;
    native)
      cp "${JAVA_ARTIFACT}" "${output_dir}/${APP_NAME}${NATIVE_FILE_EXTENSION}"
      PACKAGE_ARTIFACT="${APP_NAME}${NATIVE_FILE_EXTENSION}"
      ;;
    *)
      fail "unsupported build target: ${BUILD_TARGET}"
      ;;
  esac
  cp "${CONFIG_FILE}" "${output_dir}/config.json"
  cp -R "${INCLUDE_DIR}/." "${output_dir}/"
}

archive_backend_artifacts() {
  local output_dir="$1"
  local archive_file="$2"

  mapfile -t INCLUDE_ARTIFACTS < <(find "${INCLUDE_DIR}" -mindepth 1 -maxdepth 1 -exec basename {} \; | sort)
  (
    cd "${output_dir}"
    archive_items=("${PACKAGE_ARTIFACT}" "config.json")
    for include_artifact in "${INCLUDE_ARTIFACTS[@]}"; do
      archive_items+=("${include_artifact}")
    done
    tar -czf "${archive_file}" "${archive_items[@]}"
  )
}

assemble_frontend_artifacts() {
  mkdir -p "${FRONTEND_OUTPUT_DIR}"
  cp -R "${FRONTEND_DIST_DIR}/." "${FRONTEND_OUTPUT_DIR}/"
  tar -czf "${FRONTEND_ARCHIVE_FILE}" -C "${FRONTEND_OUTPUT_DIR}" .
}

assemble_artifacts() {
  printf '==> Assembling release package (%s)\n' "${PACKAGE_MODE}"

  case "${PACKAGE_MODE}" in
    bundled)
      copy_backend_artifacts "${ROOT_TARGET_DIR}"
      archive_backend_artifacts "${ROOT_TARGET_DIR}" "${ARCHIVE_FILE}"
      ;;
    separate)
      copy_backend_artifacts "${BACKEND_OUTPUT_DIR}"
      archive_backend_artifacts "${BACKEND_OUTPUT_DIR}" "${BACKEND_ARCHIVE_FILE}"
      assemble_frontend_artifacts
      ;;
  esac
}

run_build() {
  [[ -d "${FRONTEND_DIR}" ]] || fail "frontend directory not found: ${FRONTEND_DIR}"

  require_command node
  require_command npm
  require_command tar

  prepare_output_dir
  build_frontend

  if [[ "${BUILD_TARGET}" == "frontend" ]]; then
    printf '==> Assembling frontend release package\n'
    assemble_frontend_artifacts
    printf '==> Done\n'
    printf 'Build target: frontend\n'
    printf 'Output directory: %s\n' "${FRONTEND_OUTPUT_DIR}"
    printf 'Frontend archive: %s\n' "${FRONTEND_ARCHIVE_FILE}"
    return
  fi

  [[ -d "${BACKEND_DIR}" ]] || fail "backend directory not found: ${BACKEND_DIR}"
  [[ -d "${INCLUDE_DIR}" ]] || fail "include directory not found: ${INCLUDE_DIR}"
  [[ -f "${CONFIG_FILE}" ]] || fail "config file not found: ${CONFIG_FILE}"

  require_command java
  require_command mvn

  if [[ "${BUILD_TARGET}" == "native" ]]; then
    check_native_toolchain
  fi

  if [[ "${PACKAGE_MODE}" == "bundled" ]]; then
    copy_frontend_dist
  else
    hide_backend_frontend
    trap restore_backend_frontend EXIT
  fi

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
  restore_backend_frontend
  trap - EXIT

  printf '==> Done\n'
  printf 'Build target: %s\n' "${BUILD_TARGET}"
  printf 'Package mode: %s\n' "${PACKAGE_MODE}"
  printf 'Output directory: %s\n' "${ROOT_TARGET_DIR}"
  if [[ "${PACKAGE_MODE}" == "bundled" ]]; then
    printf 'Archive file: %s\n' "${ARCHIVE_FILE}"
  else
    printf 'Backend archive: %s\n' "${BACKEND_ARCHIVE_FILE}"
    printf 'Frontend archive: %s\n' "${FRONTEND_ARCHIVE_FILE}"
  fi
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
