#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
UV="${KARTISERET_UV:-$(command -v uv)}"
cd "$PROJECT_ROOT"

run_once() {
  "$UV" run --locked --no-sync python -m backend.config.cdn_cache_warmer --once
}

# Cron starts one batch per minute. Schedule from the start of the batch
# so a slow request does not move the later slots. Python guards overlap.
(sleep 20; run_once) &
second_pid=$!
(sleep 40; run_once) &
third_pid=$!
status=0
run_once || status=1
wait "$second_pid" || status=1
wait "$third_pid" || status=1
exit "$status"
