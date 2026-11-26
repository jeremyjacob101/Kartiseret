#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LABEL="com.kartiseret.cdn-cache-warmer"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Kartiseret"
UV="${KARTISERET_UV:-$(command -v uv 2>/dev/null || true)}"

if [[ -z "$UV" && -x "$HOME/.local/bin/uv" ]]; then
  UV="$HOME/.local/bin/uv"
fi
if [[ -z "$UV" && -x "/opt/homebrew/bin/uv" ]]; then
  UV="/opt/homebrew/bin/uv"
fi

if [[ -z "$UV" || ! -x "$UV" ]]; then
  echo "uv is required. Install the pinned uv version or set KARTISERET_UV." >&2
  exit 127
fi

launchd_domain="gui/$(id -u)"

install_warmer() {
  cd "$PROJECT_ROOT"
  "$UV" sync --locked
  "$UV" run --locked --no-sync python -m backend.config.cdn_cache_warmer --check-config
  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
  python3 - "$PLIST" "$PROJECT_ROOT" "$SCRIPT_DIR/cdn_cache_warmer.sh" "$UV" "$LOG_DIR/cdn-cache-warmer.log" "$LABEL" <<'PY'
import plistlib
import sys
from pathlib import Path

plist_path, project_root, script_path, uv_path, log_path, label = sys.argv[1:]
contents = {
    "Label": label,
    "ProgramArguments": [script_path, "--foreground"],
    "WorkingDirectory": project_root,
    "EnvironmentVariables": {
        "KARTISERET_UV": uv_path,
        "PROJECT_ROOT": project_root,
    },
    "RunAtLoad": True,
    "KeepAlive": True,
    "ProcessType": "Background",
    "ThrottleInterval": 20,
    "StandardOutPath": log_path,
    "StandardErrorPath": log_path,
}
Path(plist_path).write_bytes(plistlib.dumps(contents, fmt=plistlib.FMT_XML))
PY
  chmod 600 "$PLIST"
  launchctl bootout "$launchd_domain/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "$launchd_domain" "$PLIST"
  launchctl enable "$launchd_domain/$LABEL"
  launchctl kickstart -k "$launchd_domain/$LABEL"
  echo "Installed and started $LABEL"
  echo "Logs: $LOG_DIR/cdn-cache-warmer.log"
}

case "${1:-}" in
  install)
    install_warmer
    ;;
  foreground)
    cd "$PROJECT_ROOT"
    export PYTHONPATH="$PROJECT_ROOT${PYTHONPATH:+:$PYTHONPATH}"
    exec "$UV" run --locked --no-sync python -m backend.config.cdn_cache_warmer
    ;;
  start)
    launchctl bootstrap "$launchd_domain" "$PLIST" >/dev/null 2>&1 || true
    launchctl enable "$launchd_domain/$LABEL"
    launchctl kickstart -k "$launchd_domain/$LABEL"
    ;;
  stop)
    launchctl bootout "$launchd_domain/$LABEL" >/dev/null 2>&1 || true
    ;;
  status)
    launchctl print "$launchd_domain/$LABEL"
    ;;
  uninstall)
    launchctl bootout "$launchd_domain/$LABEL" >/dev/null 2>&1 || true
    launchctl disable "$launchd_domain/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    echo "Removed $LABEL. Warmer logs and saved revision state were retained."
    ;;
  *)
    cat <<'USAGE'
Usage:
  ./backend/config/cdn_cache_warmer.sh install
  ./backend/config/cdn_cache_warmer.sh start
  ./backend/config/cdn_cache_warmer.sh stop
  ./backend/config/cdn_cache_warmer.sh status
  ./backend/config/cdn_cache_warmer.sh uninstall
  ./backend/config/cdn_cache_warmer.sh foreground
USAGE
    exit 2
    ;;
esac
