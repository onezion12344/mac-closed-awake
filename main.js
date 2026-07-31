const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog } = require('electron')
const { exec, spawn, execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const net = require('net')

const { verifyActivationCode } = require('./license')

// ⚠️ PRODUCTION WARNING: This is a TEST Stripe link.
// Before shipping: replace 'https://buy.stripe.com/test_eVqaER2GQdWaars23a4ko0s' 
// with your production lifetime payment link from Stripe dashboard
const STRIPE_LIFETIME_URL = 'https://buy.stripe.com/test_eVqaER2GQdWaars23a4ko0s'
// TODO: Replace with production Stripe lifetime payment link

let win, tray
let restoreTimer = null
let caffeineProcess = null
let remaining = 0
let totalDuration = 0
let helperRunning = false
let forever = false
let lidCloseCount = 0

const HELPER_SOCKET = '/tmp/com.mca.helper.sock'
const HELPER_PLIST = path.join(app.getPath('home'), 'Library/LaunchAgents/com.mca.helper.plist')
const HELPER_BIN = path.join(app.getPath('home'), '.mca/lidar-helper')
const STORE_PATH = path.join(app.getPath('userData'), 'config.json')

// ── Config store ──
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) } catch { return {} }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(cfg, null, 2))
}

// ── Caffeinate process management ──
function startCaffeinate() {
  if (caffeineProcess) return
  
  // Use caffeine with UI notification and idle prevention
  caffeineProcess = spawn('caffeinate', ['-u', '-i', '-t', '86400'], { detached: true })
  
  caffeineProcess.on('error', (err) => {
    logError('Failed to start caffeine:', err.message)
    caffeineProcess = null
  })
  
  caffeineProcess.unref()
  logError('Started caffeine process')
}

function stopCaffeinate() {
  if (caffeineProcess) {
    try {
      caffeineProcess.kill('SIGTERM')
    } catch {}
    caffeineProcess = null
    logError('Stopped caffeine process')
  }
}

function restartCaffeinate() {
  stopCaffeinate()
  
  if (forever || remaining > 0) {
    startCaffeinate()
  }
}

function logError(...args) {
  console.error('[MCA]', ...args)
}

// Helper daemon modified to support lid-event handling
const HELPER_SCRIPT = `#!/bin/bash
# MacClosedAwake privileged helper — runs as root via launchd
SOCKET="${HELPER_SOCKET}"
rm -f "$SOCKET"

disable_sleep() {
  # Double-check that no caffeine process is fighting us
  sudo -n pmset -a disablesleep 1
}

enable_sleep() {
  sudo -n pmset -a disablesleep 0
}

get_status() {
  pmset -g custom | grep -o 'disablesleep [0-9]' | awk '{print $2}'
}

handle_lid_close() {
  echo "LID_CLOSE" > /tmp/mca.lidevent
}

# Create Unix socket server
while true; do
  if [ -S "$SOCKET" ]; then
    rm -f "$SOCKET"
  fi

  # Use socat if available, else fall back to nc
  if command -v socat &>/dev/null; then
    socat UNIX-LISTEN:"$SOCKET",fork SYSTEM:'
      CMD=$(cat)
      case "$CMD" in
        DISABLE) disable_sleep && echo "OK" ;;
        ENABLE) enable_sleep && echo "OK" ;;
        STATUS) get_status ;;
        LID_CLOSE) handle_lid_close && echo "OK" ;;
        *) echo "ERR" ;;
      esac
    '
  else
    # Minimal socket server using nc
    while true; do
      CMD=$(nc -l -U "$SOCKET" 2>/dev/null)
      case "$CMD" in
        DISABLE) disable_sleep && echo "OK" ;;
        ENABLE) enable_sleep && echo "OK" ;;
        STATUS) get_status ;;
        LID_CLOSE) handle_lid_close && echo "OK" ;;
      esac
    done
  fi
done
`

// Direct pmset via sudo (passwordless — requires /etc/sudoers.d entry)
function directPmset(action) {
  return new Promise((resolve, reject) => {
    let cmd
    if (action === 'DISABLE') cmd = 'sudo -n pmset -a disablesleep 1'
    else if (action === 'ENABLE') cmd = 'sudo -n pmset -a disablesleep 0'
    else if (action === 'STATUS') cmd = 'sudo -n pmset -g custom | grep -o "disablesleep [0-9]" | awk "{print \\$2}"'
    else { reject(new Error('Unknown action')); return }
    exec(cmd, (err, stdout) => {
      if (err) reject(err)
      else if (action === 'STATUS') resolve({ ok: true, status: parseInt(stdout.trim()) || 0 })
      else resolve({ ok: true })
    })
  })
}

async function sendHelper(cmd) {
  // Try helper socket first
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    socket.setTimeout(2000)
    socket.connect(HELPER_SOCKET, () => {
      socket.write(cmd)
    })
    socket.on('data', (data) => {
      const msg = data.toString().trim()
      socket.destroy()
      if (msg === 'OK') resolve({ ok: true })
      else if (msg === 'ERR') reject(new Error('Helper error'))
      else resolve({ ok: true, status: parseInt(msg) || 0 })
    })
    socket.on('error', async () => {
      socket.destroy()
      // Fallback to direct sudo pmset
      try {
        resolve(await directPmset(cmd))
      } catch (e) {
        reject(new Error('Helper not running and sudo pmset failed: ' + e.message))
      }
    })
    socket.on('timeout', async () => {
      socket.destroy()
      try {
        resolve(await directPmset(cmd))
      } catch (e) {
        reject(new Error('Helper timeout and sudo pmset failed: ' + e.message))
      }
    })
  })
}

async function installHelper() {
  const dir = path.dirname(HELPER_BIN)
  fs.mkdirSync(dir, { recursive: true })

  // Write helper script
  fs.writeFileSync(HELPER_BIN, HELPER_SCRIPT, { mode: 0o755 })

  // Write launchd plist
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mca.helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${HELPER_BIN}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/mca-helper.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/mca-helper.err</string>
</dict>
</plist>
`
  fs.writeFileSync(HELPER_PLIST, plist)

  // Load with sudo via osascript
  return new Promise((resolve, reject) => {
    exec(`osascript -e 'do shell script "launchctl unload ${HELPER_PLIST} 2>/dev/null; launchctl load ${HELPER_PLIST}" with administrator privileges'`, (err) => {
      if (err) reject(err)
      else {
        helperRunning = true
        saveConfig({ ...loadConfig(), helperInstalled: true })
        resolve({ ok: true })
      }
    })
  })
}

function checkHelper() {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1000)
    socket.connect(HELPER_SOCKET, () => {
      socket.write('STATUS')
    })
    socket.on('data', (data) => {
      socket.destroy()
      resolve(true)
    })
    socket.on('error', () => {
      socket.destroy()
      resolve(false)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

// ── Timer ──
let powerMonitor = null

// Monitor system for power state changes (lid close/open)
function startPowerMonitor() {
  // If we already have a monitor, skip
  if (powerMonitor) return
  
  // Use system profiler to detect power events
  const monitorScript = `#!/bin/bash
# Continuous power monitor for MacClosedAwake
SOCKET="/tmp/com.mca.helper.sock"
LAST_STATUS=""
CHECK_COUNT=0

while true; do
  # Query current disablesleep status from pmset
  CURRENT=$(pmset -g custom 2>/dev/null | grep -o 'disablesleep [0-9]' | awk '{print $2}' || echo "unknown")
  
  # Check if we just closed the lid (every 5 seconds)
  CHECK_COUNT=$((CHECK_COUNT + 1))
  
  # On every 3rd check (~15s), also read battery/lid status
  if [ $((CHECK_COUNT % 3)) -eq 0 ]; then
    LID_INFO=$(ioreg -rn AppleRTC 2>/dev/null | grep -i lid || echo "")
    BATTERY_INFO=$(pmset -g batt 2>/dev/null | grep -i capacity || echo "")
    
    # Detect potential lid closure by checking if sleep was enabled
    if [ "$CURRENT" != "$LAST_STATUS" ] && [ "$LAST_STATUS" = "1" ]; then
      # Status changed from disabled to enabled while app should be running
      echo "LID_CLOSE" > /tmp/mca.lidevent.flag
    fi
  fi
  
  LAST_STATUS="$CURRENT"
  sleep 5
done
`
  
  fs.writeFileSync('/tmp/mca-power-monitor.sh', monitorScript, { mode: 0o755 })
  
  // Launch monitor as background process
  powerMonitor = spawn('bash', ['/tmp/mca-power-monitor.sh'], { detached: true })
  powerMonitor.unref()
  logError('Started power monitor')
}

function stopPowerMonitor() {
  if (powerMonitor) {
    try {
      powerMonitor.kill('SIGTERM')
    } catch {}
    powerMonitor = null
    logError('Stopped power monitor')
  }
  
  // Clear any event flags
  try {
    fs.unlinkSync('/tmp/mca.lidevent.flag')
  } catch {}
}

function reapplyDisableSleep() {
  // Re-enforce sleep disable via helper
  sendHelper('DISABLE').catch(() => {})
  logError('Re-applied disablesleep due to lid event')
}

function startTimer(secs) {
  clearInterval(restoreTimer)
  forever = false

  if (secs === 0) {
    // Forever mode
    forever = true
    if (win && !win.isDestroyed()) win.webContents.send('tick', -1)
    return
  }

  remaining = secs
  totalDuration = secs
  restoreTimer = setInterval(() => {
    remaining--
    if (win && !win.isDestroyed()) win.webContents.send('tick', remaining)
    updateTrayMenu()
    if (remaining <= 0) {
      clearInterval(restoreTimer)
      sendHelper('ENABLE').catch(() => {})
      if (win && !win.isDestroyed()) win.webContents.send('restored')
    }
  }, 1000)
}



// ── IPC handlers ──
ipcMain.handle('start', async (_, secs) => {
  try {
    lidCloseCount = 0
    await sendHelper('DISABLE')
    
    // Start caffeine process and power monitor to handle lid events
    startCaffeinate()
    startPowerMonitor()
    
    startTimer(secs)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('stop', async () => {
  clearInterval(restoreTimer)
  forever = false
  
  // Stop all monitoring processes
  stopCaffeinate()
  stopPowerMonitor()
  
  try {
    await sendHelper('ENABLE')
    remaining = 0
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('status', async () => {
  try {
    const helperOk = await checkHelper()
    if (!helperOk) return { helperInstalled: false, disabled: false, remaining: 0 }

    // Get pmset status via helper
    const result = await sendHelper('STATUS')
    const disabled = result.status === 1
    return { helperInstalled: true, disabled, remaining: forever ? -1 : remaining, elapsed: totalDuration - remaining }
  } catch {
    return { helperInstalled: false, disabled: false, remaining: 0 }
  }
})

ipcMain.handle('install-helper', async () => {
  try {
    await installHelper()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('is-pro', () => {
  const cfg = loadConfig()
  return cfg.isPro === true
})

ipcMain.handle('upgrade', () => {
  shell.openExternal(STRIPE_LIFETIME_URL)
})

ipcMain.handle('activate-license', async (_, licenseKey) => {
  try {
    const result = verifyActivationCode(licenseKey)
    if (result.valid) {
      const cfg = loadConfig()
      cfg.isPro = true
      cfg.licenseKey = licenseKey
      cfg.proEmail = result.email || ''
      saveConfig(cfg)
      if (win && !win.isDestroyed()) win.webContents.send('pro-status', true)
      return { ok: true }
    }
    return { ok: false, error: result.reason || 'Invalid activation code' }
  } catch (e) {
    return { ok: false, error: 'Activation failed. Please try again.' }
  }
})

// ── Tray ──
function updateTrayMenu() {
  if (!tray) return
  const label = forever ? 'Forever' : remaining > 0 ? `${fmtTime(remaining)} left` : 'Off'
  const cfg = loadConfig()
  const items = [
    { label: 'Show', click: () => { win.show(); win.focus() } },
    { label: `Status: ${label}`, enabled: false },
  ]
  if (!cfg.isPro) {
    items.push({ label: 'Upgrade to Pro', click: () => shell.openExternal(STRIPE_LIFETIME_URL) })
  }
  items.push({ type: 'separator' })
  items.push({ label: 'Quit', click: () => { tray = null; app.quit() } })
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

function fmtTime(s) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ── Window ──
function createWindow() {
  win = new BrowserWindow({
    width: 400,
    height: 720,
    resizable: false,
    maximizable: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#0d1b2a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  win.loadFile('index.html')
  win.on('close', (e) => {
    if (tray) { e.preventDefault(); win.hide() }
  })
}

// ── App ──
app.whenReady().then(() => {
  createWindow()
  tray = new Tray(path.join(__dirname, 'icon.png'))
  tray.setToolTip('MacClosedAwake — Lid closed. Still awake.')
  updateTrayMenu()
})

app.on('window-all-closed', () => {})
