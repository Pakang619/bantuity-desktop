/* global bantuity */

const SIDE_MIN = 200
const SIDE_MAX = 440
const BOTTOM_MIN = 100
const BOTTOM_MAX = 360
const ACTIVITY = 52

let current = 'plotex'
let layout = {
  sidebarOpen: true,
  sidebarWidth: 280,
  bottomOpen: true,
  bottomHeight: 168,
  activityBar: true,
}
let tabs = ['plotex']
let offline = {}

const appEl = document.getElementById('app')
const sideEl = document.getElementById('side')
const bottomEl = document.getElementById('bottom')

function applyLayoutCss() {
  document.documentElement.style.setProperty('--side-w', `${layout.sidebarWidth}px`)
  document.documentElement.style.setProperty('--bottom-h', `${layout.bottomHeight}px`)
  document.documentElement.style.setProperty(
    '--activity-w',
    layout.activityBar === false ? '0px' : `${ACTIVITY}px`
  )
  appEl.dataset.side = layout.sidebarOpen ? 'open' : 'closed'
  appEl.dataset.bottom = layout.bottomOpen ? 'open' : 'closed'
  document.getElementById('btn-toggle-bottom').textContent = layout.bottomOpen ? '▾' : '▸'
  document.getElementById('act-stata').dataset.active = layout.bottomOpen ? 'true' : 'false'
}

async function persistLayout(partial) {
  layout = { ...layout, ...partial }
  if (layout.sidebarWidth != null) {
    layout.sidebarWidth = Math.max(SIDE_MIN, Math.min(SIDE_MAX, layout.sidebarWidth))
  }
  if (layout.bottomHeight != null) {
    layout.bottomHeight = Math.max(BOTTOM_MIN, Math.min(BOTTOM_MAX, layout.bottomHeight))
  }
  applyLayoutCss()
  await bantuity.setLayout(layout)
}

function highlightProduct(id) {
  current = id
  document.querySelectorAll('.nav-item[data-product]').forEach((btn) => {
    btn.dataset.active = btn.dataset.product === id ? 'true' : 'false'
  })
  document.querySelectorAll('.act-btn[data-product]').forEach((btn) => {
    btn.dataset.active = btn.dataset.product === id ? 'true' : 'false'
  })
  renderTabs()
}

function renderTabs() {
  const row = document.getElementById('tabs-row')
  if (!row) return
  row.innerHTML = ''
  if (!tabs.length) {
    row.innerHTML = '<span class="muted">No open products</span>'
    return
  }
  tabs.forEach((id) => {
    const name = id === 'copilot' ? 'Copilot' : 'Plotex'
    const tab = document.createElement('div')
    tab.className = 'tab'
    tab.draggable = true
    tab.dataset.tab = id
    tab.dataset.active = id === current ? 'true' : 'false'
    tab.innerHTML = `<span>${name}</span><button type="button" class="tab-x" data-close="${id}" title="Close tab">×</button>`
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-x')) return
      openProduct(id)
    })
    tab.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/tab', id)
      e.dataTransfer.effectAllowed = 'move'
      tab.classList.add('dragging')
    })
    tab.addEventListener('dragend', () => tab.classList.remove('dragging'))
    tab.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    })
    tab.addEventListener('drop', (e) => {
      e.preventDefault()
      const from = e.dataTransfer.getData('text/tab')
      const to = id
      if (!from || from === to) return
      const next = tabs.filter((t) => t !== from)
      const idx = next.indexOf(to)
      next.splice(idx, 0, from)
      tabs = next
      bantuity.saveSettings({ openTabs: tabs })
      renderTabs()
    })
    row.appendChild(tab)
  })
  row.querySelectorAll('.tab-x').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      closeTab(btn.dataset.close)
    })
  })
}

function ensureTab(id) {
  if (!tabs.includes(id)) {
    tabs = [...tabs, id]
    bantuity.saveSettings({ openTabs: tabs })
  }
  renderTabs()
}

function closeTab(id) {
  if (tabs.length <= 1) return
  tabs = tabs.filter((t) => t !== id)
  bantuity.saveSettings({ openTabs: tabs })
  if (current === id) {
    openProduct(tabs[tabs.length - 1])
  } else {
    renderTabs()
  }
}

async function openProduct(id, path = 'workspace') {
  ensureTab(id)
  highlightProduct(id)
  await bantuity.openProduct(id, path)
}

function renderConnector(conn) {
  const sets = [
    ['conn-dot', 'conn-text', 'conn-detail'],
    ['float-dot', 'float-text', 'float-detail'],
  ]
  let cls = 'dot'
  let text = 'Stata service stopped'
  let detail =
    'Click Start. Requires Stata 17+ on this PC (Python is set up automatically if needed).'
  if (conn?.provisioning) {
    cls = 'dot busy'
    text = 'Setting up…'
    detail = conn.message || 'Preparing built-in Stata service (one-time).'
  } else if (conn?.running) {
    cls = 'dot on'
    text = 'Stata service running'
    detail =
      conn.message ||
      'Ready for Plotex, Copilot, and MCP (Claude / Cursor / Codex / Grok). Jobs run on local Stata.'
    if (conn.lastLog) detail += ` · ${String(conn.lastLog).slice(0, 100)}`
  } else if (conn?.message) {
    detail = conn.message
  }
  for (const [d, t, det] of sets) {
    const dot = document.getElementById(d)
    const te = document.getElementById(t)
    const de = document.getElementById(det)
    if (dot) dot.className = cls
    if (te) te.textContent = text
    if (de) de.textContent = detail
  }
}

async function refresh() {
  const data = await bantuity.getSettings()
  if (data.layout) layout = { ...layout, ...data.layout }
  applyLayoutCss()
  current = data.currentProduct || data.settings?.lastProduct || 'plotex'
  tabs = Array.isArray(data.settings?.openTabs) ? data.settings.openTabs : [current]
  if (!tabs.includes(current)) tabs.push(current)
  offline = data.offline || {}
  highlightProduct(current)
  renderConnector(data.connector)
  const modeEl = document.getElementById('ui-mode')
  if (modeEl) {
    const both = offline.plotex && offline.copilot
    modeEl.textContent = both ? 'Offline UI · cloud APIs' : 'Online UI mode'
  }
  const metaMode = document.getElementById('meta-mode')
  const metaUi = document.getElementById('meta-ui')
  if (metaMode) metaMode.textContent = data.connector?.running ? 'connected' : 'idle'
  if (metaUi) {
    metaUi.textContent =
      offline.plotex || offline.copilot ? 'bundled offline' : 'online fallback'
  }
}

/** Paint shell chrome every frame; push BrowserView bounds at most once per frame */
function createLiveResizer(onMoveCss) {
  let raf = 0
  let pending = null
  return {
    tick(partial) {
      pending = partial
      onMoveCss(partial)
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const p = pending
        pending = null
        if (p && window.bantuity?.previewLayout) {
          bantuity.previewLayout(p)
        }
      })
    },
    flush(partial) {
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      pending = null
      return partial
    },
  }
}

/* ── Resize: sidebar ───────────────────────────────────────── */
;(function setupSideResize() {
  const handle = document.getElementById('resize-side')
  let startX = 0
  let startW = 0
  let active = false
  const live = createLiveResizer((p) => {
    layout.sidebarWidth = p.sidebarWidth
    applyLayoutCss()
  })

  handle.addEventListener('pointerdown', (e) => {
    if (!layout.sidebarOpen) return
    e.preventDefault()
    active = true
    startX = e.clientX
    startW = layout.sidebarWidth
    handle.classList.add('dragging')
    document.body.classList.add('is-resizing')
    handle.setPointerCapture(e.pointerId)
  })
  handle.addEventListener('pointermove', (e) => {
    if (!active) return
    const next = Math.max(SIDE_MIN, Math.min(SIDE_MAX, startW + (e.clientX - startX)))
    live.tick({ sidebarWidth: next, sidebarOpen: true })
  })
  const end = async () => {
    if (!active) return
    active = false
    handle.classList.remove('dragging')
    document.body.classList.remove('is-resizing')
    const final = live.flush({
      sidebarWidth: layout.sidebarWidth,
      sidebarOpen: true,
    })
    await persistLayout(final)
  }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('dblclick', () => persistLayout({ sidebarOpen: false }))
})()

/* ── Resize: bottom ────────────────────────────────────────── */
;(function setupBottomResize() {
  const handle = document.getElementById('resize-bottom')
  let startY = 0
  let startH = 0
  let active = false
  const live = createLiveResizer((p) => {
    layout.bottomHeight = p.bottomHeight
    applyLayoutCss()
  })

  handle.addEventListener('pointerdown', (e) => {
    if (!layout.bottomOpen) return
    e.preventDefault()
    active = true
    startY = e.clientY
    startH = layout.bottomHeight
    handle.classList.add('dragging')
    document.body.classList.add('is-resizing-h')
    handle.setPointerCapture(e.pointerId)
  })
  handle.addEventListener('pointermove', (e) => {
    if (!active) return
    // Dragging handle up increases bottom panel height
    const next = Math.max(BOTTOM_MIN, Math.min(BOTTOM_MAX, startH - (e.clientY - startY)))
    live.tick({ bottomHeight: next, bottomOpen: true })
  })
  const end = async () => {
    if (!active) return
    active = false
    handle.classList.remove('dragging')
    document.body.classList.remove('is-resizing-h')
    const final = live.flush({
      bottomHeight: layout.bottomHeight,
      bottomOpen: true,
    })
    await persistLayout(final)
  }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('dblclick', () => persistLayout({ bottomOpen: false }))
})()

/* ── Floating Stata panel (draggable + resizable) ──────────── */
;(function setupFloatStata() {
  const win = document.getElementById('float-stata')
  const drag = document.getElementById('float-stata-drag')
  const resize = document.getElementById('float-stata-resize')
  let pos = { x: 120, y: 120 }
  let size = { w: 320, h: 220 }

  function place() {
    win.style.left = `${pos.x}px`
    win.style.top = `${pos.y}px`
    win.style.width = `${size.w}px`
    win.style.height = `${size.h}px`
  }

  function showFloat() {
    win.hidden = false
    place()
    persistLayout({ bottomOpen: false })
  }

  function hideFloat() {
    win.hidden = true
  }

  document.getElementById('btn-pop-stata').addEventListener('click', showFloat)
  document.getElementById('float-stata-close').addEventListener('click', hideFloat)
  document.getElementById('float-stata-dock').addEventListener('click', () => {
    hideFloat()
    persistLayout({ bottomOpen: true })
  })

  let dragState = null
  drag.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return
    dragState = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y }
    drag.setPointerCapture(e.pointerId)
    document.body.classList.add('is-dragging')
  })
  drag.addEventListener('pointermove', (e) => {
    if (!dragState) return
    pos.x = Math.max(0, dragState.ox + (e.clientX - dragState.x))
    pos.y = Math.max(0, dragState.oy + (e.clientY - dragState.y))
    place()
  })
  drag.addEventListener('pointerup', () => {
    dragState = null
    document.body.classList.remove('is-dragging')
  })

  let resizeState = null
  resize.addEventListener('pointerdown', (e) => {
    resizeState = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
    resize.setPointerCapture(e.pointerId)
  })
  resize.addEventListener('pointermove', (e) => {
    if (!resizeState) return
    size.w = Math.max(240, resizeState.w + (e.clientX - resizeState.x))
    size.h = Math.max(140, resizeState.h + (e.clientY - resizeState.y))
    place()
  })
  resize.addEventListener('pointerup', () => {
    resizeState = null
  })

  document.getElementById('float-start').addEventListener('click', async () => {
    renderConnector(await bantuity.startConnector())
  })
  document.getElementById('float-stop').addEventListener('click', async () => {
    renderConnector(await bantuity.stopConnector())
  })
})()

/* ── Product / chrome actions ──────────────────────────────── */
document.querySelectorAll('.nav-item[data-product]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    if (e.target.closest('.nav-float')) return
    openProduct(btn.dataset.product)
  })
})

document.querySelectorAll('[data-detach]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    bantuity.detachProduct(btn.dataset.detach)
  })
})

document.querySelectorAll('.act-btn[data-product]').forEach((btn) => {
  btn.addEventListener('click', () => openProduct(btn.dataset.product))
})

document.getElementById('btn-workspace').addEventListener('click', () => {
  openProduct(current, 'workspace')
})
document.getElementById('btn-home').addEventListener('click', () => {
  openProduct(current, 'home')
})
document.getElementById('btn-reload').addEventListener('click', () => bantuity.reloadContent())

document.getElementById('btn-toggle-side').addEventListener('click', () => {
  persistLayout({ sidebarOpen: !layout.sidebarOpen })
})
document.getElementById('btn-close-side').addEventListener('click', () => {
  persistLayout({ sidebarOpen: false })
})
document.getElementById('btn-toggle-bottom').addEventListener('click', () => {
  persistLayout({ bottomOpen: !layout.bottomOpen })
})
document.getElementById('act-stata').addEventListener('click', () => {
  persistLayout({ bottomOpen: !layout.bottomOpen })
})
document.getElementById('act-detach').addEventListener('click', () => {
  bantuity.detachProduct(current)
})
document.getElementById('act-updates').addEventListener('click', () => {
  bantuity.openExternal('https://github.com/Pakang619/bantuity-desktop/releases/latest')
})
document.getElementById('btn-reset-layout').addEventListener('click', () => {
  persistLayout({
    sidebarOpen: true,
    sidebarWidth: 280,
    bottomOpen: true,
    bottomHeight: 168,
    activityBar: true,
  })
})

const btnMcpDocs = document.getElementById('btn-mcp-docs')
if (btnMcpDocs) {
  btnMcpDocs.addEventListener('click', () => {
    // Bundled offline MCP guide (copilot/mcp/) after web rebundle
    openProduct('copilot', 'mcp')
  })
}
const btnMcpGh = document.getElementById('btn-mcp-github')
if (btnMcpGh) {
  btnMcpGh.addEventListener('click', () => {
    bantuity.openExternal('https://github.com/Pakang619/stata-copilot/tree/master/mcp')
  })
}

document.getElementById('btn-conn-start').addEventListener('click', async () => {
  renderConnector(await bantuity.startConnector())
})
document.getElementById('btn-conn-stop').addEventListener('click', async () => {
  renderConnector(await bantuity.stopConnector())
})

/* Double-click bottom bar header area to toggle */
document.getElementById('bottom-drag').addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return
  persistLayout({ bottomOpen: !layout.bottomOpen })
})

if (window.bantuity?.onProductChanged) {
  bantuity.onProductChanged((id) => {
    ensureTab(id)
    highlightProduct(id)
  })
}
if (window.bantuity?.onLayoutChanged) {
  bantuity.onLayoutChanged((L) => {
    layout = { ...layout, ...L }
    applyLayoutCss()
  })
}
if (window.bantuity?.onConnectorChanged) {
  bantuity.onConnectorChanged((st) => renderConnector(st))
}

// Keyboard shortcuts inside shell
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  if (e.key === 'b' || e.key === 'B') {
    e.preventDefault()
    persistLayout({ sidebarOpen: !layout.sidebarOpen })
  }
  if (e.key === 'j' || e.key === 'J') {
    e.preventDefault()
    persistLayout({ bottomOpen: !layout.bottomOpen })
  }
  if (e.key === '1') {
    e.preventDefault()
    openProduct('plotex')
  }
  if (e.key === '2') {
    e.preventDefault()
    openProduct('copilot')
  }
})

refresh()
setInterval(async () => {
  try {
    renderConnector(await bantuity.getConnectorStatus())
  } catch {
    /* */
  }
}, 4000)
