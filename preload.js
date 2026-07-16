const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('sleep', {
  disable: (s) => ipcRenderer.invoke('disable-sleep', s),
  enable: () => ipcRenderer.invoke('enable-sleep'),
  status: () => ipcRenderer.invoke('get-status'),
  onTick: (fn) => ipcRenderer.on('tick', (_, n) => fn(n)),
  onRestored: (fn) => ipcRenderer.on('restored', () => fn()),
})
