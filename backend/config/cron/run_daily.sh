#!/bin/bash
set -euo pipefail

export JJ_INTEL_MAC_DAILY_RUN="true"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export GIT_SSH_COMMAND="ssh -i /Users/jeremyjacob/.ssh/id_ed25519_kartiseret -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

PROJECT_ROOT="/Users/jeremyjacob/Documents/Coding Projects/Kartiseret/NewScraping-August2025"
PYTHON="$PROJECT_ROOT/.venv/bin/python"
ARTIFACT_DIR="$PROJECT_ROOT/backend/utils/log/logger_artifacts"
LOG_DIR="$PROJECT_ROOT/backend/config/cron/run_daily_logs"

cd "$PROJECT_ROOT"

TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="$LOG_DIR/cron_daily_${TIMESTAMP}.log"
mkdir -p "$LOG_DIR"

# --------------------
# Phase 1: run everything and write output to the log (and terminal)
# --------------------
sync_phase() {
  echo "==== cron run start: $(date '+%Y-%m-%dT%H:%M:%S%z') ===="

  # Sync code (robust even if main was force-pushed)
  git fetch origin main
  git checkout main
  git reset --hard origin/main
  git clean -fd -e backend/config/cron/
}

# Keep code-sync failures fatal; never run or publish against an unsynced checkout.
sync_phase 2>&1 | tee "$LOG_FILE"

# Only the runner may fail without skipping artifact publication. Capture both
# pipeline statuses immediately, before another command overwrites PIPESTATUS.
set +e
"$PYTHON" -u -m backend.config.runner "$@" 2>&1 | tee -a "$LOG_FILE"
RUN_STATUSES=("${PIPESTATUS[@]}")
set -e
RUN_STATUS=${RUN_STATUSES[0]}
LOG_STATUS=${RUN_STATUSES[1]}
if (( LOG_STATUS != 0 )); then
  echo "Failed to write cron log (tee exit $LOG_STATUS)." >&2
  exit "$LOG_STATUS"
fi

echo "==== cron run end: $(date '+%Y-%m-%dT%H:%M:%S%z') (runner exit $RUN_STATUS) ====" | tee -a "$LOG_FILE"

# --------------------
# Phase 2: git add/commit/rebase/push (NO tee running now)
# --------------------

# Stage artifacts and the log
if [[ -d "$ARTIFACT_DIR" ]]; then
  git add "$ARTIFACT_DIR"
fi
git add "$LOG_FILE"

# If nothing staged, we're done
if git diff --cached --quiet; then
  exit "$RUN_STATUS"
fi

git commit -m "[D-RUN] daily artifacts and log (runner exit $RUN_STATUS) $(date +%Y-%m-%d_%H-%M-%S)"

# Update again in case main moved while the job ran, then push
git fetch origin main
git rebase origin/main
git push origin main

# Preserve the runner outcome after its artifacts and completed log are pushed.
exit "$RUN_STATUS"
