#!/usr/bin/env bash
set -uo pipefail
mode=${1:?Expected baseline or traced}
case "$mode" in baseline|traced) ;; *) echo "Invalid mode: $mode" >&2; exit 2 ;; esac
out="$RUNNER_TEMP/swift-codeql-diagnostics/$mode"
mkdir -p "$out"
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
exit "$result"
