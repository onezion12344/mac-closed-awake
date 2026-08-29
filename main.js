const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, nativeImage } = require('electron')
const { exec, spawn, execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const net = require('net')

const { verifyActivationCode } = require('./license')

// ⚠️ PRODUCTION WARNING: This is a TEST Stripe link with test-mode success_url.
// Before shipping: (1) swap to production Payment Link URL, (2) set production
// success_url to https://mca.onezion.top/success?session_id={CHECKOUT_SESSION_ID}
// in the Stripe dashboard (Payment Links → Edit → After payment → Redirect to URL).
// Also replace the Stripe secret key in the CF Worker with your production key.
const STRIPE_LIFETIME_URL = 'https://buy.stripe.com/test_eVqaER2GQdWaars23a4ko0s?success_url=https://mca.onezion12344.workers.dev/success?session_id={CHECKOUT_SESSION_ID}'
// TODO: Replace with production Stripe lifetime payment link + live Worker domain

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
const HELPER_VERSION = '2.1.0'

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

  // -s asserts PreventSystemSleep, which is what actually survives a lid close.
  // -i alone only blocks *idle* sleep; closing the lid is an explicit sleep
  // request, so -i does not keep the machine awake in clamshell mode.
  // -m keeps the disk from idle-sleeping so long builds don't stall on I/O.
  // Note: the kernel honours -s only on AC power (see caffeinate(1)); on battery
  // the pmset disablesleep flag from the helper is what carries the session.
  caffeineProcess = spawn('caffeinate', ['-s', '-i', '-m', '-t', '86400'], { detached: true })

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
  // Legacy lid-event re-apply; kept for the power monitor. No-op-safe.
  sendHelper('DISABLE').catch(() => {})
}

function startTimer(secs) {
  clearInterval(restoreTimer)
  forever = false

  if (secs === 0) {
    // Forever mode — no per-second tick, but we still need a reconciliation
    // loop so disablesleep gets re-asserted if macOS clears it.
    forever = true
    saveConfig({ ...loadConfig(), isAwake: true, remaining: -1, totalDuration: 0 })
    if (win && !win.isDestroyed()) win.webContents.send('tick', -1)
    restoreTimer = setInterval(() => {
      reassertDisableSleep()
      checkCriticalBattery()
    }, 5000)
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
    // Reconciliation: macOS can clear disablesleep after a Maintenance Sleep,
    // Clamshell Sleep (on a near-flat battery), or Thermal Emergency Sleep,
    // even when the flag was set. Re-assert it on every tick so the session
    // stays armed for its full duration.
    if (remaining % 5 === 0) reassertDisableSleep()
    // Data-safety: if the battery hits ≤2% mid-session, stop keeping awake so
    // macOS can hibernate/shutdown cleanly instead of force-killing the system.
    if (remaining % 5 === 0) checkCriticalBattery()
    if (remaining <= 0) {
      clearInterval(restoreTimer)
      restoreTimer = null
      sendHelper('ENABLE').catch(() => {})
      saveConfig({ ...loadConfig(), isAwake: false, remaining: 0 })
      if (win && !win.isDestroyed()) win.webContents.send('restored')
    }
  }, 1000)
}

// Verify disablesleep is still 1 during an active session; re-assert if not.
async function reassertDisableSleep() {
  if (!forever && remaining <= 0) return
  try {
    const result = await sendHelper('STATUS')
    // The session may have ended while we awaited STATUS — e.g. the battery hit
    // ≤2% on this same tick and checkCriticalBattery() → restoreSleep() re-enabled
    // sleep (and cleared the timer). Without this re-check we'd misread status 0
    // as "macOS cleared disablesleep" and re-DISABLE, undoing the critical-battery
    // restore — which made both "restore sleep at ≤2%" and force-sleep fail.
    if (restoreTimer === null) return
    if (result.status !== 1) {
      logError(`disablesleep was ${result.status} mid-session — re-asserting`)
      await sendHelper('DISABLE')
      // LPM preference should be re-applied too, since a wake can reset it.
      if (getLowPowerPreference()) await applyLowPowerMode(true).catch(() => {})
    }
  } catch (e) {
    logError('reassert status check failed:', e.message)
  }
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
  return restoreSleep('user stop')
})

// Restore normal sleep and stop all keep-awake machinery.
// Used by the Stop button, auto-expiry, and critical-battery safety.
async function restoreSleep(trigger) {
  clearInterval(restoreTimer)
  restoreTimer = null
  forever = false

  // Stop all monitoring processes
  stopCaffeinate()
  stopPowerMonitor()

  // Restore Low Power Mode if we changed it
  const cfg = loadConfig()
  if (cfg.lowPowerModeActive) {
    await applyLowPowerMode(false).catch(() => {})
  }

  let err = null
  try {
    await sendHelper('ENABLE')
  } catch (e) {
    err = e
    logError('restoreSleep ENABLE failed:', e.message)
  }

  remaining = 0
  totalDuration = 0
  saveConfig({ ...loadConfig(), isAwake: false })
  if (win && !win.isDestroyed()) win.webContents.send('restored')
  updateTrayMenu()
  logError(`Sleep restored (${trigger})`)
  return err ? { ok: false, error: err.message } : { ok: true }
}

// Auto-restore when battery is critically low (≤2%) so macOS can shut down
// cleanly and save state instead of force-powering off mid-write.
async function checkCriticalBattery() {
  if (!forever && remaining <= 0) return
  // Respect the user's toggle: default on, but they can disable auto-restore.
  if (loadConfig().batteryProtect === false) return
  let power
  try {
    power = await getPowerSource()
  } catch (e) {
    logError('battery check failed:', e.message)
    return
  }
  if (!power.onAC && power.percent !== null && power.percent <= 2) {
    // Re-enable sleep so the Mac can sleep on its own: if the lid is closed,
    // macOS sleeps immediately and hibernates (RAM → disk) while there's still
    // charge; if the lid is open, we don't force sleep.
    logError(`Battery critical (${power.percent}%) — restoring sleep to preserve session`)
    await restoreSleep('critical battery')

    // Optional: force immediate sleep even with the lid open, so the session is
    // preserved before the battery dies. Off by default — restoring sleep already
    // covers the lid-closed case.
    if (loadConfig().forceSleep === true) {
      logError('forceSleep enabled — forcing immediate sleep')
      try {
        await sendHelper('SLEEPNOW')
      } catch (e) {
        logError('force sleep failed:', e.message)
      }
    }
  }
}

// Read the current power source and battery percentage.
// Clamshell sessions on battery drain fast and caffeinate -s is ignored off AC,
// so the UI warns when a session starts without the charger.
function getPowerSource() {
  return new Promise((resolve) => {
    exec('pmset -g batt', (err, stdout) => {
      if (err) { resolve({ onAC: true, percent: null }); return }
      const onAC = /AC Power/.test(stdout)
      const m = stdout.match(/(\d+)%/)
      resolve({ onAC, percent: m ? parseInt(m[1], 10) : null })
    })
  })
}

ipcMain.handle('status', async () => {
  try {
    const helperOk = await checkHelper()
    if (!helperOk) return { helperInstalled: false, disabled: false, remaining: 0 }

    // Get pmset status via helper
    const result = await sendHelper('STATUS')
    const disabled = result.status === 1
    const lowPowerStatus = await getLowPowerStatus()
    const power = await getPowerSource()
    const cfg = loadConfig()
    const storage = checkStorage()
    return {
      helperInstalled: true,
      disabled,
      remaining: forever ? -1 : remaining,
      elapsed: totalDuration - remaining,
      lowPowerMode: lowPowerStatus === 1,
      lowPowerEnabled: cfg.lowPowerModeEnabled === true,
      batteryProtect: cfg.batteryProtect !== false, // default on
      forceSleep: cfg.forceSleep === true, // default off
      isAwake: cfg.isAwake === true,
      onAC: power.onAC,
      batteryPercent: power.percent,
      storage
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

ipcMain.handle('version', () => {
  return app.getVersion() || '1.0.0'
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
    // Apply immediately if we're currently awake. Also force-off if a stale
    // session left lowPowerModeActive=true but we're not awake (the previous
    // session crashed / was force-killed, leaving pmset stuck ON — that's the
    // "LPM 关不掉" bug).
    const cfg = loadConfig()
    if (forever || remaining > 0) {
      await applyLowPowerMode(enabled)
    } else if (cfg.lowPowerModeActive && !enabled) {
      logError('LPM stuck-on from previous session — force-off')
      await applyLowPowerMode(false).catch(() => {})
    }
    return { ok: true, enabled }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('set-battery-protect', async (_, enabled) => {
  try {
    const cfg = loadConfig()
    cfg.batteryProtect = enabled === true
    saveConfig(cfg)
    return { ok: true, enabled: cfg.batteryProtect }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('set-force-sleep', async (_, enabled) => {
  try {
    const cfg = loadConfig()
    cfg.forceSleep = enabled === true
    saveConfig(cfg)
    return { ok: true, enabled: cfg.forceSleep }
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

// ── Storage health & cleanup suggestions ──
function checkStorage() {
  try {
    const out = require('child_process').execSync('df -k / | tail -1', { encoding: 'utf8' })
    const m = out.match(/(\d+)\s+(\d+)\s+(\d+)/)
    if (!m) return { freeBytes: 0, totalBytes: 0, memoryBytes: 0, warning: null }
    const total = parseInt(m[1], 10) * 1024
    const used = parseInt(m[2], 10) * 1024
    const free = parseInt(m[3], 10) * 1024
    const mem = require('os').totalmem()
    // hibernatemode 3 writes a full RAM image; warn if free < memory.
    // Use 0.8× memory as a softer "tight" threshold so the user sees a warning
    // before the hibernate write actually fails.
    const warning = free < mem
      ? `Storage low — hibernate may fail and restart. ${(free / 1024 ** 3).toFixed(1)} GB free, RAM ${(mem / 1024 ** 3).toFixed(0)} GB.`
      : free < mem * 0.8
        ? `Storage getting tight — ${(free / 1024 ** 3).toFixed(1)} GB free.`
        : null
    return { freeBytes: free, totalBytes: total, usedBytes: used, memoryBytes: mem, warning }
  } catch (e) {
    return { freeBytes: 0, totalBytes: 0, memoryBytes: 0, warning: null }
  }
}

// Scan well-known large directories and return their sizes. Read-only — we
// never delete anything; the user clears them manually with the suggestions.
function getCleanupSuggestions() {
  const candidates = [
    { name: 'WeChat (微信 cache & downloads)', path: '~/Library/Containers/com.tencent.xinWeChat' },
    { name: 'QQ container', path: '~/Library/Containers/com.tencent.qq' },
    { name: 'Microsoft Edge', path: '~/Library/Application Support/Microsoft Edge' },
    { name: 'Notion cache', path: '~/Library/Application Support/Notion' },
    { name: 'Docker containers', path: '~/Library/Containers/com.docker.docker' },
    { name: 'Colima VM', path: '~/.colima' },
    { name: 'Ollama models', path: '~/.ollama' },
    { name: 'Homebrew cache', path: '~/Library/Caches/Homebrew' },
    { name: 'pnpm store', path: '~/Library/pnpm' },
    { name: 'npm cache', path: '~/.npm' },
    { name: 'pip cache', path: '~/.cache/pip' },
    { name: 'User Caches', path: '~/Library/Caches' },
    { name: 'System logs (older)', path: '~/Library/Logs/DiagnosticReports' },
  ]
  const out = []
  for (const c of candidates) {
    const expanded = c.path.replace(/^~/, require('os').homedir())
    try {
      if (!require('fs').existsSync(expanded)) continue
      const size = require('child_process').execSync(
        `du -sh "${expanded}" 2>/dev/null | awk '{print $1}'`, { encoding: 'utf8', timeout: 8000 }
      ).trim()
      if (!size || size === '0B') continue
      out.push({ name: c.name, path: expanded, size })
    } catch {}
  }
  // Sort by size (best-effort: M > K, B as smallest)
  const toMB = s => {
    const m = s.match(/^([\d.]+)(B|K|M|G|T)$/i)
    if (!m) return 0
    const n = parseFloat(m[1]); const u = m[2].toUpperCase()
    return n * ({ B: 1e-6, K: 1e-3, M: 1, G: 1e3, T: 1e6 }[u] || 0)
  }
  out.sort((a, b) => toMB(b.size) - toMB(a.size))
  return out
}

ipcMain.handle('get-cleanup-suggestions', () => {
  try {
    const items = getCleanupSuggestions()
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: e.message, items: [] }
  }
})

ipcMain.handle('open-path', (_, p) => {
  try {
    require('child_process').exec(`open "${p}"`)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Nuclear: quit every user app, force-kill stragglers, then shut down or reboot ──
function execScriptFile(file) {
  return new Promise((resolve) => {
    exec(`bash "${file}"`, (err, stdout, stderr) => {
      const ok = !err
      logError((ok ? 'nuclear step OK' : 'nuclear step ERR') + ': ' + (err ? err.message : ''))
      resolve({ ok, stdout, stderr })
    })
  })
}

// mode: 'shutdown' → power off; 'restart' → reboot
async function runNuclear(mode) {
  const finalCmd = mode === 'shutdown' ? 'shutdown -h now' : 'shutdown -r now'
  // Phase 1 — graceful/force quit of every user GUI app, run as the user
  // (killing our own processes needs no privileges). We exclude system
  // processes by binary path prefix and our own app; everything else is a
  // user app and gets quit then force-quit. The shut down / reboot is issued
  // separately via the privileged path.
  const script = `#!/bin/bash
APP_PIDS=$(osascript -e 'tell application "System Events" to get unix id of every application process whose background only is false' 2>/dev/null || true)
# Graceful quit first (SIGTERM)
for pid in $APP_PIDS; do
  path=$(ps -p "$pid" -o comm= 2>/dev/null | xargs)
  case "$path" in
    /System/*|/usr/*|/bin/*|/sbin/*|/Library/Apple/*|/Applications/MacClosedAwake.app/*) continue ;;
  esac
  kill "$pid" 2>/dev/null || true
done
# Give apps a chance to exit cleanly, then force-quit the stragglers
sleep 5
for pid in $APP_PIDS; do
  if kill -0 "$pid" 2>/dev/null; then
    path=$(ps -p "$pid" -o comm= 2>/dev/null | xargs)
    case "$path" in
      /System/*|/usr/*|/sbin/*|/Applications/MacClosedAwake.app/*) continue ;;
    esac
    kill -9 "$pid" 2>/dev/null || true
  fi
done
# Trigger shutdown/reboot via the normal privileged path.
osascript -e 'do shell script "${finalCmd}" with administrator privileges'
`
  const scriptPath = '/tmp/mca-nuclear.sh'
  fs.writeFileSync(scriptPath, script, { mode: 0o755 })
  const step = await execScriptFile(scriptPath)
  return step
}

ipcMain.handle('nuclear', async (_, mode) => {
  try {
    const action = mode === 'shutdown' ? 'shutting down' : 'rebooting'
    logError(`NUCLEAR: quitting all apps and ${action}`)
    const result = await runNuclear(mode)
    return result.ok ? { ok: true } : { ok: false, error: result.stderr }
  } catch (e) {
    logError('nuclear failed:', e.message)
    return { ok: false, error: e.message }
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
    width: 740,
    height: 740,
    resizable: true,
    maximizable: true,
    minWidth: 600,
    // Worst-case content (non-Pro + upgrade banner + battery warning) is ~720px.
    // minHeight must be ≥ that so shrinking can never push a button below the
    // fold — the window only gets bigger from here.
    minHeight: 740,
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
