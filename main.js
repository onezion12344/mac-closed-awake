const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog } = require('electron')
const { exec, spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const net = require('net')

let win, tray
let restoreTimer = null
let remaining = 0
let totalDuration = 0
let helperRunning = false
let forever = false

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

// ── Helper daemon ──
const HELPER_SCRIPT = `#!/bin/bash
# MacClosedAwake privileged helper — runs as root via launchd
SOCKET="${HELPER_SOCKET}"
rm -f "$SOCKET"

disable_sleep() {
  pmset -a disablesleep 1
}

enable_sleep() {
  pmset -a disablesleep 0
}

get_status() {
  pmset -g custom | grep -o 'disablesleep [0-9]' | awk '{print $2}'
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
      esac
    done
  fi
done
`

async function sendHelper(cmd) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    socket.setTimeout(3000)
    socket.connect(HELPER_SOCKET, () => {
      socket.write(cmd)
    })
    socket.on('data', (data) => {
      const msg = data.toString().trim()
      socket.destroy()
      if (msg === 'OK') resolve({ ok: true })
      else if (msg === 'ERR') reject(new Error('Helper error'))
      else resolve({ ok: true, status: parseInt(msg) })
    })
    socket.on('error', () => {
      socket.destroy()
      reject(new Error('Helper not running'))
    })
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error('Helper timeout'))
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
    await sendHelper('DISABLE')
    startTimer(secs)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('stop', async () => {
  clearInterval(restoreTimer)
  forever = false
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
  shell.openExternal('https://mca.app/upgrade')
})

// ── Tray ──
function updateTrayMenu() {
  if (!tray) return
  const label = forever ? 'Forever' : remaining > 0 ? `${fmtTime(remaining)} left` : 'Off'
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => { win.show(); win.focus() } },
    { label: `Status: ${label}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { tray = null; app.quit() } },
  ]))
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
    height: 600,
    resizable: false,
    maximizable: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#0f0f1a',
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
  tray.setToolTip('MacClosedAwake')
  updateTrayMenu()
})

app.on('window-all-closed', () => {})
