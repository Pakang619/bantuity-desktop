const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bantuity', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  openProduct: (productId, path) => ipcRenderer.invoke('product:open', productId, path),
  getConnectorStatus: () => ipcRenderer.invoke('connector:status'),
  startConnector: () => ipcRenderer.invoke('connector:start'),
  stopConnector: () => ipcRenderer.invoke('connector:stop'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  setLayout: (layout) => ipcRenderer.invoke('layout:set', layout),
  previewLayout: (layout) => ipcRenderer.invoke('layout:preview', layout),
  getLayout: () => ipcRenderer.invoke('layout:get'),
  detachProduct: (productId) => ipcRenderer.invoke('window:detach', productId),
  reloadContent: () => ipcRenderer.invoke('content:reload'),
  onProductChanged: (cb) => {
    const handler = (_e, productId) => cb(productId)
    ipcRenderer.on('product:changed', handler)
    return () => ipcRenderer.removeListener('product:changed', handler)
  },
  onLayoutChanged: (cb) => {
    const handler = (_e, layout) => cb(layout)
    ipcRenderer.on('layout:changed', handler)
    return () => ipcRenderer.removeListener('layout:changed', handler)
  },
  onConnectorChanged: (cb) => {
    const handler = (_e, status) => cb(status)
    ipcRenderer.on('connector:changed', handler)
    return () => ipcRenderer.removeListener('connector:changed', handler)
  },
})
