const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, nativeImage } = require('electron')
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
// Track the Tray template so we can replace it on mode changes (light/dark).
let trayTemplate = null

const HELPER_SOCKET = '/tmp/com.mca.helper.sock'
const HELPER_PLIST = path.join(app.getPath('home'), 'Library/LaunchAgents/com.mca.helper.v2.plist')
const HELPER_DIR = path.join(app.getPath('home'), '.mca')
const HELPER_BIN = path.join(HELPER_DIR, 'helper.js')
const HELPER_VERSION_FILE = path.join(HELPER_DIR, 'helper.version')
const STORE_PATH = path.join(app.getPath('userData'), 'config.json')
const CAFFEINE_PID_FILE = '/tmp/mca.caffeinate.pid'
const LOWPOWER_PID_FILE = '/tmp/mca.lowpower.pid'
const HELPER_VERSION = '2.0.0'

// ── Config store ──
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) } catch { return {} }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(cfg, null, 2))
}

// ── Caffeinate process management ──
function killProcessByPidFile(pidFile) {
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)
    if (pid) {
      try { process.kill(pid, 'SIGTERM') } catch {}
      // give it a moment, then SIGKILL
      setTimeout(() => { try { process.kill(pid, 'SIGKILL') } catch {} }, 300)
    }
  } catch {}
  try { fs.unlinkSync(pidFile) } catch {}
}

function startCaffeinate() {
  if (caffeineProcess) return
  // Clean up any stale caffeinate from a previous crash
  killProcessByPidFile(CAFFEINE_PID_FILE)

  // -i prevents idle system sleep. We removed -u so user-activity assertions don't fight Low Power Mode UI.
  caffeineProcess = spawn('caffeinate', ['-i', '-t', '86400'], { detached: true })

  if (caffeineProcess.pid) {
    fs.writeFileSync(CAFFEINE_PID_FILE, String(caffeineProcess.pid))
  }

  caffeineProcess.on('exit', () => {
    caffeineProcess = null
    try { fs.unlinkSync(CAFFEINE_PID_FILE) } catch {}
  })

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
  killProcessByPidFile(CAFFEINE_PID_FILE)
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

// Helper daemon (Node.js) — installed into ~/.mca/helper.js and run via launchd.
// v2 uses a single Node.js event loop instead of bash+socat/nc to avoid the
// file-descriptor leak and fork storm that made v1 become unresponsive.
const HELPER_CODE = fs.readFileSync(path.join(__dirname, 'helper.js'), 'utf8')

// Direct pmset via sudo (passwordless — requires /etc/sudoers.d entry)
function directPmset(action) {
  return new Promise((resolve, reject) => {
    let cmd
    if (action === 'DISABLE') cmd = 'sudo -n pmset -a disablesleep 1'
    else if (action === 'ENABLE') cmd = 'sudo -n pmset -a disablesleep 0'
    else if (action === 'STATUS') cmd = 'sudo -n pmset -g | grep -o "SleepDisabled [0-9]" | awk "{print \\$2}"'
    else if (action === 'LOWPOWER_ON') cmd = 'sudo -n pmset -a lowpowermode 1'
    else if (action === 'LOWPOWER_OFF') cmd = 'sudo -n pmset -a lowpowermode 0'
    else if (action === 'LOWPOWER_STATUS') cmd = 'sudo -n pmset -g | grep -o "lowpowermode [0-9]" | awk "{print \\$2}"'
    else { reject(new Error('Unknown action')); return }
    exec(cmd, (err, stdout) => {
      if (err) reject(err)
      else if (action === 'STATUS' || action === 'LOWPOWER_STATUS') resolve({ ok: true, status: parseInt(stdout.trim()) || 0 })
      else resolve({ ok: true })
    })
  })
}

async function sendHelper(cmd) {
  // Try helper socket first
  return new Promise((resolve, reject) => {
    const socket = new net.Socket({ allowHalfOpen: true })
    let buffer = ''
    let settled = false

    socket.setTimeout(5000)
    socket.connect(HELPER_SOCKET, () => {
      socket.write(cmd)
      // Half-close the write side so the helper's command reader gets EOF
      // and can respond promptly instead of waiting for a timeout.
      socket.end()
    })

    socket.on('data', (data) => {
      buffer += data.toString()
    })

    socket.on('end', async () => {
      if (settled) return
      settled = true
      socket.destroy()
      const msg = buffer.trim()
      if (msg === 'OK') resolve({ ok: true })
      else if (msg.startsWith('ERR')) reject(new Error('Helper error: ' + msg))
      else resolve({ ok: true, status: parseInt(msg) || 0 })
    })

    socket.on('error', async () => {
      if (settled) return
      settled = true
      socket.destroy()
      try {
        resolve(await directPmset(cmd))
      } catch (e) {
        reject(new Error('Helper not running and sudo pmset failed: ' + e.message))
      }
    })

    socket.on('timeout', async () => {
      if (settled) return
      settled = true
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

  // Write helper script (Node.js, bundled in the app)
  fs.writeFileSync(HELPER_BIN, HELPER_CODE, { mode: 0o755 })
  fs.writeFileSync(HELPER_VERSION_FILE, HELPER_VERSION)

  // Detect the absolute path to node/bun while we still have the user's PATH.
  // launchd user agents get a minimal PATH, so hardcoding the interpreter avoids
  // "command not found" (exit 127) on systems where node is outside /usr/bin.
  function findInterpreter() {
    for (const cmd of ['node', 'bun']) {
      try {
        const p = execSync(`command -v ${cmd}`, { encoding: 'utf8', shell: true }).trim()
        if (p) return { path: p, cmd }
      } catch {}
    }
    return null
  }
  const interpreter = findInterpreter()
  // Wrapper tries the detected interpreter first, then falls back to PATH search.
  const launcher = interpreter
    ? `exec "${interpreter.path}" "${HELPER_BIN}" 2>/dev/null || exec /usr/bin/env node "${HELPER_BIN}" 2>/dev/null || exec /usr/bin/env bun "${HELPER_BIN}"`
    : `exec /usr/bin/env node "${HELPER_BIN}" 2>/dev/null || exec /usr/bin/env bun "${HELPER_BIN}"`

  // launchd runs user agents with a minimal PATH, so expose common interpreter locations.
  const pathEnv = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'

  // Write launchd plist
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mca.helper.v2</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathEnv}</string>
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>${launcher}</string>
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

  // Load into the user launchd domain. User agents don't need admin privileges,
  // so we avoid the osascript password prompt entirely.
  const uid = process.getuid()
  return new Promise((resolve, reject) => {
    // Stop any existing instance (both old v1 and current v2 labels).
    exec(
      `launchctl bootout gui/${uid}/com.mca.helper 2>/dev/null; ` +
      `launchctl bootout gui/${uid}/com.mca.helper.v2 2>/dev/null; ` +
      `launchctl bootstrap gui/${uid} "${HELPER_PLIST}"`,
      (err) => {
        if (err) reject(err)
        else {
          helperRunning = true
          saveConfig({ ...loadConfig(), helperInstalled: true })
          resolve({ ok: true })
        }
      }
    )
  })
}

function restartHelper() {
  const uid = process.getuid()
  return new Promise((resolve, reject) => {
    exec(
      `launchctl bootout gui/${uid}/com.mca.helper 2>/dev/null; ` +
      `launchctl bootout gui/${uid}/com.mca.helper.v2 2>/dev/null; ` +
      `launchctl bootstrap gui/${uid} "${HELPER_PLIST}"`,
      (err) => {
        if (err) reject(err)
        else resolve({ ok: true })
      }
    )
  })
}

async function ensureHelper() {
  // Reinstall if the on-disk helper is missing or from an older version.
  let needsInstall = false
  try {
    const currentVersion = fs.readFileSync(HELPER_VERSION_FILE, 'utf8').trim()
    if (currentVersion !== HELPER_VERSION) needsInstall = true
  } catch {
    needsInstall = true
  }

  const helperOk = await checkHelper()

  if (needsInstall) {
    // Outdated helper — reinstall the new version.
    try {
      await installHelper()
      return
    } catch (e) {
      logError('Failed to install helper:', e.message)
      throw e
    }
  }

  if (!helperOk) {
    // Same version but not responding — try a non-admin restart first.
    try {
      await restartHelper()
      await new Promise(r => setTimeout(r, 500))
      if (await checkHelper()) return
    } catch {}

    // Restart didn't help; do a full reinstall.
    try {
      await installHelper()
    } catch (e) {
      logError('Failed to install helper:', e.message)
      throw e
    }
  }
}

function checkHelper() {
  return new Promise((resolve) => {
    const socket = new net.Socket({ allowHalfOpen: true })
    socket.setTimeout(1000)
    socket.connect(HELPER_SOCKET, () => {
      socket.write('STATUS')
      socket.end()
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

// ── Low Power Mode management ──
// Low Power Mode is independent of sleep, but macOS's UI can hide it while sleep is globally disabled.
// We optionally enable LPM while awake so the Mac runs cooler in clamshell mode.
async function getLowPowerStatus() {
  try {
    const result = await sendHelper('LOWPOWER_STATUS')
    return result.status || 0
  } catch (e) {
    logError('Failed to read lowpowermode status:', e.message)
    return 0
  }
}

async function applyLowPowerMode(enabled) {
  const cfg = loadConfig()
  if (enabled) {
    // Save current state before turning on
    if (cfg.savedLowPowerMode === undefined) {
      cfg.savedLowPowerMode = await getLowPowerStatus()
    }
    await sendHelper('LOWPOWER_ON')
    cfg.lowPowerModeActive = true
  } else {
    // Restore to saved state (or 0 if no saved state)
    const restoreTo = cfg.savedLowPowerMode !== undefined ? cfg.savedLowPowerMode : 0
    await sendHelper(restoreTo ? 'LOWPOWER_ON' : 'LOWPOWER_OFF')
    cfg.lowPowerModeActive = false
    cfg.savedLowPowerMode = undefined
  }
  saveConfig(cfg)
}

function getLowPowerPreference() {
  return loadConfig().lowPowerModeEnabled === true
}

function setLowPowerPreference(enabled) {
  const cfg = loadConfig()
  cfg.lowPowerModeEnabled = enabled
  saveConfig(cfg)
  return enabled
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
    saveConfig({ ...loadConfig(), isAwake: true, remaining: -1, totalDuration: 0 })
    if (win && !win.isDestroyed()) win.webContents.send('tick', -1)
    return
  }

  remaining = secs
  totalDuration = secs
  saveConfig({ ...loadConfig(), isAwake: true, remaining, totalDuration })
  restoreTimer = setInterval(() => {
    remaining--
    saveConfig({ ...loadConfig(), remaining })
    if (win && !win.isDestroyed()) win.webContents.send('tick', remaining)
    updateTrayMenu()
    if (remaining <= 0) {
      clearInterval(restoreTimer)
      sendHelper('ENABLE').catch(() => {})
      saveConfig({ ...loadConfig(), isAwake: false, remaining: 0 })
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

    // Optionally enable Low Power Mode for cooler clamshell operation
    if (getLowPowerPreference()) {
      await applyLowPowerMode(true)
    }

    // Mark active session so crash recovery can resume or clean up
    saveConfig({ ...loadConfig(), isAwake: true })

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

  // Restore Low Power Mode if we changed it
  const cfg = loadConfig()
  if (cfg.lowPowerModeActive) {
    await applyLowPowerMode(false).catch(() => {})
  }

  try {
    await sendHelper('ENABLE')
    remaining = 0
    saveConfig({ ...loadConfig(), isAwake: false })
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
    const lowPowerStatus = await getLowPowerStatus()
    const cfg = loadConfig()
    return {
      helperInstalled: true,
      disabled,
      remaining: forever ? -1 : remaining,
      elapsed: totalDuration - remaining,
      lowPowerMode: lowPowerStatus === 1,
      lowPowerEnabled: cfg.lowPowerModeEnabled === true,
      isAwake: cfg.isAwake === true
    }
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

ipcMain.handle('get-low-power-preference', () => {
  return { enabled: getLowPowerPreference() }
})

ipcMain.handle('set-low-power-preference', async (_, enabled) => {
  try {
    setLowPowerPreference(enabled)
    // If we're currently awake, apply/unapply immediately
    if (forever || remaining > 0) {
      await applyLowPowerMode(enabled)
    }
    return { ok: true, enabled }
  } catch (e) {
    return { ok: false, error: e.message }
  }
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

// ── Unified cleanup ──
async function doCleanup() {
  logError('Running cleanup before quit')
  stopCaffeinate()
  stopPowerMonitor()
  clearInterval(restoreTimer)

  const cfg = loadConfig()
  if (cfg.lowPowerModeActive) {
    await applyLowPowerMode(false).catch(() => {})
  }

  try {
    await sendHelper('ENABLE')
    saveConfig({ ...loadConfig(), isAwake: false })
  } catch (e) {
    logError('Failed to re-enable sleep during cleanup:', e.message)
  }
}

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
  items.push({
    label: 'Quit',
    click: async () => {
      await doCleanup()
      tray = null
      app.quit()
    }
  })
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

// Make the tray icon from the bundled PNG at a standard menu-bar size.
// Electron's Tray cannot always load .icns inside asar, so we resample the
// source PNG (1024×1024) down to 22×22 — the HIG-recommended size for menu bar.
function makeTrayIcon() {
  const pngPath = path.join(__dirname, 'icon.png')
  const img = nativeImage.createFromPath(pngPath)
  if (!img.isEmpty()) {
    return img.resize({ width: 22, height: 22 })
  }
  // Fallback: try the icns directly (works outside asar on some installs).
  return nativeImage.createFromPath(path.join(__dirname, 'icon.icns'))
}

// ── App ──
let cleanupInProgress = false

app.whenReady().then(async () => {
  createWindow()
  trayTemplate = makeTrayIcon()
  tray = new Tray(trayTemplate)
  tray.setToolTip('MacClosedAwake — Lid closed. Still awake.')
  updateTrayMenu()

  // Make sure the helper is present and responsive before we rely on it.
  try {
    await ensureHelper()
  } catch (e) {
    logError('Helper setup failed:', e.message)
  }

  // Crash/recovery: if we died while awake, resume state; otherwise clean up stale pmset flags.
  try {
    const cfg = loadConfig()
    const status = await sendHelper('STATUS')
    const sleepDisabled = status.status === 1

    if (cfg.isAwake && sleepDisabled) {
      // Resume the previous session
      forever = cfg.remaining === -1 || cfg.remaining === undefined
      remaining = forever ? 0 : (cfg.remaining || 0)
      totalDuration = cfg.totalDuration || remaining
      if (forever) {
        if (win && !win.isDestroyed()) win.webContents.send('tick', -1)
      } else if (remaining > 0) {
        startTimer(remaining)
      }
      startCaffeinate()
      startPowerMonitor()
      if (cfg.lowPowerModeEnabled) await applyLowPowerMode(true).catch(() => {})
      updateTrayMenu()
      logError('Resumed previous awake session')
    } else if (sleepDisabled) {
      // Stale disablesleep from a crash — restore
      logError('Cleaning up stale disablesleep from previous crash')
      await doCleanup()
    }
  } catch (e) {
    logError('Startup recovery check failed:', e.message)
  }
})

app.on('window-all-closed', () => {
  // Mac apps typically stay alive via tray; no cleanup here.
})

// Clean up before exiting. Prevent default, do async cleanup, then actually quit.
app.on('before-quit', async (e) => {
  if (cleanupInProgress) return
  cleanupInProgress = true
  e.preventDefault()
  await doCleanup()
  app.quit()
})

app.on('will-quit', () => {
  console.log('[MCA] Quit complete')
})
