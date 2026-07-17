const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('lidajar', {
  start: (secs) => ipcRenderer.invoke('start', secs),
  stop: () => ipcRenderer.invoke('stop'),
  status: () => ipcRenderer.invoke('status'),
  installHelper: () => ipcRenderer.invoke('install-helper'),
  isPro: () => ipcRenderer.invoke('is-pro'),
  upgrade: () => ipcRenderer.invoke('upgrade'),
  onTick: (fn) => ipcRenderer.on('tick', (_, n) => fn(n)),
  onRestored: (fn) => ipcRenderer.on('restored', () => fn()),
  onHelperNeeded: (fn) => ipcRenderer.on('helper-needed', () => fn()),
  onProStatus: (fn) => ipcRenderer.on('pro-status', (_, p) => fn(p)),
})
