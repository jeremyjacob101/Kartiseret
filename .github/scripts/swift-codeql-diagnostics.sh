#!/usr/bin/env bash
set -uo pipefail
mode=${1:?Expected select, monitor, baseline or traced}
root="$RUNNER_TEMP/swift-codeql-diagnostics"
mkdir -p "$root"
# Input: ps -A -o pid=,comm=. Match executable basenames only, not directory names.
select_targets() {
  awk '{ pid=$1; $1=""; sub(/^[[:space:]]+/, ""); n=split($0, parts, "/"); name=parts[n]; if (name == "extractor.real" || name == "swift-frontend" || name == "xcodebuild") print pid, name }'
}
case "$mode" in
  select) select_targets; exit 0 ;;
  monitor)
    mkdir -p "$root/stacks"
    start=$(date +%s)
    next_stack=120
    while [ ! -f "$root/monitor.stop" ] && (( $(date +%s) - start < 3000 )); do
      now=$(date +%s)
      elapsed=$((now - start))
      phase=$(cat "$root/phase" 2>/dev/null || printf 'setup')
      {
        printf '\n=== UTC %s elapsed=%ss phase=%s ===\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$elapsed" "$phase"
        ps -A -o pid,ppid,pcpu,pmem,rss,etime,comm | sort -k3,3nr | head -35 || true
        vm_stat | head -15 || true
        df -h "$RUNNER_TEMP" | tail -1 || true
        du -sk "$RUNNER_TEMP/codeql_databases/swift" 2>/dev/null || true
      } >> "$root/process-samples.txt" 2>&1
      if [ "$phase" = traced ] && (( elapsed >= next_stack )); then
        ps -A -o pid=,comm= | select_targets | head -3 | while read -r pid name; do
          printf '%s elapsed=%s pid=%s executable=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$elapsed" "$pid" "$name" >> "$root/stack-samples.txt"
          sample "$pid" 2 -file "$root/stacks/${elapsed}s-${pid}-${name}.txt" >> "$root/stack-samples.txt" 2>&1 || true
        done
        next_stack=$((elapsed + 120))
      fi
      sleep 10
    done
    touch "$root/monitor.done"
    exit 0 ;;
  baseline|traced) ;;
  *) echo "Invalid mode: $mode" >&2; exit 2 ;;
esac
out="$root/$mode"
mkdir -p "$out"
printf '%s\n' "$mode" > "$root/phase"
printf 'Phase %s started %s\n' "$mode" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" | tee "$out/timing.txt"
start=$(date +%s)
set +e
/usr/bin/time -l xcodebuild build \
  -project 'Codebase - Kartiseret iOS/Kartiseret.xcodeproj' -target Kartiseret \
  -showBuildTimingSummary ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  SYMROOT="$RUNNER_TEMP/$mode-build" OBJROOT="$RUNNER_TEMP/$mode-obj" \
  CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO \
  COMPILATION_CACHE_ENABLE_CACHING=NO SWIFT_ENABLE_COMPILE_CACHE=NO \
  SWIFT_USE_INTEGRATED_DRIVER=NO 2>&1 | tee "$out/xcodebuild.log"
result=${PIPESTATUS[0]}
set -e
printf 'Phase %s ended %s; wall=%ss; exit=%s\n' "$mode" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$(( $(date +%s) - start ))" "$result" | tee -a "$out/timing.txt"
printf 'between-steps\n' > "$root/phase"
exit "$result"
