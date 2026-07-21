const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  shell,
  Menu,
  Tray,
  nativeImage,
} = require('electron')
const path = require('path')
const { loadSettings, saveSettings, findConnectorInstall } = require('./config')
const connector = require('./connector-manager')
const { createStaticServer, appsRoot } = require('./static-server')

let mainWindow = null
let contentView = null
let tray = null
let settings = null
let currentProduct = 'plotex'
let localServers = { plotex: null, copilot: null }

const SHELL_WIDTH = 280
const PORTS = { plotex: 39201, copilot: 39202 }

function productBase(productId) {
  // Prefer offline bundled UI; fall back to online URLs from settings
  const local = localServers[productId]
  if (local?.origin) return local.origin
  return settings.products[productId]?.url || 'about:blank'
}

function productUrl(productId, preferWorkspace) {
  const base = productBase(productId).replace(/\/$/, '')
  const online = settings.products[productId]
  if (preferWorkspace && settings.openWorkspaceOnLaunch) {
    if (localServers[productId]) return `${base}/workspace/`
    return online.workspaceUrl || `${base}/workspace`
  }
  if (localServers[productId]) return `${base}/`
  return online.url || base
}

async function startLocalApps() {
  const root = appsRoot()
  const plotexDir = path.join(root, 'plotex')
  const copilotDir = path.join(root, 'copilot')
  try {
    if (require('fs').existsSync(path.join(plotexDir, 'index.html'))) {
      localServers.plotex = await createStaticServer(plotexDir, PORTS.plotex)
      console.log('[bantuity] offline Plotex UI →', localServers.plotex.origin)
    } else {
      console.warn('[bantuity] no bundled Plotex UI at', plotexDir)
    }
  } catch (e) {
    console.warn('[bantuity] Plotex static server failed:', e.message)
  }
  try {
    if (require('fs').existsSync(path.join(copilotDir, 'index.html'))) {
      localServers.copilot = await createStaticServer(copilotDir, PORTS.copilot)
      console.log('[bantuity] offline Copilot UI →', localServers.copilot.origin)
    } else {
      console.warn('[bantuity] no bundled Copilot UI at', copilotDir)
    }
  } catch (e) {
    console.warn('[bantuity] Copilot static server failed:', e.message)
  }
}

function createContentView() {
  contentView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.setBrowserView(contentView)
  layoutViews()
  contentView.webContents.setWindowOpenHandler(({ url }) => {
    // Keep same-origin app routes in the shell; external links in browser
    const localOrigins = [localServers.plotex?.origin, localServers.copilot?.origin].filter(Boolean)
    if (localOrigins.some((o) => url.startsWith(o))) {
      contentView.webContents.loadURL(url)
      return { action: 'deny' }
    }
    if (
      url.startsWith('https://plotex.bantuity.com') ||
      url.startsWith('https://copilot.bantuity.com')
    ) {
      contentView.webContents.loadURL(url)
      return { action: 'deny' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

function layoutViews() {
  if (!mainWindow || !contentView) return
  const [width, height] = mainWindow.getContentSize()
  contentView.setBounds({
    x: SHELL_WIDTH,
    y: 0,
    width: Math.max(400, width - SHELL_WIDTH),
    height,
  })
  contentView.setAutoResize({ width: true, height: true })
}

function loadProduct(productId, opts = {}) {
  currentProduct = productId
  settings.lastProduct = productId
  saveSettings(settings)
  const url = productUrl(productId, opts.workspace !== false)
  if (contentView) {
    contentView.webContents.loadURL(url)
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('product:changed', productId)
  }
  const mode = localServers[productId] ? 'offline UI' : 'online'
  mainWindow?.setTitle(
    `Bantuity — ${settings.products[productId]?.name || productId} (${mode})`
  )
}

function createWindow() {
  settings = loadSettings()
  if (!settings.connectorPath) {
    settings.connectorPath = findConnectorInstall()
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#fbfffe',
    title: 'Bantuity',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'shell.html'))
  mainWindow.once('ready-to-show', async () => {
    mainWindow.show()
    await startLocalApps()
    createContentView()
    loadProduct(settings.lastProduct || 'plotex')
    connector.startConnector(settings.connectorPath || undefined)
  })

  mainWindow.on('resize', layoutViews)
  mainWindow.on('closed', () => {
    contentView = null
    mainWindow = null
  })

  const template = [
    {
      label: 'Bantuity',
      submenu: [
        {
          label: 'Plotex',
          accelerator: 'CmdOrCtrl+1',
          click: () => loadProduct('plotex'),
        },
        {
          label: 'Copilot',
          accelerator: 'CmdOrCtrl+2',
          click: () => loadProduct('copilot'),
        },
        { type: 'separator' },
        {
          label: 'Reload page',
          accelerator: 'CmdOrCtrl+R',
          click: () => contentView?.webContents.reload(),
        },
        {
          label: 'Open online version in browser',
          click: () => {
            const p = settings.products[currentProduct]
            if (p?.url) shell.openExternal(p.url)
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Bantuity' },
      ],
    },
    {
      label: 'Stata',
      submenu: [
        {
          label: 'Start connector',
          click: () => connector.startConnector(settings.connectorPath || undefined),
        },
        {
          label: 'Stop connector',
          click: () => connector.stopConnector(),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createTray() {
  try {
    const img = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVQ4T2NkYGD4z0ABYBw1gGE0DBhGwwDGweACAJ0fAx36N9qYAAAAAElFTkSuQmCC'
    )
    tray = new Tray(img)
    tray.setToolTip('Bantuity')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show Bantuity', click: () => mainWindow?.show() },
        {
          label: 'Plotex',
          click: () => {
            mainWindow?.show()
            loadProduct('plotex')
          },
        },
        {
          label: 'Copilot',
          click: () => {
            mainWindow?.show()
            loadProduct('copilot')
          },
        },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ])
    )
    tray.on('click', () => mainWindow?.show())
  } catch {
    /* tray optional */
  }
}

ipcMain.handle('settings:get', () => {
  settings = loadSettings()
  return {
    settings,
    connector: connector.getStatus(),
    currentProduct,
    offline: {
      plotex: !!localServers.plotex,
      copilot: !!localServers.copilot,
    },
  }
})

ipcMain.handle('settings:save', (_e, partial) => {
  settings = { ...loadSettings(), ...partial }
  if (partial?.products) {
    settings.products = {
      ...loadSettings().products,
      ...partial.products,
    }
  }
  saveSettings(settings)
  return settings
})

ipcMain.handle('product:open', (_e, productId, subpath) => {
  if (subpath === 'home') {
    currentProduct = productId
    settings.lastProduct = productId
    saveSettings(settings)
    const url = productUrl(productId, false)
    contentView?.webContents.loadURL(url)
    mainWindow?.webContents.send('product:changed', productId)
    return true
  }
  loadProduct(productId, { workspace: true })
  return true
})

ipcMain.handle('connector:status', () => connector.getStatus())
ipcMain.handle('connector:start', () =>
  connector.startConnector(settings?.connectorPath || undefined)
)
ipcMain.handle('connector:stop', () => connector.stopConnector())
ipcMain.handle('shell:openExternal', (_e, url) => {
  shell.openExternal(url)
  return true
})

app.whenReady().then(() => {
  createWindow()
  createTray()
})

app.on('window-all-closed', async () => {
  connector.stopConnector()
  try {
    await localServers.plotex?.close?.()
    await localServers.copilot?.close?.()
  } catch {
    /* ignore */
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  connector.stopConnector()
})
