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
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

cd "$PROJECT"

if [[ -n "${PYTHON:-}" ]]; then
  PYTHON_BIN="$PYTHON"
elif [[ -x "$PROJECT/.venv/bin/python" ]]; then
  PYTHON_BIN="$PROJECT/.venv/bin/python"
elif [[ -x "$PROJECT/.venv/bin/python3" ]]; then
  PYTHON_BIN="$PROJECT/.venv/bin/python3"
else
  PYTHON_BIN="python3"
fi

dotenv_value() {
  "$PYTHON_BIN" "$SCRIPT_DIR/dotenv_value.py" "$1" "$PROJECT/.env"
}

if [[ -z "$SUPABASE_URL" ]]; then
  SUPABASE_URL="$(dotenv_value SUPABASE_URL)"
fi

if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  SUPABASE_SERVICE_ROLE_KEY="$(dotenv_value SUPABASE_SERVICE_ROLE_KEY)"
fi

SUPABASE_URL="${SUPABASE_URL:-https://gsdrcyrduxbrxgsvhxvr.supabase.co}"

if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "Missing SUPABASE_SERVICE_ROLE_KEY. Export it first or add it to $PROJECT/.env."
  exit 1
fi

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PROJECT
export PYTHON="$PYTHON_BIN"
export PYTHONPATH="$PROJECT"
export REALTIME_GIT_SSH_KEY
export REALTIME_LOG_LEVEL
export RUN_LOCK_MAX_WAIT_SECONDS
export RUN_LOCK_SLEEP_SECONDS
export SUPABASE_SERVICE_ROLE_KEY
export SUPABASE_URL

LOG_FILE="$PROJECT/$REALTIME_LOG_DIR/realtime_watcher.log"
PID_FILE="$PROJECT/$REALTIME_LOG_DIR/realtime_watcher.pid"

check_runtime() {
  "$PYTHON" "$SCRIPT_DIR/check_realtime_runtime.py"
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

      for _ in 1 2 3 4 5; do
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
  echo "Python: $PYTHON"
  echo "Restart delay: ${RESTART_SLEEP_SECONDS}s (max ${RESTART_MAX_SLEEP_SECONDS}s)"

  while true; do
    if [[ "$stop_requested" == "true" ]]; then
      break
    fi

    local start_ts
    start_ts="$(date '+%Y-%m-%dT%H:%M:%S%z')"
    echo "[$start_ts] Launching realtime watcher process..."

    "$PYTHON" -u -m backend.config.realtime.realtime_watcher &
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
  check_runtime

  mkdir -p "$(dirname "$LOG_FILE")"

  echo "Before restart:"
  status_watcher

  stop_watcher

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
  ./backend/config/realtime/start_realtime_watcher_background.sh
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
