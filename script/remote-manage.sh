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
REMOTE_FRONTEND_DEPLOY_PATH=""
SSH_TARGET=""
INCLUDE_CONFIG="false"
PUSH_MODE="bundled"

usage() {
  cat <<'EOF'
Usage: ./script/remote-manage.sh <push|start|restart|stop|status> [options]

Options:
  --remoteAddress <value>
  --remotePort <value>
  --remoteUser <value>
  --remotePassword <value>
  --remoteDeployPath <value>
  --remoteFrontendDeployPath <value>  Override the frontend directory
  --mode <bundled|separate|backend|frontend>
  --includeConfig        Include backend config.json when pushing
  -h, --help

Examples:
  ./script/remote-manage.sh push
  ./script/remote-manage.sh push --mode separate
  ./script/remote-manage.sh push --mode backend
  ./script/remote-manage.sh push --mode frontend
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

parent_path() {
  local path="${1%/}"
  local parent
  [[ -n "${path}" ]] || path="/"

  if [[ "${path}" == */* ]]; then
    parent="${path%/*}"
    [[ -n "${parent}" ]] || parent="/"
  else
    parent="."
  fi
  printf '%s' "${parent}"
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
  REMOTE_FRONTEND_DEPLOY_PATH="${REMOTE_FRONTEND_DEPLOY_PATH:-${remoteFrontendDeployPath:-${REMOTE_FRONTEND_DEPLOY_PATH:-}}}"

  REMOTE_ADDRESS="$(trim_value "${REMOTE_ADDRESS}")"
  REMOTE_PORT="$(trim_value "${REMOTE_PORT}")"
  REMOTE_USER="$(trim_value "${REMOTE_USER}")"
  REMOTE_PASSWORD="$(trim_value "${REMOTE_PASSWORD}")"
  REMOTE_DEPLOY_PATH="$(trim_value "${REMOTE_DEPLOY_PATH}")"
  REMOTE_FRONTEND_DEPLOY_PATH="$(trim_value "${REMOTE_FRONTEND_DEPLOY_PATH}")"
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
      --remoteFrontendDeployPath)
        [[ $# -ge 2 ]] || fail "--remoteFrontendDeployPath requires a value"
        REMOTE_FRONTEND_DEPLOY_PATH="$2"
        shift 2
        ;;
      --mode)
        [[ $# -ge 2 ]] || fail "--mode requires a value"
        PUSH_MODE="$2"
        shift 2
        ;;
      --mode=*)
        PUSH_MODE="${1#*=}"
        shift
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
  if [[ "${ACTION}" != "push" && "${PUSH_MODE}" != "bundled" ]]; then
    fail "--mode can only be used with push"
  fi

  case "${PUSH_MODE}" in
    bundled|separate|backend|frontend)
      ;;
    *)
      fail "unsupported push mode: ${PUSH_MODE}; expected bundled, separate, backend, or frontend"
      ;;
  esac
}

validate_remote_config() {
  [[ -n "${REMOTE_ADDRESS}" ]] || fail "missing remoteAddress, set it in .env or pass --remoteAddress"
  [[ -n "${REMOTE_PORT}" ]] || REMOTE_PORT="22"

  if [[ "${ACTION}" != "push" || "${PUSH_MODE}" == "bundled" || "${PUSH_MODE}" == "backend" || "${PUSH_MODE}" == "separate" ]]; then
    [[ -n "${REMOTE_DEPLOY_PATH}" ]] || fail "missing remoteDeployPath, set it in .env or pass --remoteDeployPath"
  fi
  if [[ "${ACTION}" == "push" && ( "${PUSH_MODE}" == "frontend" || "${PUSH_MODE}" == "separate" ) ]]; then
    if [[ -z "${REMOTE_FRONTEND_DEPLOY_PATH}" ]]; then
      [[ -n "${REMOTE_DEPLOY_PATH}" ]] || fail "missing remoteDeployPath; it is required to derive the default frontend path"
      if [[ "${REMOTE_DEPLOY_PATH}" == "/" ]]; then
        REMOTE_FRONTEND_DEPLOY_PATH="/frontend"
      else
        REMOTE_FRONTEND_DEPLOY_PATH="${REMOTE_DEPLOY_PATH%/}/frontend"
      fi
    fi
    REMOTE_FRONTEND_DEPLOY_PATH="${REMOTE_FRONTEND_DEPLOY_PATH%/}"
    [[ -n "${REMOTE_FRONTEND_DEPLOY_PATH}" && "${REMOTE_FRONTEND_DEPLOY_PATH}" != "/" ]] \
      || fail "remoteFrontendDeployPath must not be the filesystem root"
  fi

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

collect_local_push_items() {
  local source_dir="$1"
  local layout="$2"

  [[ -d "${source_dir}" ]] || fail "build output directory not found: ${source_dir}; run script/build.sh with the matching mode first"

  local items=()
  local item
  shopt -s nullglob dotglob
  for item in "${source_dir}"/*; do
    [[ -e "${item}" ]] || continue
    [[ "${layout}" != "bundled" || -f "${item}" ]] || continue
    [[ "${item}" == *.tar.gz ]] && continue
    [[ "${INCLUDE_CONFIG}" != "true" && "$(basename "${item}")" == "config.json" ]] && continue
    items+=("${item}")
  done
  shopt -u nullglob dotglob

  [[ ${#items[@]} -gt 0 ]] || fail "no deployable files found in ${source_dir}; run script/build.sh with the matching mode first"
  LOCAL_PUSH_ITEMS=("${items[@]}")
}

push_directory() {
  local source_dir="$1"
  local remote_dir="$2"
  local layout="$3"
  local label="$4"

  collect_local_push_items "${source_dir}" "${layout}"

  printf '==> Pushing %s output to remote host\n' "${label}"
  ssh_remote "mkdir -p '${remote_dir}'"
  scp_remote -r "${LOCAL_PUSH_ITEMS[@]}" "${SSH_TARGET}:${remote_dir}/"
  printf '==> %s push completed\n' "${label}"
}

push_frontend_archive() {
  local archive_file="${TARGET_DIR}/GTools-frontend.tar.gz"
  local remote_archive="${REMOTE_FRONTEND_DEPLOY_PATH}.tar.gz"
  local remote_temp_dir="${REMOTE_FRONTEND_DEPLOY_PATH}.new"
  local remote_parent
  remote_parent="$(parent_path "${REMOTE_FRONTEND_DEPLOY_PATH}")"

  [[ -f "${archive_file}" ]] || fail "frontend archive not found: ${archive_file}; run script/build.sh buildFrontend or use --mode separate"

  printf '==> Uploading frontend archive to remote host\n'
  ssh_remote "mkdir -p '${remote_parent}'"
  scp_remote "${archive_file}" "${SSH_TARGET}:${remote_archive}"
  ssh_remote "rm -rf '${remote_temp_dir}' && mkdir -p '${remote_temp_dir}' && tar -xzf '${remote_archive}' -C '${remote_temp_dir}' && rm -rf '${REMOTE_FRONTEND_DEPLOY_PATH}' && mv '${remote_temp_dir}' '${REMOTE_FRONTEND_DEPLOY_PATH}' && rm -f '${remote_archive}'"
  printf '==> Frontend archive extracted to %s\n' "${REMOTE_FRONTEND_DEPLOY_PATH}"
}

push_files() {
  case "${PUSH_MODE}" in
    bundled)
      push_directory "${TARGET_DIR}" "${REMOTE_DEPLOY_PATH}" "bundled" "bundled"
      ;;
    backend)
      push_directory "${TARGET_DIR}/backend" "${REMOTE_DEPLOY_PATH}" "separate" "backend"
      ;;
    frontend)
      push_frontend_archive
      ;;
    separate)
      push_directory "${TARGET_DIR}/backend" "${REMOTE_DEPLOY_PATH}" "separate" "backend"
      push_frontend_archive
      ;;
  esac
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
