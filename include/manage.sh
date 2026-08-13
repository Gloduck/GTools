#!/usr/bin/env bash

set -euo pipefail

APP_NAME="GTools"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}"
START_WAIT_SECONDS=10
STOP_WAIT_SECONDS=10

ACTION=""

usage() {
  cat <<'EOF'
Usage: ./manage.sh <start|stop|restart|status>

Examples:
  ./manage.sh start
  ./manage.sh stop
  ./manage.sh restart
  ./manage.sh status
EOF
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

parse_args() {
  [[ $# -eq 1 ]] || fail "expected one action: start, stop, restart, or status"

  case "$1" in
    start|stop|restart|status)
      ACTION="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unsupported action: $1"
      ;;
  esac
}

collect_pids() {
  local pids=()

  while read -r pid args; do
    [[ -n "${pid}" ]] || continue
    case "${args}" in
      *"${APP_DIR}/${APP_NAME}"*|*"-jar ${APP_DIR}/${APP_NAME}.jar"*)
        pids+=("${pid}")
        ;;
    esac
  done < <(ps -eo pid=,args=)

  printf '%s\n' "${pids[@]:-}"
}

is_running() {
  local pids
  pids="$(collect_pids)"
  [[ -n "${pids//$'\n'/}" ]]
}

status_app() {
  mapfile -t pids < <(collect_pids)

  if [[ ${#pids[@]} -eq 0 || -z "${pids[0]}" ]]; then
    printf 'Service is not running\n'
    return
  fi

  printf 'Service is running, pid=%s\n' "$(IFS=,; printf '%s' "${pids[*]}")"
}

run_detached() {
  (
    cd "${APP_DIR}"
    if command -v setsid >/dev/null 2>&1; then
      setsid "$@" > /dev/null 2>&1 < /dev/null &
    else
      nohup "$@" > /dev/null 2>&1 < /dev/null &
    fi
  )
}

start_app() {
  if is_running; then
    status_app
    return
  fi

  mkdir -p "${APP_DIR}/logs"

  if [[ -x "${APP_DIR}/${APP_NAME}" ]]; then
    run_detached "${APP_DIR}/${APP_NAME}"
  elif [[ -f "${APP_DIR}/${APP_NAME}.jar" ]]; then
    local -a java_opts=()
    if [[ -n "${JAVA_OPTS:-}" ]]; then
      # shellcheck disable=SC2206
      java_opts=(${JAVA_OPTS})
    fi
    run_detached java "${java_opts[@]}" -jar "${APP_DIR}/${APP_NAME}.jar"
  else
    fail "no deployable artifact found in ${APP_DIR}"
  fi

  for _ in $(seq 1 "${START_WAIT_SECONDS}"); do
    if is_running; then
      printf 'Service started\n'
      return
    fi
    sleep 1
  done

  fail "service failed to start"
}

stop_app() {
  mapfile -t pids < <(collect_pids)

  if [[ ${#pids[@]} -eq 0 || -z "${pids[0]}" ]]; then
    printf 'Service is not running\n'
    return
  fi

  kill "${pids[@]}" || true

  for _ in $(seq 1 "${STOP_WAIT_SECONDS}"); do
    if ! is_running; then
      printf 'Service stopped\n'
      return
    fi
    sleep 1
  done

  mapfile -t pids < <(collect_pids)
  if [[ ${#pids[@]} -gt 0 && -n "${pids[0]}" ]]; then
    kill -9 "${pids[@]}" || true
  fi
  printf 'Service force stopped\n'
}

restart_app() {
  stop_app
  start_app
}

main() {
  parse_args "$@"

  case "${ACTION}" in
    start)
      start_app
      ;;
    stop)
      stop_app
      ;;
    restart)
      restart_app
      ;;
    status)
      status_app
      ;;
  esac
}

main "$@"
