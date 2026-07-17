#!/usr/bin/env bash
# edge-watchdog: kill Edge renderers stuck at >150% CPU
# Run via: launchd every 5 min, or /loop 10m
set -euo pipefail

THRESHOLD=150
LOG="/tmp/edge-watchdog.log"

killed=0
while IFS= read -r line; do
  pid=$(echo "$line" | awk '{print $1}')
  cpu=$(echo "$line" | awk '{print $2}')
  if [ "${cpu%.*}" -gt "$THRESHOLD" ] 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null && {
      echo "[$(date)] killed Edge renderer PID=$pid CPU=$cpu%" | tee -a "$LOG"
      killed=$((killed+1))
    }
  fi
done < <(ps aux | grep "Edge Helper (Renderer)" | grep -v grep | awk '{print $2, $3}')

[ "$killed" -gt 0 ] && echo "[$(date)] watchdog: killed $killed hung renderers" | tee -a "$LOG"
exit 0
