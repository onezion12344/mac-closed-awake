const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron')
const { exec } = require('child_process')
const path = require('path')

let win, tray
let restoreTimer = null
let remaining = 0

function createWindow() {
  win = new BrowserWindow({
    width: 400, height: 420,
    resizable: false, maximizable: false,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  })
  win.loadFile('index.html')
  win.on('close', (e) => { if (tray) { e.preventDefault(); win.hide() } })
}

function runPmset(cmd) {
  return new Promise((resolve, reject) => {
    exec(`osascript -e 'do shell script "pmset -a disablesleep ${cmd}" with administrator privileges'`, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.trim())
    })
  })
}

function startTimer(secs) {
  clearInterval(restoreTimer)
  remaining = secs
  restoreTimer = setInterval(() => {
    remaining--
    if (win && !win.isDestroyed()) win.webContents.send('tick', remaining)
    if (remaining <= 0) {
      clearInterval(restoreTimer)
      runPmset('0').catch(() => {})
      if (win && !win.isDestroyed()) win.webContents.send('restored')
    }
  }, 1000)
}

ipcMain.handle('disable-sleep', async (_, secs) => {
  try { await runPmset('1'); startTimer(secs); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('enable-sleep', async () => {
  clearInterval(restoreTimer)
  try { await runPmset('0'); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('get-status', async () => {
  return new Promise(resolve => {
    exec('pmset -g custom', (_, stdout) => {
      const m = stdout.match(/disablesleep\s+(\d)/)
      resolve({ disabled: m ? m[1] === '1' : false, remaining })
    })
  })
})

app.whenReady().then(() => {
  createWindow()
  tray = new Tray(path.join(__dirname, 'icon.png'))
  tray.setToolTip('Sleep Control')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => { win.show(); win.focus() } },
    { label: `Disabled: ${remaining > 0 ? remaining + 's left' : 'no'}`, enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => { tray = null; app.quit() } },
  ]))
})

app.on('window-all-closed', () => {})
