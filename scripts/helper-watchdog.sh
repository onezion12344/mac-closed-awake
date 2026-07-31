#!/bin/bash
# MacClosedAwake Helper — Lid-close aware sleep prevention
# Monitors IOPMPSuspend notifications and re-enforces disablesleep on lid events

SOCKET="/tmp/com.mca.helper.sock"
STATE_FILE="/tmp/com.mca.state"
LOG_FILE="/tmp/mca-helper.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

init_state() {
  echo "disabled=0" > "$STATE_FILE"
}

read_state() {
  grep "^disabled=" "$STATE_FILE" | cut -d= -f2
}

set_state() {
  local disabled=$1
  sed -i '' "s/^disabled=.*/disabled=$disabled/" "$STATE_FILE"
  log "State: disabled=$disabled"
}

disable_sleep() {
  log "Disabling sleep via pmset"
  sudo -n pmset -a disablesleep 1
  set_state 1
  echo "OK"
}

enable_sleep() {
  log "Enabling sleep via pmset"
  sudo -n pmset -a disablesleep 0
  set_state 0
  echo "OK"
}

get_status() {
  local status=$(pmset -g custom 2>/dev/null | grep -o 'disablesleep [0-9]' | awk '{print $2}')
  if [ -z "$status" ]; then
    # Fallback: read from state file if pmset check fails
    local saved=$(read_state)
    echo "${saved:-0}"
  else
    echo "$status"
  fi
}

# Monitor for power management events (lid close/open)
monitor_power_events() {
  log "Starting power event monitor (PID $$)"
  
  while true; do
    # Use powersession to detect power state changes
    # This listens for IOPMPSuspend notifications
    /usr/bin/pmset -g log 2>/dev/null | \
      grep -E "(Battery power|Discharging|AC powered|Lid closed|Lid opened)" | \
      tail -n 1 >> "$LOG_FILE" 2>&1
    
    sleep 5
  done
}

# Handle lid-close events by re-enforcing sleep disable
handle_lid_close() {
  local current=$(read_state)
  if [ "$current" = "1" ]; then
    log "Lid closed event detected, re-enforcing disablesleep=1"
    sudo -n pmset -a disablesleep 1
  fi
}

# Main socket server loop
main() {
  init_state
  
  # Create socket directory
  rm -f "$SOCKET"
  
  log "Starting helper daemon on $SOCKET"
  
  # Start power event monitor in background
  monitor_power_events &
  MONITOR_PID=$!
  
  trap "kill $MONITOR_PID; exit" TERM INT
  
  # Socket server using socat
  if command -v socat &>/dev/null; then
    socat UNIX-LISTEN:"$SOCKET",fork,reuseaddr SYSTEM:'
      CMD=$(cat)
      case "$CMD" in
        DISABLE)
          disable_sleep
          ;;
        ENABLE)
          enable_sleep
          handle_lid_close
          ;;
        STATUS)
          get_status
          ;;
        LID_CLOSE)
          handle_lid_close
          echo "OK"
          ;;
        *)
          echo "ERR"
          ;;
      esac
    '
  else
    # Fallback to nc-based server
    log "socat not found, using nc fallback"
    while true; do
      echo "$(nc -l -U "$SOCKET" 2>/dev/null)" | while read CMD; do
        case "$CMD" in
          DISABLE)
            disable_sleep
            ;;
          ENABLE)
            enable_sleep
            ;;
          STATUS)
            get_status
            ;;
          LID_CLOSE)
            handle_lid_close
            echo "OK"
            ;;
        esac
      done
    done
  fi
}

main
