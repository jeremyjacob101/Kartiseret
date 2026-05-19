#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/backend/config/cron/run_realtime_logs"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PYTHONPATH="$PROJECT_ROOT"

if [[ -x "$PROJECT_ROOT/.venv/bin/python" ]]; then
  PYTHON="$PROJECT_ROOT/.venv/bin/python"
else
  PYTHON="python3"
fi

mkdir -p "$LOG_DIR"
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="$LOG_DIR/realtime_watcher_${TIMESTAMP}.log"
RESTART_SLEEP_SECONDS="${RESTART_SLEEP_SECONDS:-5}"
RESTART_MAX_SLEEP_SECONDS="${RESTART_MAX_SLEEP_SECONDS:-60}"
restart_delay="$RESTART_SLEEP_SECONDS"
stop_requested="false"

cd "$PROJECT_ROOT"

on_stop_signal() {
  stop_requested="true"
  echo "Stop signal received. Exiting watcher supervisor loop." | tee -a "$LOG_FILE"
}

trap on_stop_signal INT TERM

echo "Starting realtime watcher supervisor from $PROJECT_ROOT"
echo "Logs: $LOG_FILE"
echo "Restart delay: ${RESTART_SLEEP_SECONDS}s (max ${RESTART_MAX_SLEEP_SECONDS}s)"

while true; do
  if [[ "$stop_requested" == "true" ]]; then
    break
  fi

  start_ts=$(date '+%Y-%m-%dT%H:%M:%S%z')
  echo "[$start_ts] Launching realtime watcher process..." | tee -a "$LOG_FILE"

  set +e
  "$PYTHON" -u -m backend.config.realtime.realtime_watcher 2>&1 | tee -a "$LOG_FILE"
  exit_code=${PIPESTATUS[0]}
  set -e

  end_ts=$(date '+%Y-%m-%dT%H:%M:%S%z')
  echo "[$end_ts] Watcher exited with code $exit_code" | tee -a "$LOG_FILE"

  if [[ "$stop_requested" == "true" ]]; then
    break
  fi

  echo "Restarting in ${restart_delay}s..." | tee -a "$LOG_FILE"
  sleep "$restart_delay"

  # Exponential backoff up to max when process exits repeatedly.
  restart_delay=$((restart_delay * 2))
  if (( restart_delay > RESTART_MAX_SLEEP_SECONDS )); then
    restart_delay="$RESTART_MAX_SLEEP_SECONDS"
  fi
done

echo "Watcher supervisor stopped." | tee -a "$LOG_FILE"
