const { contextBridge, ipcRenderer, webFrame } = require('electron')

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  initializeSlideshow: () => ipcRenderer.invoke('initialize-slideshow'),
  clearCache: () => webFrame.clearCache()
})