#!/bin/bash
set -euo pipefail

export JJ_INTEL_MAC_WEEKLY_RUN="true"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export GIT_SSH_COMMAND="ssh -i /Users/jeremyjacob/.ssh/id_ed25519_kartiseret -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
PYTHON="${KARTISERET_PYTHON:-$PROJECT_ROOT/.venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  BASE_PYTHON="$(command -v python3)"
  "$BASE_PYTHON" -m venv "$PROJECT_ROOT/.venv"
  PYTHON="$PROJECT_ROOT/.venv/bin/python"
fi

TARGET="${KARTISERET_TARGET:-production}"
ARGS=("$@")
for ((i = 0; i < ${#ARGS[@]}; i++)); do
  if [[ "${ARGS[$i]}" == "--target" ]] && (( i + 1 < ${#ARGS[@]} )); then
    TARGET="${ARGS[$((i + 1))]}"
  fi
done
export KARTISERET_TARGET="$TARGET"

RECOVERY_ROOT="${KARTISERET_RECOVERY_ROOT:-$HOME/Library/Application Support/Kartiseret/run-recovery}"
LOG_DIR="$RECOVERY_ROOT/cron"
mkdir -p "$LOG_DIR"
chmod 700 "$RECOVERY_ROOT" "$LOG_DIR" 2>/dev/null || true

TIMESTAMP=$(date '+%Y-%m-%d_%H-%M-%S')
LOG_FILE="$LOG_DIR/cron_weekly_${TIMESTAMP}.log"
RUN_ID_FILE="$LOG_DIR/run_weekly_${TIMESTAMP}.run-id"
export KARTISERET_RECOVERY_ROOT="$RECOVERY_ROOT"
export KARTISER_RUN_ID_FILE="$RUN_ID_FILE"

cd "$PROJECT_ROOT"

sync_phase() {
  echo "==== cron run start: $(date '+%Y-%m-%dT%H:%M:%S%z') ===="
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Refusing code sync because tracked local changes are present."
    return 1
  fi
  git fetch origin main
  git checkout main
  git pull --ff-only origin main
}

sync_phase 2>&1 | tee "$LOG_FILE"

set +e
"$PYTHON" -u -m backend.config.runner "${ARGS[@]}" 2>&1 | tee -a "$LOG_FILE"
RUN_STATUSES=("${PIPESTATUS[@]}")
set -e
RUN_STATUS=${RUN_STATUSES[0]}
LOG_STATUS=${RUN_STATUSES[1]}

echo "==== cron run end: $(date '+%Y-%m-%dT%H:%M:%S%z') (runner exit $RUN_STATUS, tee exit $LOG_STATUS) ====" | tee -a "$LOG_FILE" || true

UPLOAD_STATUS=0
if [[ -s "$RUN_ID_FILE" ]]; then
  UPLOAD_ARGS=(--target "$TARGET" --run-id-file "$RUN_ID_FILE" --path "$LOG_FILE")
  if (( LOG_STATUS != 0 )); then
    UPLOAD_ARGS+=(--mark-failed)
  fi
  set +e
  "$PYTHON" -m backend.config.upload_cron_log "${UPLOAD_ARGS[@]}"
  UPLOAD_STATUS=$?
  set -e
else
  echo "No run ID was allocated; cron transcript retained at $LOG_FILE." >&2
  UPLOAD_STATUS=1
fi

if (( UPLOAD_STATUS != 0 )); then
  exit 1
fi
if (( LOG_STATUS != 0 )); then
  exit "$LOG_STATUS"
fi
exit "$RUN_STATUS"
