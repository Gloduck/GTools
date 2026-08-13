#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
TARGET_DIR="${PROJECT_ROOT}/target"

ACTION=""
REMOTE_ADDRESS=""
REMOTE_PORT=""
REMOTE_USER=""
REMOTE_PASSWORD=""
REMOTE_DEPLOY_PATH=""
SSH_TARGET=""
INCLUDE_CONFIG="false"

usage() {
  cat <<'EOF'
Usage: ./script/remote-manage.sh <push|start|restart|stop|status> [options]

Options:
  --remoteAddress <value>
  --remotePort <value>
  --remoteUser <value>
  --remotePassword <value>
  --remoteDeployPath <value>
  --includeConfig        Include target/config.json when pushing
  -h, --help

Examples:
  ./script/remote-manage.sh push
  ./script/remote-manage.sh start --remoteAddress 127.0.0.1 --remoteDeployPath /opt/GTools
  ./script/remote-manage.sh restart --remoteAddress 127.0.0.1 --remoteUser root --remotePassword secret --remoteDeployPath /opt/GTools
EOF
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    local hint="${2:-}"
    fail "missing required command: $1${hint:+; ${hint}}"
  fi
}

trim_value() {
  local value="$1"
  value="${value//$'\r'/}"
  value="${value#${value%%[![:space:]]*}}"
  value="${value%${value##*[![:space:]]}}"
  printf '%s' "${value}"
}

load_env_defaults() {
  if [[ -f "${ENV_FILE}" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "${ENV_FILE}"
    set +a
  fi

  REMOTE_ADDRESS="${REMOTE_ADDRESS:-${remoteAddress:-${REMOTE_ADDRESS:-}}}"
  REMOTE_PORT="${REMOTE_PORT:-${remotePort:-${REMOTE_PORT:-}}}"
  REMOTE_USER="${REMOTE_USER:-${remoteUser:-${REMOTE_USER:-}}}"
  REMOTE_PASSWORD="${REMOTE_PASSWORD:-${remotePassword:-${REMOTE_PASSWORD:-}}}"
  REMOTE_DEPLOY_PATH="${REMOTE_DEPLOY_PATH:-${remoteDeployPath:-${REMOTE_DEPLOY_PATH:-}}}"

  REMOTE_ADDRESS="$(trim_value "${REMOTE_ADDRESS}")"
  REMOTE_PORT="$(trim_value "${REMOTE_PORT}")"
  REMOTE_USER="$(trim_value "${REMOTE_USER}")"
  REMOTE_PASSWORD="$(trim_value "${REMOTE_PASSWORD}")"
  REMOTE_DEPLOY_PATH="$(trim_value "${REMOTE_DEPLOY_PATH}")"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      push|start|restart|stop|status)
        [[ -z "${ACTION}" ]] || fail "action already set: ${ACTION}"
        ACTION="$1"
        shift
        ;;
      --remoteAddress)
        [[ $# -ge 2 ]] || fail "--remoteAddress requires a value"
        REMOTE_ADDRESS="$2"
        shift 2
        ;;
      --remotePort)
        [[ $# -ge 2 ]] || fail "--remotePort requires a value"
        REMOTE_PORT="$2"
        shift 2
        ;;
      --remoteUser)
        [[ $# -ge 2 ]] || fail "--remoteUser requires a value"
        REMOTE_USER="$2"
        shift 2
        ;;
      --remotePassword)
        [[ $# -ge 2 ]] || fail "--remotePassword requires a value"
        REMOTE_PASSWORD="$2"
        shift 2
        ;;
      --remoteDeployPath)
        [[ $# -ge 2 ]] || fail "--remoteDeployPath requires a value"
        REMOTE_DEPLOY_PATH="$2"
        shift 2
        ;;
      --includeConfig)
        INCLUDE_CONFIG="true"
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

  [[ -n "${ACTION}" ]] || fail "missing action: push, start, restart, stop, or status"
  if [[ "${INCLUDE_CONFIG}" == "true" && "${ACTION}" != "push" ]]; then
    fail "--includeConfig can only be used with push"
  fi
}

validate_remote_config() {
  [[ -n "${REMOTE_ADDRESS}" ]] || fail "missing remoteAddress, set it in .env or pass --remoteAddress"
  [[ -n "${REMOTE_DEPLOY_PATH}" ]] || fail "missing remoteDeployPath, set it in .env or pass --remoteDeployPath"
  [[ -n "${REMOTE_PORT}" ]] || REMOTE_PORT="22"

  if [[ -n "${REMOTE_USER}" ]]; then
    SSH_TARGET="${REMOTE_USER}@${REMOTE_ADDRESS}"
  else
    SSH_TARGET="${REMOTE_ADDRESS}"
  fi
}

ssh_remote() {
  if [[ -n "${REMOTE_PASSWORD}" ]]; then
    SSHPASS="${REMOTE_PASSWORD}" sshpass -e ssh \
      -p "${REMOTE_PORT}" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      "${SSH_TARGET}" "$@"
  else
    ssh \
      -p "${REMOTE_PORT}" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      "${SSH_TARGET}" "$@"
  fi
}

scp_remote() {
  if [[ -n "${REMOTE_PASSWORD}" ]]; then
    SSHPASS="${REMOTE_PASSWORD}" sshpass -e scp \
      -P "${REMOTE_PORT}" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      "$@"
  else
    scp \
      -P "${REMOTE_PORT}" \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      "$@"
  fi
}

require_remote_tools() {
  require_command ssh "install openssh-client"
  if [[ -n "${REMOTE_PASSWORD}" ]]; then
    require_command sshpass "install sshpass"
  fi

  if [[ "${ACTION}" == "push" ]]; then
    require_command scp "install openssh-client"
  fi
}

collect_local_push_files() {
  [[ -d "${TARGET_DIR}" ]] || fail "target directory not found: ${TARGET_DIR}; run script/build.sh first"

  local files=()
  local item
  shopt -s nullglob
  for item in "${TARGET_DIR}"/*; do
    [[ -e "${item}" ]] || continue
    [[ -f "${item}" ]] || continue
    [[ "${item}" == *.tar.gz ]] && continue
    [[ "${INCLUDE_CONFIG}" != "true" && "$(basename "${item}")" == "config.json" ]] && continue
    files+=("${item}")
  done
  shopt -u nullglob

  [[ ${#files[@]} -gt 0 ]] || fail "no deployable files found in ${TARGET_DIR}; run script/build.sh first"
  LOCAL_PUSH_FILES=("${files[@]}")
}

push_files() {
  collect_local_push_files

  printf '==> Pushing build output to remote host\n'
  ssh_remote "mkdir -p '${REMOTE_DEPLOY_PATH}'"
  scp_remote "${LOCAL_PUSH_FILES[@]}" "${SSH_TARGET}:${REMOTE_DEPLOY_PATH}/"
  printf '==> Push completed\n'
}

run_remote_manage() {
  ssh_remote "bash '${REMOTE_DEPLOY_PATH}/manage.sh' ${ACTION}"
}

main() {
  load_env_defaults
  parse_args "$@"
  validate_remote_config
  require_remote_tools

  case "${ACTION}" in
    push)
      push_files
      ;;
    start|restart|stop|status)
      run_remote_manage
      ;;
  esac
}

main "$@"
