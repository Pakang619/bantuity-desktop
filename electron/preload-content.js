/**
 * Preload for product BrowserViews (Plotex / Copilot pages).
 * Lets offline UIs switch products and open handoffs in-app.
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bantuityDesktop', {
  active: true,
  openProduct: (productId, subpath) =>
    ipcRenderer.invoke('product:open', productId, subpath || 'workspace'),
  /** pathAndQuery e.g. "/workspace/?from=copilot&handoff=TOKEN" */
  openProductPath: (productId, pathAndQuery) =>
    ipcRenderer.invoke('product:openPath', productId, pathAndQuery),
  getConnectorStatus: () => ipcRenderer.invoke('connector:status'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
})

// Keep legacy bridge flag used by web UIs
try {
  // Will be overwritten by injectDesktopBridge; set a default
  contextBridge.exposeInMainWorld('__BANTUITY_DESKTOP_API__', true)
} catch {
  /* ignore */
}
