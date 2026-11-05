#!/usr/bin/env bash
set -uo pipefail
phase=${1:?Expected baseline or traced}
case "$phase" in baseline|traced) ;; *) echo "Invalid phase: $phase" >&2; exit 2 ;; esac
out="$RUNNER_TEMP/swift-codeql-diagnostics/$phase"
mkdir -p "$out/stacks"
# Sample resource usage without recording environment variables or full process arguments.
monitor() {
  tick=0
  while :; do
    {
      printf '\n=== UTC %s, elapsed %ss ===\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$tick"
      ps -A -o pid,ppid,pcpu,pmem,rss,etime,comm | sort -k3,3nr | head -35 || true
      vm_stat | head -15 || true
      df -h "$RUNNER_TEMP" | tail -1 || true
      du -sk "$RUNNER_TEMP/codeql_databases/swift" 2>/dev/null || true
    } >> "$out/process-samples.txt" 2>&1
    # Bounded stack samples show where selected build/extractor processes spend time.
    if [ "$phase" = traced ] && (( tick > 0 && tick % 120 == 0 )); then
      ps -A -o pid=,comm= | awk 'tolower($0) ~ /swift-frontend|swift-extractor|codeql|xcodebuild/ && $0 !~ /awk/ {print $1}' | head -3 | while read -r pid; do
        sample "$pid" 2 -file "$out/stacks/${tick}s-${pid}.txt" >/dev/null 2>&1 || true
      done
    fi
    sleep 10
    tick=$((tick + 10))
  done
}
monitor &
monitor_pid=$!
cleanup() { kill "$monitor_pid" 2>/dev/null || true; wait "$monitor_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
printf 'Phase %s started %s\n' "$phase" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" | tee "$out/timing.txt"
start=$(date +%s)
set +e
/usr/bin/time -l xcodebuild build \
  -project 'Codebase - Kartiseret iOS/Kartiseret.xcodeproj' -target Kartiseret \
  -showBuildTimingSummary \
  SYMROOT="$RUNNER_TEMP/$phase-build" OBJROOT="$RUNNER_TEMP/$phase-obj" \
  CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO \
  COMPILATION_CACHE_ENABLE_CACHING=NO SWIFT_ENABLE_COMPILE_CACHE=NO \
  SWIFT_USE_INTEGRATED_DRIVER=NO 2>&1 | tee "$out/xcodebuild.log"
result=${PIPESTATUS[0]}
set -e
printf 'Phase %s ended %s; wall=%ss; exit=%s\n' "$phase" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$(( $(date +%s) - start ))" "$result" | tee -a "$out/timing.txt"
exit "$result"
