#!/usr/bin/env zsh
set -euo pipefail

PROJECT="${PROJECT:-/Users/jeremyjacob/Documents/Coding Projects/Kartiseret/NewScraping-August2025}"
SUPABASE_URL="${SUPABASE_URL:-https://gsdrcyrduxbrxgsvhxvr.supabase.co}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
REALTIME_LOG_LEVEL="${REALTIME_LOG_LEVEL:-INFO}"
RUN_LOCK_SLEEP_SECONDS="${RUN_LOCK_SLEEP_SECONDS:-600}"
RUN_LOCK_MAX_WAIT_SECONDS="${RUN_LOCK_MAX_WAIT_SECONDS:-10800}"
REALTIME_GIT_SSH_KEY="${REALTIME_GIT_SSH_KEY:-$HOME/.ssh/id_ed25519_kartiseret}"
REALTIME_LOG_DIR="${REALTIME_LOG_DIR:-backend/config/cron/run_realtime_logs}"

if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "Missing SUPABASE_SERVICE_ROLE_KEY. Export it first."
  exit 1
fi

cd "$PROJECT"

mkdir -p "$REALTIME_LOG_DIR"
LOG_FILE="$REALTIME_LOG_DIR/realtime_watcher.log"

launchctl remove com.kartiseret.realtime-watcher 2>/dev/null || true

for i in 1 2 3; do
  pkill -9 -f "$PROJECT/backend/config/cron/run_realtime_watcher.sh" 2>/dev/null || true
  pkill -9 -f "$PROJECT/backend/config/realtime/realtime_watcher.py" 2>/dev/null || true
  pkill -9 -f "run_realtime_watcher.sh" 2>/dev/null || true
  pkill -9 -f "backend.config.realtime.realtime_watcher" 2>/dev/null || true
  sleep 1
done

echo "Before restart:"
pgrep -af "run_realtime_watcher|realtime_watcher|backend.config.realtime" || echo "No watcher processes running"
echo "Logging to: $LOG_FILE"

nohup zsh -lc "
cd \"$PROJECT\"
source .venv/bin/activate
export SUPABASE_URL=\"$SUPABASE_URL\"
export SUPABASE_SERVICE_ROLE_KEY=\"$SUPABASE_SERVICE_ROLE_KEY\"
export REALTIME_LOG_LEVEL=\"$REALTIME_LOG_LEVEL\"
export RUN_LOCK_SLEEP_SECONDS=\"$RUN_LOCK_SLEEP_SECONDS\"
export RUN_LOCK_MAX_WAIT_SECONDS=\"$RUN_LOCK_MAX_WAIT_SECONDS\"
export PYTHONPATH=\"\$PWD\"
export PYTHON=\"\$PWD/.venv/bin/python3\"
export REALTIME_GIT_SSH_KEY=\"$REALTIME_GIT_SSH_KEY\"
exec ./backend/config/cron/run_realtime_watcher.sh
" >> \"$LOG_FILE\" 2>&1 < /dev/null &!

sleep 3
echo "After restart:"
pgrep -af "run_realtime_watcher|realtime_watcher|backend.config.realtime" || echo "Watcher did not start"
echo "Shell jobs:"
jobs -l
