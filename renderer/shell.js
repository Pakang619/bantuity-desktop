/* global bantuity */

let current = 'plotex'
let settings = null

async function refresh() {
  const data = await bantuity.getSettings()
  settings = data.settings
  current = data.currentProduct || settings.lastProduct || 'plotex'
  highlightProduct(current)
  renderConnector(data.connector)
  const offline = data.offline || {}
  const modeEl = document.getElementById('ui-mode')
  if (modeEl) {
    const both = offline.plotex && offline.copilot
    modeEl.textContent = both
      ? 'Offline UI bundled (APIs still need internet)'
      : 'Online UI mode — run npm run bundle:web to embed apps'
  }
}

function highlightProduct(id) {
  document.querySelectorAll('.product').forEach((btn) => {
    btn.dataset.active = btn.dataset.product === id ? 'true' : 'false'
  })
}

function renderConnector(conn) {
  const dot = document.getElementById('conn-dot')
  const text = document.getElementById('conn-text')
  const detail = document.getElementById('conn-detail')
  if (!conn) return
  if (conn.running) {
    dot.className = 'dot on'
    text.textContent = 'Connector running'
    detail.textContent = conn.message || 'Ready for Plotex and Copilot Stata jobs.'
  } else if (conn.installPath) {
    dot.className = 'dot'
    text.textContent = 'Connector installed'
    detail.textContent = conn.message || 'Click Start connector before running analyses.'
  } else {
    dot.className = 'dot'
    text.textContent = 'Not installed'
    detail.textContent =
      'Download the free Stata connector once, install it, then click Start connector.'
  }
}

document.querySelectorAll('.product').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.product
    current = id
    highlightProduct(id)
    await bantuity.openProduct(id, 'workspace')
  })
})

document.getElementById('btn-workspace').addEventListener('click', async () => {
  await bantuity.openProduct(current, 'workspace')
})

document.getElementById('btn-home').addEventListener('click', async () => {
  await bantuity.openProduct(current, 'home')
})

document.getElementById('btn-conn-start').addEventListener('click', async () => {
  const st = await bantuity.startConnector()
  renderConnector(st)
})

document.getElementById('btn-conn-stop').addEventListener('click', async () => {
  const st = await bantuity.stopConnector()
  renderConnector(st)
})

document.getElementById('btn-download').addEventListener('click', async () => {
  // Stata connector ZIP still comes from the product web API / workspace
  const url =
    current === 'copilot'
      ? 'https://copilot.bantuity.com/workspace'
      : 'https://plotex.bantuity.com/#download'
  await bantuity.openExternal(url)
})

// Optional: expose desktop app update page
const desktopLink = document.getElementById('btn-desktop-update')
if (desktopLink) {
  desktopLink.addEventListener('click', async () => {
    await bantuity.openExternal(
      'https://github.com/Pakang619/bantuity-desktop/releases/latest'
    )
  })
}

if (window.bantuity?.onProductChanged) {
  bantuity.onProductChanged((id) => {
    current = id
    highlightProduct(id)
  })
}

refresh()
setInterval(async () => {
  const st = await bantuity.getConnectorStatus()
  renderConnector(st)
}, 4000)
