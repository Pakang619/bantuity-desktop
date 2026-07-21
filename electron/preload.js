const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bantuity', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  openProduct: (productId, path) => ipcRenderer.invoke('product:open', productId, path),
  getConnectorStatus: () => ipcRenderer.invoke('connector:status'),
  startConnector: () => ipcRenderer.invoke('connector:start'),
  stopConnector: () => ipcRenderer.invoke('connector:stop'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onProductChanged: (cb) => {
    const handler = (_e, productId) => cb(productId)
    ipcRenderer.on('product:changed', handler)
    return () => ipcRenderer.removeListener('product:changed', handler)
  },
})
