const { contextBridge, ipcRenderer, webFrame } = require('electron')

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get application configuration
  getConfig: () => ipcRenderer.invoke('get-config'),
  
  // Initialize slideshow - called when renderer is ready
  initializeSlideshow: () => ipcRenderer.invoke('initialize-slideshow'),
  
  // Clear web frame cache (for memory management)
  clearCache: () => webFrame.clearCache()
})