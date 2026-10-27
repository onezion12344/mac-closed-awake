const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, nativeImage, Notification, powerMonitor } = require('electron')
const { exec, execFile, spawn, execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const net = require('net')

const { verifyActivationCode } = require('./license')
const mem = require('./memory')

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
// Critical-battery grace: the 60s countdown between "≤2%" and the actual
// sleep/restore, so the user has time to plug in the charger.
let criticalGraceTimer = null

const HELPER_SOCKET = '/tmp/com.mca.helper.sock'
const HELPER_PLIST = path.join(app.getPath('home'), 'Library/LaunchAgents/com.mca.helper.v2.plist')
const HELPER_DIR = path.join(app.getPath('home'), '.mca')
const HELPER_BIN = path.join(HELPER_DIR, 'helper.js')
const HELPER_VERSION_FILE = path.join(HELPER_DIR, 'helper.version')
const STORE_PATH = path.join(app.getPath('userData'), 'config.json')
const CAFFEINE_PID_FILE = '/tmp/mca.caffeinate.pid'
const LOWPOWER_PID_FILE = '/tmp/mca.lowpower.pid'
const HELPER_VERSION = '2.1.0'
// Where we install the one-time passwordless rule for shutdown/restart.
// The app-owned pmset rule already lives in /etc/sudoers.d/pmset; we add a
// separate file so we never touch (or clobber) the existing one.
const SHUTDOWN_SUDOERS = '/etc/sudoers.d/mac-closed-awake-shutdown'

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
  fs.mkdirSync(path.dirname(HELPER_PLIST), { recursive: true })

  // Write helper script (Node.js, bundled in the app)
  fs.writeFileSync(HELPER_BIN, HELPER_CODE, { mode: 0o755 })
  fs.writeFileSync(HELPER_VERSION_FILE, HELPER_VERSION)

  // Detect the absolute path to node/bun while we still have the user's PATH.
  // launchd user agents get a minimal PATH, and an app launched from Finder
  // inherits almost nothing from the shell, so `command -v node` misses
  // nvm/volta/homebrew installs. The wrapper then exits 127, launchd restarts
  // it forever, and the helper looks like it never installed. Probe the usual
  // locations explicitly, and fall back to the Electron binary (which can run
  // as plain Node) so a runtime is always available.
  function findInterpreter() {
    const candidates = []
    for (const cmd of ['node', 'bun']) {
      try {
        const p = execSync(`command -v ${cmd}`, { encoding: 'utf8', shell: true }).trim()
        if (p) candidates.push({ path: p, electron: false })
      } catch {}
    }
    const home = app.getPath('home')
    candidates.push(
      { path: '/opt/homebrew/bin/node', electron: false },
      { path: '/usr/local/bin/node', electron: false },
      { path: '/usr/bin/node', electron: false },
      { path: path.join(home, '.volta/bin/node'), electron: false },
      { path: path.join(home, '.local/bin/node'), electron: false },
      { path: '/opt/homebrew/bin/bun', electron: false },
    )
    // nvm keeps one node per version; take the newest that exists.
    try {
      const nvmDir = path.join(home, '.nvm/versions/node')
      const newestFirst = fs.readdirSync(nvmDir).sort((a, b) => {
        const pa = a.split('.').map(Number)
        const pb = b.split('.').map(Number)
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0)
        }
        return 0
      })
      for (const v of newestFirst) candidates.push({ path: path.join(nvmDir, v, 'bin/node'), electron: false })
    } catch {}

    for (const c of candidates) {
      try {
        fs.accessSync(c.path, fs.constants.X_OK)
        return c
      } catch {}
    }
    return { path: process.execPath, electron: true }
  }
  const interpreter = findInterpreter()
  const first = interpreter.electron
    ? `ELECTRON_RUN_AS_NODE=1 exec "${interpreter.path}" "${HELPER_BIN}"`
    : `exec "${interpreter.path}" "${HELPER_BIN}"`
  // Wrapper tries the detected interpreter first, then falls back to PATH search.
  const launcher = `${first} 2>/dev/null || exec /usr/bin/env node "${HELPER_BIN}" 2>/dev/null || exec /usr/bin/env bun "${HELPER_BIN}"`

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
    // `enable` is essential: if the label was ever disabled, bootstrap fails
    // with "5: Input/output error" forever and the helper can never start.
    exec(
      `launchctl bootout gui/${uid}/com.mca.helper 2>/dev/null; ` +
      `launchctl bootout gui/${uid}/com.mca.helper.v2 2>/dev/null; ` +
      `launchctl enable gui/${uid}/com.mca.helper.v2 2>/dev/null; ` +
      `launchctl bootstrap gui/${uid} "${HELPER_PLIST}"`,
      async (err) => {
        if (err) {
          reject(err)
          return
        }
        helperRunning = true
        saveConfig({ ...loadConfig(), helperInstalled: true })
        for (let attempt = 0; attempt < 20; attempt++) {
          if (await checkHelper()) {
            resolve({ ok: true })
            return
          }
          await new Promise(r => setTimeout(r, 250))
        }
        reject(new Error('Helper was installed but did not start. Check /tmp/mca-helper.err.'))
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
      `launchctl enable gui/${uid}/com.mca.helper.v2 2>/dev/null; ` +
      `launchctl bootstrap gui/${uid} "${HELPER_PLIST}"`,
      (err) => {
        if (err) reject(err)
        else resolve({ ok: true })
      }
    )
  })
}

async function ensureHelper() {
  if (!helperIsInstalled()) {
    await installHelper()
    return
  }

  if (!await checkHelper()) {
    try {
      await restartHelper()
    } catch (e) {
      logError('Failed to restart helper:', e.message)
    }
  }
}

function checkHelper() {
  return new Promise((resolve) => {
    const socket = new net.Socket({ allowHalfOpen: true })
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(2000)
    socket.connect(HELPER_SOCKET, () => {
      socket.write('STATUS')
      socket.end()
    })
    socket.on('data', (data) => finish(/^\d$/.test(data.toString().trim())))
    socket.on('error', () => finish(false))
    socket.on('timeout', () => finish(false))
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

// LPM is owned by macOS System Settings → Battery. We only read its current
// state (via getLowPowerStatus, which queries pmset) for display. We never
// write to it — see the read-only indicator in the renderer.

// ── Power events ──
// This used to be a detached bash loop that ran `pmset -g custom` every 5s and
// `ioreg` every 15s for the whole session — a permanent child process plus
// ~700 process spawns per hour, to write a flag file that nothing ever read.
// Electron already reports the only events we care about, so listen to those.
let powerListeners = null

function startPowerMonitor() {
  if (powerListeners) return
  const reassert = () => {
    // macOS can drop `disablesleep` across a wake or an unlock; put it back
    // while a session is still live.
    if (forever || remaining > 0) sendHelper('DISABLE').catch(() => {})
  }
  powerMonitor.on('resume', reassert)
  powerMonitor.on('unlock-screen', reassert)
  powerListeners = reassert
  logError('Started power monitor (event-driven)')
}

function stopPowerMonitor() {
  if (!powerListeners) return
  powerMonitor.removeListener('resume', powerListeners)
  powerMonitor.removeListener('unlock-screen', powerListeners)
  powerListeners = null
  logError('Stopped power monitor')
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

    // LPM is owned by macOS System Settings — we don't touch it.
    // (If the user wants cooler/quieter runs, enable LPM in System Settings →
    // Battery; our app just displays its current state in the UI.)

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
  // Cancel any pending critical-battery grace so a manual stop doesn't get
  // followed by a surprise sleep a minute later.
  if (criticalGraceTimer) {
    clearTimeout(criticalGraceTimer)
    criticalGraceTimer = null
  }

  // Stop all monitoring processes
  stopCaffeinate()
  stopPowerMonitor()

  // LPM is owned by macOS — nothing to restore.

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
//
// Rather than sleeping the instant we cross 2% — which gives the user no
// chance to plug in — we first raise a native notification and start a 60s
// grace window. If the charger is connected during that window we cancel and
// keep running; otherwise we restore sleep (and force sleep if enabled).
// The grace window is a toggle; with it off, we fall back to the old
// immediate restore-at-2% behavior.
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

  const critical = !power.onAC && power.percent !== null && power.percent <= 2

  // If we're mid-grace and the user plugged in (or battery recovered), cancel.
  if (criticalGraceTimer && (power.onAC || power.percent > 2)) {
    clearTimeout(criticalGraceTimer)
    criticalGraceTimer = null
    notify('Power restored', 'Charger detected — sleep keep-awake continues.')
    logError('Critical-battery grace cancelled — power restored')
    return
  }

  if (!critical) return
  // Already counting down; the timer will fire the restore.
  if (criticalGraceTimer) return

  const graceOn = loadConfig().sleepGrace !== false // default on

  if (!graceOn) {
    // Legacy: restore immediately.
    await doCriticalRestore()
    return
  }

  notify(
    '🔋 Battery critical — sleeping in 1 minute',
    `Only ${power.percent}% left. Plug in the charger within 60 seconds to keep your Mac awake.`
  )
  logError(`Battery critical (${power.percent}%) — starting 60s grace before restore`)
  criticalGraceTimer = setTimeout(async () => {
    criticalGraceTimer = null
    const p = await getPowerSource().catch(() => null)
    if (p && (p.onAC || (p.percent !== null && p.percent > 2))) {
      notify('Power restored', 'Charger detected in time — staying awake.')
      logError('Grace expired but power restored — staying awake')
      return
    }
    await doCriticalRestore()
  }, 60000)
}

// Actually restore sleep at critical battery, plus optional force sleep.
async function doCriticalRestore() {
  logError('Battery critical — restoring sleep to preserve session')
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

// Fire a system notification (best-effort; no-op if not supported/granted).
function notify(title, body) {
  try {
    if (!Notification.isSupported()) return
    new Notification({ title, body, silent: false }).show()
  } catch (e) {
    logError('notify failed:', e.message)
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

// "Installed" means the files launchd needs are on disk at the right version.
// A momentarily unresponsive socket is a separate, recoverable condition and
// must not be reported as "not installed" — that is what made the app ask to
// install the helper again on every launch.
function helperIsInstalled() {
  try {
    if (!fs.existsSync(HELPER_BIN) || !fs.existsSync(HELPER_PLIST) || !fs.existsSync(HELPER_VERSION_FILE)) return false
    return fs.readFileSync(HELPER_VERSION_FILE, 'utf8').trim() === HELPER_VERSION
  } catch {
    return false
  }
}

ipcMain.handle('status', async () => {
  try {
    const helperInstalled = helperIsInstalled()

    // Get pmset status via helper
    const result = await sendHelper('STATUS')
    const disabled = result.status === 1
    const lowPowerStatus = await getLowPowerStatus()
    const power = await getPowerSource()
    const cfg = loadConfig()
    const storage = checkStorage()
    return {
      helperInstalled,
      disabled,
      remaining: forever ? -1 : remaining,
      elapsed: totalDuration - remaining,
      lowPowerMode: lowPowerStatus === 1,
      batteryProtect: cfg.batteryProtect !== false, // default on
      sleepGrace: cfg.sleepGrace !== false, // default on
      forceSleep: cfg.forceSleep === true, // default off
      isAwake: cfg.isAwake === true,
      onAC: power.onAC,
      batteryPercent: power.percent,
      storage,
      nuclearReady: cfg.nuclearSudoInstalled === true,
      windowRestored: cfg.restoreWindow !== false, // default on
    }
  } catch {
    return { helperInstalled: helperIsInstalled(), disabled: false, remaining: 0 }
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

ipcMain.handle('set-battery-grace', async (_, enabled) => {
  try {
    const cfg = loadConfig()
    cfg.sleepGrace = enabled === true
    saveConfig(cfg)
    return { ok: true, enabled: cfg.sleepGrace }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('set-restore-window', async (_, enabled) => {
  try {
    const cfg = loadConfig()
    cfg.restoreWindow = enabled === true
    if (!cfg.restoreWindow) delete cfg.windowBounds
    saveConfig(cfg)
    return { ok: true, enabled: cfg.restoreWindow }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Let the renderer know whether Nuclear still needs its one-time password,
// so it can word the confirm dialog accordingly (first press vs. silent).
ipcMain.handle('nuclear-ready', async () => {
  if (loadConfig().nuclearSudoInstalled === true && await probeNuclearSudo()) return { ready: true }
  return { ready: await probeNuclearSudo() }
})

// Pre-flight: make sure passwordless shutdown is installed BEFORE the nuclear
// sequence runs, so the one-time admin prompt surfaces first (not after the
// countdown). The nuclear handler calls this too; this lets the renderer show
// the prompt while its own confirm dialog is still up.
ipcMain.handle('ensure-nuclear-sudo', async () => {
  if (await probeNuclearSudo()) return { ok: true }
  const inst = await installNuclearSudo()
  return inst
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
let cleanupPromise = null
async function doCleanup() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = doCleanupOnce().finally(() => {
    // Startup crash-recovery also cleans up; a session started afterwards must
    // still get a real cleanup on quit, so only hold the memo while exiting.
    if (!quitting) cleanupPromise = null
  })
  return cleanupPromise
}

// Persist window geometry before tearing anything down; the debounced save in
// createWindow() would otherwise be dropped by the exit.
function flushWindowBounds() {
  try {
    if (!win || win.isDestroyed() || win.isMaximized()) return
    const cfg = loadConfig()
    if (cfg.restoreWindow === false) return
    cfg.windowBounds = win.getBounds()
    saveConfig(cfg)
  } catch {}
}

async function doCleanupOnce() {
  logError('Running cleanup before quit')
  flushWindowBounds()
  // Never leave someone's app frozen because we exited.
  const thawed = mem.thawAll()
  if (thawed.thawed) logError(`thawed ${thawed.thawed} frozen app(s) on quit`)
  stopCaffeinate()
  stopPowerMonitor()
  clearInterval(restoreTimer)
  restoreTimer = null

  // LPM is owned by macOS — nothing to restore.

  let cleanupTimeout
  try {
    await Promise.race([
      sendHelper('ENABLE'),
      new Promise((_, reject) => {
        cleanupTimeout = setTimeout(() => reject(new Error('cleanup timed out')), 2000)
      })
    ])
  } catch (e) {
    logError('Failed to re-enable sleep during cleanup:', e.message)
  } finally {
    clearTimeout(cleanupTimeout)
  }
  saveConfig({ ...loadConfig(), isAwake: false })
}

// ── Storage health & cleanup suggestions ──
// `df` is synchronous and blocks the main process, and the UI asks for status
// every 30s even though free space moves slowly. Cache it.
let storageCache = null
let storageCacheAt = 0
const STORAGE_TTL_MS = 5 * 60 * 1000

function checkStorage() {
  const now = Date.now()
  if (storageCache && now - storageCacheAt < STORAGE_TTL_MS) return storageCache
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
    storageCache = { freeBytes: free, totalBytes: total, usedBytes: used, memoryBytes: mem, warning }
    storageCacheAt = now
    return storageCache
  } catch (e) {
    return { freeBytes: 0, totalBytes: 0, memoryBytes: 0, warning: null }
  }
}

// Scan well-known large directories and return their sizes. Read-only — we
// never delete anything; the user clears them manually with the suggestions.
//
// This used to run `du -sh` through execSync, one directory at a time, with an
// 8s timeout each. Twelve paths could block the main process for a minute and a
// half: the window stopped repainting, the timer stopped ticking, and the panel
// sat on "Scanning…". Now it runs a few `du` processes in parallel, never
// blocks the event loop, streams each result as it lands, and caches the scan.
const CLEANUP_CANDIDATES = [
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
const CLEANUP_TTL_MS = 60 * 1000

let cleanupScan = null
let cleanupCache = null
let cleanupCacheAt = 0

function fmtKB(kb) {
  if (kb >= 1024 * 1024) return (kb / 1024 / 1024).toFixed(1) + ' GB'
  if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB'
  return kb + ' KB'
}

function duKB(dir) {
  return new Promise((resolve) => {
    execFile('du', ['-sk', dir], { timeout: 8000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) { resolve(null); return }
      const kb = parseInt(String(stdout).trim().split(/\s+/)[0], 10)
      resolve(Number.isFinite(kb) ? kb : null)
    })
  })
}

// onItem fires for every directory as soon as its size is known, so the panel
// fills in progressively instead of waiting for the slowest path.
function getCleanupSuggestions(onItem) {
  const now = Date.now()
  if (cleanupCache && now - cleanupCacheAt < CLEANUP_TTL_MS) {
    if (onItem) cleanupCache.forEach(onItem)
    return Promise.resolve(cleanupCache)
  }
  if (cleanupScan) return cleanupScan

  const home = require('os').homedir()
  const targets = CLEANUP_CANDIDATES
    .map(c => ({ name: c.name, path: c.path.replace(/^~/, home) }))
    .filter(c => { try { return fs.existsSync(c.path) } catch { return false } })

  const items = []
  const queue = targets.slice()
  const CONCURRENCY = 4

  async function worker() {
    for (;;) {
      const t = queue.shift()
      if (!t) return
      const kb = await duKB(t.path)
      if (!kb) continue
      const item = { name: t.name, path: t.path, kb, size: fmtKB(kb) }
      items.push(item)
      if (onItem) onItem(item)
    }
  }

  cleanupScan = Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker)
  ).then(() => {
    items.sort((a, b) => b.kb - a.kb)
    cleanupCache = items
    cleanupCacheAt = Date.now()
    return items
  }).finally(() => { cleanupScan = null })

  return cleanupScan
}

ipcMain.handle('get-cleanup-suggestions', async () => {
  try {
    const items = await getCleanupSuggestions((item) => {
      if (win && !win.isDestroyed()) win.webContents.send('cleanup-item', item)
    })
    return { ok: true, items }
  } catch (e) {
    return { ok: false, error: e.message, items: [] }
  }
})

ipcMain.handle('open-path', (_, p) => {
  try {
    // execFile, not exec: the path comes from the renderer and must never
    // reach a shell.
    execFile('open', [String(p)])
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

// Passwordless shutdown is installed once (a single admin prompt) so every
// later Nuclear press runs silently. Detect without executing anything:
// `sudo -n -l /sbin/shutdown` exits 0 iff the rule is already in place.
function probeNuclearSudo() {
  return new Promise((resolve) => {
    exec('sudo -n -l /sbin/shutdown', (err) => resolve(!err))
  })
}

// One-time setup: ask for the admin password ONCE, then drop a NOPASSWD rule
// for /sbin/shutdown into its own sudoers.d file. visudo validates before we
// install so a malformed line can never brick sudo.
function installNuclearSudo() {
  const user = require('os').userInfo().username
  const line = `${user} ALL=(ALL) NOPASSWD: /sbin/shutdown`
  // Write to a temp file, validate, then move into place — never a partial edit.
  const cmd =
    `printf '%s\\n' '${line}' > /tmp/mca-shutdown.sudo && ` +
    `chmod 0440 /tmp/mca-shutdown.sudo && chown root:wheel /tmp/mca-shutdown.sudo && ` +
    `visudo -cf /tmp/mca-shutdown.sudo && ` +
    `install -m 0440 -o root -g wheel /tmp/mca-shutdown.sudo ${SHUTDOWN_SUDOERS}`
  return new Promise((resolve) => {
    exec(
      `osascript -e ${JSON.stringify(`do shell script ${JSON.stringify(cmd)} with administrator privileges`)}`,
      (err) => {
        if (err) {
          logError('installNuclearSudo failed:', err.message)
          resolve({ ok: false, error: err.message })
        } else {
          saveConfig({ ...loadConfig(), nuclearSudoInstalled: true })
          resolve({ ok: true })
        }
      }
    )
  })
}

// mode: 'shutdown' → power off; 'restart' → reboot
async function runNuclear(mode) {
  // A frozen process cannot receive the graceful SIGTERM — the signal just
  // queues until it continues, so the app would be skipped and then hard-killed
  // at the 5s mark, silently losing its unsaved-work prompt. Thaw first.
  const thawed = mem.thawAll()
  if (thawed.thawed) logError(`NUCLEAR: thawed ${thawed.thawed} frozen app(s) first`)
  // The final command runs via passwordless sudo (installed once by
  // ensureNuclearReady). `-h` halts, `-r` reboots; `now` is immediate.
  const finalCmd = mode === 'shutdown' ? 'sudo -n /sbin/shutdown -h now' : 'sudo -n /sbin/shutdown -r now'
  // Phase 1 — graceful/force quit of every user GUI app, run as the user
  // (killing our own processes needs no privileges). We exclude system
  // processes by binary path prefix and our own app; everything else is a
  // user app and gets quit then force-quit. The shut down / reboot is issued
  // separately via passwordless sudo.
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
# Trigger shutdown/reboot via passwordless sudo (one-time rule, no prompt).
${finalCmd}
`
  const scriptPath = '/tmp/mca-nuclear.sh'
  fs.writeFileSync(scriptPath, script, { mode: 0o755 })
  const step = await execScriptFile(scriptPath)
  return step
}

ipcMain.handle('nuclear', async (_, mode) => {
  try {
    // Make sure passwordless shutdown is set up — shows the admin prompt the
    // very first time only. If the user cancels, abort cleanly (don't nuke).
    if (!(await probeNuclearSudo())) {
      const inst = await installNuclearSudo()
      if (!inst.ok) {
        return { ok: false, error: 'Passwordless shutdown not enabled — try again and enter your password once.' }
      }
    }
    const action = mode === 'shutdown' ? 'shutting down' : 'rebooting'
    logError(`NUCLEAR: quitting all apps and ${action}`)
    const result = await runNuclear(mode)
    return result.ok ? { ok: true } : { ok: false, error: result.stderr }
  } catch (e) {
    logError('nuclear failed:', e.message)
    return { ok: false, error: e.message }
  }
})

// ── Memory panel: per-app footprint + freeze ──
// collect() costs ~350ms. If the renderer refreshes on a timer while a call is
// still in flight, requests would pile up, so concurrent callers share one
// snapshot instead of each spawning their own ps/probe pair.
let memInFlight = null
// The panel already renders a snapshot every 10s. Freezing used to take a
// second full collect() of its own, so a click could wait on two overlapping
// process sweeps. Reuse the last one when it is recent enough.
let memLastApps = null
let memLastAt = 0
const MEM_SNAPSHOT_TTL_MS = 15 * 1000

function memCollect() {
  if (memInFlight) return memInFlight
  memInFlight = mem.collect()
    .then((snap) => {
      memLastApps = snap.apps
      memLastAt = Date.now()
      return snap
    })
    .finally(() => { memInFlight = null })
  return memInFlight
}

function memRecentApps() {
  return memLastApps && Date.now() - memLastAt < MEM_SNAPSHOT_TTL_MS ? memLastApps : null
}

ipcMain.handle('mem-list', async () => {
  try {
    const { apps, system } = await memCollect()
    return { ok: true, apps, system, frozen: mem.frozenNames() }
  } catch (e) {
    logError('mem-list failed:', e.message)
    return { ok: false, error: e.message, apps: [], system: {} }
  }
})

ipcMain.handle('mem-freeze', async (_e, name) => {
  const r = await mem.freeze(String(name), memRecentApps())
  updateTrayMenu()
  return r
})

ipcMain.handle('mem-thaw', async (_e, name) => {
  const r = await mem.thaw(String(name), memRecentApps())
  updateTrayMenu()
  return r
})

ipcMain.handle('mem-thaw-all', async () => {
  const r = mem.thawAll()
  updateTrayMenu()
  return r
})

ipcMain.handle('mem-purge', async () => {
  const r = await mem.purgeCaches()
  logError('purge caches:', JSON.stringify(r))
  return r
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
  // Frozen apps are reachable from the tray even with the window closed —
  // the one situation where being unable to thaw would be worst.
  const frozen = mem.frozenNames()
  if (frozen.length) {
    items.push({ label: `Frozen: ${frozen.join(', ')}`, enabled: false })
    items.push({
      label: `Thaw all (${frozen.length})`,
      click: () => { mem.thawAll(); updateTrayMenu(); if (win && !win.isDestroyed()) win.webContents.send('mem-refresh') },
    })
  }
  if (!cfg.isPro) {
    items.push({ label: 'Upgrade to Pro', click: () => shell.openExternal(STRIPE_LIFETIME_URL) })
  }
  items.push({ type: 'separator' })
  items.push({
    label: 'Quit',
    click: () => {
      tray = null
      quitApp()
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
  const cfg = loadConfig()
  const bounds = (cfg.restoreWindow !== false && cfg.windowBounds) ? cfg.windowBounds : null

  win = new BrowserWindow({
    width: bounds ? bounds.width : 740,
    height: bounds ? bounds.height : 740,
    x: bounds ? bounds.x : undefined,
    y: bounds ? bounds.y : undefined,
    resizable: true,
    maximizable: true,
    minWidth: 600,
    // Worst-case content (non-Pro + upgrade banner + battery warning) is ~720px.
    // minHeight must be ≥ that so shrinking can never push a button below the
    // fold — the window only gets bigger from here.
    minHeight: 740,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    // 'active' kept the blur (and its GPU work) running even when the window
    // was hidden to the tray. Follow the window instead.
    visualEffectState: 'followWindow',
    backgroundColor: '#0d1b2a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false,
      backgroundThrottling: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  win.loadFile('index.html')

  // Persist size/position whenever it settles, but only while the "restore
  // window" preference is on. Debounced so a drag doesn't hammer the config.
  let saveTimer = null
  const scheduleSave = () => {
    if (loadConfig().restoreWindow === false) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMaximized()) return
      try {
        const b = win.getBounds()
        const c = loadConfig()
        c.windowBounds = b
        saveConfig(c)
      } catch {}
    }, 400)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)

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
// One exit path for the tray item, Cmd+Q, and a system quit request.
// Cleanup is best-effort: a wedged helper must never keep the app alive, so
// there is a hard deadline after which we exit unconditionally.
let quitting = false

function quitApp() {
  if (quitting) return
  quitting = true
  const watchdog = setTimeout(() => {
    logError('Quit watchdog fired — forcing exit')
    app.exit(0)
  }, 5000)
  watchdog.unref()
  doCleanup()
    .catch(e => logError('Cleanup failed:', e.message))
    .finally(() => {
      clearTimeout(watchdog)
      app.exit(0)
    })
}

app.whenReady().then(async () => {
  mem.init(app.getPath('userData'))
  // Anything still recorded as frozen at startup is from a previous run that
  // died without cleaning up — those apps are stuck stopped right now, so
  // thawing them here is the recovery path.
  const stale = mem.thawAll()
  if (stale.thawed) logError(`thawed ${stale.thawed} app(s) frozen by a previous run`)
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
      // LPM is owned by macOS — don't touch it on session resume.
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
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitApp()
})

app.on('will-quit', () => {
  console.log('[MCA] Quit complete')
})
