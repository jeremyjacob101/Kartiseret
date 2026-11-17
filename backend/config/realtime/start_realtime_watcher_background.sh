#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${PROJECT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
REALTIME_LOG_LEVEL="${REALTIME_LOG_LEVEL:-INFO}"
REALTIME_LOG_DIR="${REALTIME_LOG_DIR:-backend/config/cron/run_realtime_logs}"
REALTIME_GIT_SSH_KEY="${REALTIME_GIT_SSH_KEY:-$HOME/.ssh/id_ed25519_kartiseret}"
RESTART_SLEEP_SECONDS="${RESTART_SLEEP_SECONDS:-5}"
RESTART_MAX_SLEEP_SECONDS="${RESTART_MAX_SLEEP_SECONDS:-60}"
RUN_LOCK_SLEEP_SECONDS="${RUN_LOCK_SLEEP_SECONDS:-600}"
RUN_LOCK_MAX_WAIT_SECONDS="${RUN_LOCK_MAX_WAIT_SECONDS:-10800}"
PIPELINE_TERMINATION_GRACE_SECONDS="${PIPELINE_TERMINATION_GRACE_SECONDS:-}"
TARGET="${KARTISERET_TARGET:-production}"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

if [[ "${1:-}" == "--target" ]]; then
  if (( $# < 2 )); then
    echo "--target requires development or production" >&2
    exit 2
  fi
  TARGET="$2"
  shift 2
fi
if [[ "$TARGET" != "development" && "$TARGET" != "production" ]]; then
  echo "KARTISERET_TARGET must be development or production" >&2
  exit 2
fi

cd "$PROJECT"

dotenv_value() {
  if [[ ! -f "$PROJECT/.env" ]]; then return 0; fi
  awk -v key="$1" '
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      sub(/^export[[:space:]]+/, "", line)
      separator = index(line, "=")
      if (separator == 0) next
      name = substr(line, 1, separator - 1)
      gsub(/[[:space:]]/, "", name)
      if (name == key) value = substr(line, separator + 1)
    }
    END {
      sub(/^[[:space:]]*/, "", value)
      sub(/[[:space:]]*$/, "", value)
      first = substr(value, 1, 1)
      last = substr(value, length(value), 1)
      if ((first == "\"" || first == "\047") && last == first) {
        value = substr(value, 2, length(value) - 2)
      } else {
        sub(/[[:space:]]+#.*/, "", value)
      }
      print value
    }
  ' "$PROJECT/.env"
}

if [[ -z "$PIPELINE_TERMINATION_GRACE_SECONDS" ]]; then
  PIPELINE_TERMINATION_GRACE_SECONDS="$(dotenv_value PIPELINE_TERMINATION_GRACE_SECONDS)"
fi
PIPELINE_TERMINATION_GRACE_SECONDS="${PIPELINE_TERMINATION_GRACE_SECONDS:-20}"

export PROJECT
export PYTHONPATH="$PROJECT"
export PYTHONUNBUFFERED=1
export REALTIME_GIT_SSH_KEY
export REALTIME_LOG_LEVEL
export RUN_LOCK_MAX_WAIT_SECONDS
export RUN_LOCK_SLEEP_SECONDS
export PIPELINE_TERMINATION_GRACE_SECONDS
export KARTISERET_TARGET="$TARGET"

LOG_FILE="$PROJECT/$REALTIME_LOG_DIR/realtime_watcher.log"
PID_FILE="$PROJECT/$REALTIME_LOG_DIR/realtime_watcher.pid"

resolve_uv() {
  if [[ -n "${KARTISERET_PYTHON:-}" ]]; then
    echo "KARTISERET_PYTHON is retired; set KARTISERET_UV to the uv executable instead." >&2
    return 2
  fi
  if [[ -n "${KARTISERET_UV:-}" ]]; then
    UV="$KARTISERET_UV"
    if [[ "$UV" != */* ]]; then UV="$(command -v "$UV" 2>/dev/null || true)"; fi
  else
    UV="$(command -v uv 2>/dev/null || true)"
    if [[ -z "$UV" && -x "$HOME/.local/bin/uv" ]]; then UV="$HOME/.local/bin/uv"; fi
  fi
  if [[ -z "$UV" || ! -x "$UV" ]]; then
    echo "uv is required. Install the pinned uv version from the project README or set KARTISERET_UV." >&2
    return 127
  fi
  export UV
}

check_runtime() {
  resolve_uv
  "$UV" sync --locked
  PYTHON="$("$UV" run --locked --no-sync python -c 'import sys; print(sys.executable)')"
  export PYTHON
  "$UV" run --locked --no-sync -m backend.config.realtime.launch_realtime_watcher --target "$TARGET" --validate-only
  "$UV" run --locked --no-sync "$SCRIPT_DIR/check_realtime_runtime.py"
}

status_watcher() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(<"$PID_FILE")"

    if [[ "$pid" == <-> ]] && kill -0 "$pid" 2>/dev/null; then
      ps -p "$pid" -o pid,ppid,stat,lstart,etime,command
      return
    fi

    echo "No realtime watcher process running for stale PID $pid"
    return
  fi

  echo "No realtime watcher process recorded as running"
}

stop_watcher() {
  launchctl remove com.kartiseret.realtime-watcher 2>/dev/null || true

  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(<"$PID_FILE")"

    if [[ "$pid" == <-> ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true

      local shutdown_wait=$((PIPELINE_TERMINATION_GRACE_SECONDS + 6))
      local i
      for ((i = 1; i <= shutdown_wait; i++)); do
        if ! kill -0 "$pid" 2>/dev/null; then
          break
        fi
        sleep 1
      done

      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
      fi
    fi

    rm -f "$PID_FILE"
  fi

  pkill -TERM -f "start_realtime_watcher_background.sh --foreground" 2>/dev/null || true
  pkill -TERM -f "backend.config.realtime.realtime_watcher" 2>/dev/null || true
  pkill -TERM -f "realtime_watcher.py" 2>/dev/null || true

  sleep 2

  pkill -KILL -f "start_realtime_watcher_background.sh --foreground" 2>/dev/null || true
  pkill -KILL -f "backend.config.realtime.realtime_watcher" 2>/dev/null || true
  pkill -KILL -f "realtime_watcher.py" 2>/dev/null || true
}

run_supervisor() {
  local restart_delay="$RESTART_SLEEP_SECONDS"
  local child_pid=""
  local stop_requested="false"

  on_stop_signal() {
    stop_requested="true"
    echo "Stop signal received. Exiting realtime watcher supervisor."
    if [[ -n "$child_pid" ]]; then
      kill "$child_pid" 2>/dev/null || true
    fi
  }

  trap on_stop_signal INT TERM

  echo "Starting realtime watcher supervisor from $PROJECT"
  echo "uv: $UV"
  echo "Restart delay: ${RESTART_SLEEP_SECONDS}s (max ${RESTART_MAX_SLEEP_SECONDS}s)"

  while true; do
    if [[ "$stop_requested" == "true" ]]; then
      break
    fi

    local start_ts
    start_ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
    echo "[$start_ts] Launching realtime watcher process..."

    "$UV" run --locked -m backend.config.realtime.launch_realtime_watcher --target "$TARGET" --exec &
    child_pid="$!"

    set +e
    wait "$child_pid"
    local exit_code="$?"
    set -e
    child_pid=""

    local end_ts
    end_ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
    echo "[$end_ts] Watcher exited with code $exit_code"

    if [[ "$stop_requested" == "true" ]]; then
      break
    fi

    echo "Restarting in ${restart_delay}s..."
    sleep "$restart_delay"

    restart_delay=$((restart_delay * 2))
    if (( restart_delay > RESTART_MAX_SLEEP_SECONDS )); then
      restart_delay="$RESTART_MAX_SLEEP_SECONDS"
    fi
  done

  echo "Realtime watcher supervisor stopped."
}

start_background() {
  resolve_uv

  mkdir -p "$(dirname "$LOG_FILE")"

  echo "Before restart:"
  status_watcher

  stop_watcher
  check_runtime

  echo "Logging to: $LOG_FILE"
  nohup "$SCRIPT_DIR/start_realtime_watcher_background.sh" --foreground >> "$LOG_FILE" 2>&1 < /dev/null &
  local watcher_pid="$!"
  echo "$watcher_pid" > "$PID_FILE"
  disown "$watcher_pid" 2>/dev/null || true

  sleep 3

  echo "After restart:"
  status_watcher
}

show_usage() {
  cat <<'USAGE'
Usage:
  ./backend/config/realtime/start_realtime_watcher_background.sh [--target development|production]
  ./backend/config/realtime/start_realtime_watcher_background.sh --status
  ./backend/config/realtime/start_realtime_watcher_background.sh --stop
  ./backend/config/realtime/start_realtime_watcher_background.sh --foreground
USAGE
}

case "${1:-start}" in
  start|restart|--start|--restart)
    start_background
    ;;
  status|--status)
    status_watcher
    ;;
  stop|--stop)
    stop_watcher
    status_watcher
    ;;
  foreground|--foreground)
    check_runtime
    run_supervisor
    ;;
  help|-h|--help)
    show_usage
    ;;
  *)
    show_usage
    exit 2
    ;;
esac
