const { app } = require('electron')
const fs = require('fs')
const path = require('path')

const DEFAULTS = {
  products: {
    plotex: {
      id: 'plotex',
      name: 'Plotex',
      subtitle: 'Publication figures',
      url: 'https://plotex.bantuity.com',
      workspaceUrl: 'https://plotex.bantuity.com/workspace',
      apiUrl: 'https://plotex-api.onrender.com',
    },
    copilot: {
      id: 'copilot',
      name: 'Copilot',
      subtitle: 'Stata analysis',
      url: 'https://copilot.bantuity.com',
      workspaceUrl: 'https://copilot.bantuity.com/workspace',
      apiUrl: 'https://stata-copilot-api.onrender.com',
    },
  },
  lastProduct: 'plotex',
  openWorkspaceOnLaunch: true,
  connectorPath: '', // e.g. %LOCALAPPDATA%\\Bantuity\\PlotexConnector or StataConnector
}

function configPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    const p = configPath()
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
      return {
        ...DEFAULTS,
        ...raw,
        products: {
          plotex: { ...DEFAULTS.products.plotex, ...(raw.products?.plotex || {}) },
          copilot: { ...DEFAULTS.products.copilot, ...(raw.products?.copilot || {}) },
        },
      }
    }
  } catch {
    /* ignore */
  }
  return structuredClone(DEFAULTS)
}

function saveSettings(settings) {
  const p = configPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf8')
}

function findConnectorInstall() {
  const local = process.env.LOCALAPPDATA || ''
  const candidates = [
    path.join(local, 'Bantuity', 'StataConnector'),
    path.join(local, 'Bantuity', 'PlotexConnector'),
    path.join(local, 'Bantuity', 'CopilotConnector'),
  ]
  for (const dir of candidates) {
    const py = path.join(dir, '.venv', 'Scripts', 'python.exe')
    const pyw = path.join(dir, '.venv', 'Scripts', 'pythonw.exe')
    if (fs.existsSync(py) || fs.existsSync(pyw)) {
      return dir
    }
  }
  return ''
}

module.exports = {
  DEFAULTS,
  loadSettings,
  saveSettings,
  findConnectorInstall,
  configPath,
}
