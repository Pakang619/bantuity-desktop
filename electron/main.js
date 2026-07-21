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
/** @type {Map<string, BrowserWindow>} */
const detachedWindows = new Map()

const ACTIVITY = 52
const PORTS = { plotex: 39201, copilot: 39202 }
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 440
const BOTTOM_MIN = 100
const BOTTOM_MAX = 360

function appIconPath() {
  const ico = path.join(__dirname, '..', 'assets', 'icon.ico')
  const png = path.join(__dirname, '..', 'assets', 'icon.png')
  if (require('fs').existsSync(ico)) return ico
  if (require('fs').existsSync(png)) return png
  return undefined
}

function loadAppIcon() {
  // Prefer high-res PNG for runtime window chrome; ICO for path fallback
  const candidates = [
    path.join(__dirname, '..', 'assets', 'icon.png'),
    path.join(__dirname, '..', 'assets', 'icon-256.png'),
    path.join(__dirname, '..', 'assets', 'bantuity_mark.png'),
    path.join(__dirname, '..', 'assets', 'icon.ico'),
  ]
  for (const p of candidates) {
    if (!require('fs').existsSync(p)) continue
    try {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    } catch {
      /* try next */
    }
  }
  return null
}

function getLayout() {
  const layout = { ...(settings?.layout || {}) }
  return {
    sidebarOpen: layout.sidebarOpen !== false,
    sidebarWidth: clamp(Number(layout.sidebarWidth) || 280, SIDEBAR_MIN, SIDEBAR_MAX),
    bottomOpen: layout.bottomOpen !== false,
    bottomHeight: clamp(Number(layout.bottomHeight) || 168, BOTTOM_MIN, BOTTOM_MAX),
    activityBar: layout.activityBar !== false,
  }
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function productBase(productId) {
  const local = localServers[productId]
  if (local?.origin) return local.origin
  return settings.products[productId]?.url || 'about:blank'
}

function productUrl(productId, preferWorkspace, subpath) {
  const base = productBase(productId).replace(/\/$/, '')
  const online = settings.products[productId]
  // Explicit routes: home | workspace | mcp | …
  if (subpath && subpath !== 'home' && subpath !== 'workspace') {
    const slug = String(subpath).replace(/^\/+|\/+$/g, '')
    if (localServers[productId]) return `${base}/${slug}/`
    const root = (online.url || base).replace(/\/$/, '')
    return `${root}/${slug}`
  }
  if (preferWorkspace && settings.openWorkspaceOnLaunch) {
    if (localServers[productId]) return `${base}/workspace/`
    return online.workspaceUrl || `${base}/workspace`
  }
  if (localServers[productId]) return `${base}/`
  return online.url || base
}

async function startLocalApps() {
  const root = appsRoot()
  for (const [id, dirName] of [
    ['plotex', 'plotex'],
    ['copilot', 'copilot'],
  ]) {
    const dir = path.join(root, dirName)
    try {
      if (require('fs').existsSync(path.join(dir, 'index.html'))) {
        localServers[id] = await createStaticServer(dir, PORTS[id])
        console.log(`[bantuity] offline ${id} →`, localServers[id].origin)
      }
    } catch (e) {
      console.warn(`[bantuity] ${id} static server failed:`, e.message)
    }
  }
}

function injectDesktopBridge(view = contentView) {
  if (!view) return
  const st = connector.getStatus()
  const payload = JSON.stringify({
    active: true,
    connectorRunning: !!st.running,
    message: st.message || '',
  })
  view.webContents
    .executeJavaScript(
      `window.__BANTUITY_DESKTOP__ = ${payload}; window.dispatchEvent(new Event('bantuity-desktop')); true`
    )
    .catch(() => {})
}

function shellChromeWidth() {
  const L = getLayout()
  let w = L.activityBar ? ACTIVITY : 0
  if (L.sidebarOpen) w += L.sidebarWidth
  return w
}

function shellChromeBottom() {
  const L = getLayout()
  return L.bottomOpen ? L.bottomHeight : 0
}

let layoutRaf = null
let lastBoundsKey = ''

function layoutViews() {
  // Coalesce rapid drag updates to one bounds write per frame
  if (layoutRaf != null) return
  layoutRaf = setTimeout(() => {
    layoutRaf = null
    layoutViewsNow()
  }, 0)
}

function layoutViewsNow() {
  if (!mainWindow || !contentView || mainWindow.isDestroyed()) return
  const [width, height] = mainWindow.getContentSize()
  const left = shellChromeWidth()
  const bottom = shellChromeBottom()
  const bounds = {
    x: left,
    y: 0,
    width: Math.max(320, width - left),
    height: Math.max(200, height - bottom),
  }
  const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
  if (key === lastBoundsKey) return
  lastBoundsKey = key
  // Manual bounds only — autoResize fights live chrome resizing and feels choppy
  contentView.setAutoResize({ width: false, height: false, horizontal: false, vertical: false })
  contentView.setBounds(bounds)
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
    const localOrigins = [localServers.plotex?.origin, localServers.copilot?.origin].filter(
      Boolean
    )
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
  contentView.webContents.on('did-finish-load', () => injectDesktopBridge())
  setInterval(() => {
    injectDesktopBridge()
    for (const win of detachedWindows.values()) {
      if (!win.isDestroyed() && win.webContents) {
        // detached windows load product URL directly as BrowserWindow
      }
    }
  }, 2500)
}

function trackTab(productId) {
  const tabs = Array.isArray(settings.openTabs) ? [...settings.openTabs] : []
  if (!tabs.includes(productId)) tabs.push(productId)
  settings.openTabs = tabs
  saveSettings(settings)
}

function loadProduct(productId, opts = {}) {
  currentProduct = productId
  settings.lastProduct = productId
  trackTab(productId)
  saveSettings(settings)
  const preferWs = opts.workspace !== false && !opts.subpath
  const url = productUrl(productId, preferWs, opts.subpath)
  if (contentView) contentView.webContents.loadURL(url)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('product:changed', productId)
  }
  const mode = localServers[productId] ? 'offline' : 'online'
  mainWindow?.setTitle(
    `Bantuity — ${settings.products[productId]?.name || productId} · ${mode}`
  )
}

function openDetachedWindow(productId) {
  if (detachedWindows.has(productId)) {
    const existing = detachedWindows.get(productId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return existing
    }
    detachedWindows.delete(productId)
  }

  const icon = loadAppIcon()
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#fbfffe',
    title: `Bantuity — ${settings.products[productId]?.name || productId}`,
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })
  if (icon) win.setIcon(icon)

  const url = productUrl(productId, true)
  win.loadURL(url)
  win.once('ready-to-show', () => win.show())
  win.webContents.on('did-finish-load', () => {
    const st = connector.getStatus()
    const payload = JSON.stringify({
      active: true,
      connectorRunning: !!st.running,
      message: st.message || '',
    })
    win.webContents
      .executeJavaScript(
        `window.__BANTUITY_DESKTOP__ = ${payload}; window.dispatchEvent(new Event('bantuity-desktop')); true`
      )
      .catch(() => {})
  })
  win.on('closed', () => {
    detachedWindows.delete(productId)
  })
  detachedWindows.set(productId, win)
  trackTab(productId)
  return win
}

function createWindow() {
  settings = loadSettings()
  if (!settings.connectorPath) {
    settings.connectorPath = findConnectorInstall()
  }

  const icon = loadAppIcon()
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#ecefee',
    title: 'Bantuity',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  })
  // Ensure Windows taskbar / title bar use the Bantuity mark (not Electron default)
  if (icon) mainWindow.setIcon(icon)

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'shell.html'))
  mainWindow.once('ready-to-show', async () => {
    if (icon) mainWindow.setIcon(icon)
    mainWindow.show()
    await startLocalApps()
    createContentView()
    loadProduct(settings.lastProduct || 'plotex')
    try {
      await connector.startConnector()
      mainWindow.webContents.send('connector:changed', connector.getStatus())
    } catch (e) {
      console.warn('[bantuity] connector start:', e)
    }
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
        {
          label: 'Open Plotex in new window',
          accelerator: 'CmdOrCtrl+Shift+1',
          click: () => openDetachedWindow('plotex'),
        },
        {
          label: 'Open Copilot in new window',
          accelerator: 'CmdOrCtrl+Shift+2',
          click: () => openDetachedWindow('copilot'),
        },
        { type: 'separator' },
        {
          label: 'Reload workspace',
          accelerator: 'CmdOrCtrl+R',
          click: () => contentView?.webContents.reload(),
        },
        {
          label: 'Toggle sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => {
            const L = getLayout()
            applyLayout({ sidebarOpen: !L.sidebarOpen })
          },
        },
        {
          label: 'Toggle Stata panel',
          accelerator: 'CmdOrCtrl+J',
          click: () => {
            const L = getLayout()
            applyLayout({ bottomOpen: !L.bottomOpen })
          },
        },
        {
          label: 'Open online in browser',
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
          label: 'Start service',
          click: async () => {
            await connector.startConnector(settings.connectorPath || undefined)
            mainWindow?.webContents.send('connector:changed', connector.getStatus())
          },
        },
        {
          label: 'Stop service',
          click: () => {
            connector.stopConnector()
            mainWindow?.webContents.send('connector:changed', connector.getStatus())
          },
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
        { type: 'separator' },
        {
          label: 'Reset layout',
          click: () =>
            applyLayout({
              sidebarOpen: true,
              sidebarWidth: 280,
              bottomOpen: true,
              bottomHeight: 168,
              activityBar: true,
            }),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function applyLayout(partial, { persist = true, notify = true } = {}) {
  if (!settings) settings = loadSettings()
  const next = { ...getLayout(), ...partial }
  next.sidebarWidth = clamp(next.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX)
  next.bottomHeight = clamp(next.bottomHeight, BOTTOM_MIN, BOTTOM_MAX)
  settings.layout = next
  if (persist) saveSettings(settings)
  layoutViews()
  if (notify && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('layout:changed', next)
  }
  return next
}

function createTray() {
  try {
    let img
    const trayPng = path.join(__dirname, '..', 'assets', 'icon-32.png')
    const trayIco = path.join(__dirname, '..', 'assets', 'icon.ico')
    if (require('fs').existsSync(trayPng)) img = nativeImage.createFromPath(trayPng)
    else if (require('fs').existsSync(trayIco)) img = nativeImage.createFromPath(trayIco)
    else img = loadAppIcon()
    if (!img || img.isEmpty()) return
    // Windows tray prefers a small bitmap
    if (img.getSize().width > 32) {
      img = img.resize({ width: 32, height: 32 })
    }
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
    /* optional */
  }
}

ipcMain.handle('settings:get', () => {
  settings = loadSettings()
  return {
    settings,
    connector: connector.getStatus(),
    currentProduct,
    layout: getLayout(),
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
  if (partial?.layout) {
    settings.layout = { ...getLayout(), ...partial.layout }
  }
  saveSettings(settings)
  layoutViews()
  return settings
})

ipcMain.handle('layout:get', () => getLayout())
ipcMain.handle('layout:set', (_e, partial) => applyLayout(partial || {}, { persist: true }))
/** Live drag updates — no disk write */
ipcMain.handle('layout:preview', (_e, partial) =>
  applyLayout(partial || {}, { persist: false, notify: false })
)

ipcMain.handle('product:open', (_e, productId, subpath) => {
  if (subpath === 'home') {
    currentProduct = productId
    settings.lastProduct = productId
    trackTab(productId)
    saveSettings(settings)
    contentView?.webContents.loadURL(productUrl(productId, false))
    mainWindow?.webContents.send('product:changed', productId)
    return true
  }
  if (subpath && subpath !== 'workspace') {
    loadProduct(productId, { workspace: false, subpath })
    return true
  }
  loadProduct(productId, { workspace: true })
  return true
})

ipcMain.handle('window:detach', (_e, productId) => {
  openDetachedWindow(productId || currentProduct)
  return true
})

ipcMain.handle('content:reload', () => {
  contentView?.webContents.reload()
  return true
})

ipcMain.handle('connector:status', () => connector.getStatus())
ipcMain.handle('connector:start', async () => {
  const st = await connector.startConnector()
  mainWindow?.webContents.send('connector:changed', st)
  return st
})
ipcMain.handle('connector:stop', () => {
  const st = connector.stopConnector()
  mainWindow?.webContents.send('connector:changed', st)
  return st
})
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
  for (const win of detachedWindows.values()) {
    try {
      if (!win.isDestroyed()) win.close()
    } catch {
      /* */
    }
  }
})
