/**
 * Bundled Stata connector — provisioned and started from Bantuity Studio Light.
 * Users should not need a separate ZIP install for the connector app itself.
 * (Licensed Stata must still be installed on the PC.)
 */
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const { app } = require('electron')

const ADMIN_KEY = process.env.BANTUITY_ADMIN_KEY || '123456'

const DEFAULT_APIS = {
  plotex: 'https://plotex-api.onrender.com',
  copilot: 'https://stata-copilot-api.onrender.com',
}

let child = null
let lastLog = ''
let provisioning = false
let status = {
  running: false,
  installPath: '',
  message: 'Stata service idle',
  lastLog: '',
  ready: false,
}

function installRoot() {
  const base = process.env.LOCALAPPDATA || app.getPath('userData')
  return path.join(base, 'Bantuity', 'StataConnector')
}

function bundledConnectorRoot() {
  const candidates = [
    path.join(process.resourcesPath || '', 'connector'),
    path.join(__dirname, '..', 'resources', 'connector'),
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'src', 'runner.py'))) return c
  }
  return ''
}

function getStatus() {
  status.installPath = status.installPath || installRoot()
  status.running = !!(child && !child.killed)
  return { ...status, provisioning }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === '__pycache__' || ent.name === '.venv') continue
      copyDir(s, d)
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

function runCapture(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    })
  } catch (e) {
    const err = (e.stderr || e.stdout || e.message || String(e)).toString()
    const ex = new Error(err.slice(0, 500))
    ex.code = e.status
    throw ex
  }
}

/** System/base Python used to create the venv (never the empty install venv). */
function findBasePython() {
  const local = process.env.LOCALAPPDATA || ''
  const installVenv = path.join(installRoot(), '.venv', 'Scripts', 'python.exe')
  const candidates = [
    path.join(local, 'Bantuity', 'PlotexConnector', '.venv', 'Scripts', 'python.exe'),
    path.join(local, 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(local, 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(local, 'Programs', 'Python', 'Python311', 'python.exe'),
    'C:\\Python313\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c) && path.normalize(c) !== path.normalize(installVenv)) {
      try {
        runCapture(c, ['-c', 'import sys; assert sys.version_info >= (3, 10)'])
        return c
      } catch {
        /* try next */
      }
    }
  }
  try {
    const out = execFileSync('where', ['python'], { encoding: 'utf8', windowsHide: true })
    for (const line of out.split(/\r?\n/).map((s) => s.trim())) {
      if (!line || line.toLowerCase().includes('windowsapps')) continue
      if (path.normalize(line) === path.normalize(installVenv)) continue
      if (!fs.existsSync(line)) continue
      try {
        runCapture(line, ['-c', 'import sys; assert sys.version_info >= (3, 10)'])
        return line
      } catch {
        /* next */
      }
    }
  } catch {
    /* ignore */
  }
  // Last resort: if install venv exists and works as python, use it only for pip repair
  if (fs.existsSync(installVenv)) return installVenv
  return ''
}

function venvHasHttpx(venvPy) {
  try {
    runCapture(venvPy, ['-c', 'import httpx, dotenv'])
    return true
  } catch {
    return false
  }
}

function ensureDeps(dir, venvPy) {
  status.message = 'Installing Stata service packages…'
  const req = path.join(dir, 'requirements.txt')
  // Use python -m pip (more reliable than pip.exe on Windows)
  runCapture(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: dir })
  if (fs.existsSync(req)) {
    runCapture(venvPy, ['-m', 'pip', 'install', '-r', req], { cwd: dir })
  } else {
    runCapture(
      venvPy,
      ['-m', 'pip', 'install', 'httpx>=0.27.0', 'websockets>=12.0', 'python-dotenv>=1.0.0'],
      { cwd: dir }
    )
  }
  if (!venvHasHttpx(venvPy)) {
    throw new Error('Failed to install Python packages (httpx). Check internet access and try again.')
  }
}

function ensurePythonVenv(dir, basePython) {
  const venvPy = path.join(dir, '.venv', 'Scripts', 'python.exe')
  if (!fs.existsSync(venvPy)) {
    status.message = 'Creating Stata service environment (one-time)…'
    // Prefer a real base interpreter, not the missing venv path
    let creator = basePython
    if (!creator || path.normalize(creator) === path.normalize(venvPy)) {
      creator = findBasePython()
    }
    if (!creator || path.normalize(creator) === path.normalize(venvPy)) {
      // try py launcher
      try {
        runCapture('py', ['-3', '-m', 'venv', path.join(dir, '.venv')], { cwd: dir })
      } catch {
        throw new Error(
          'Python 3.10+ was not found. Install Python from https://www.python.org/downloads/ (tick "Add to PATH"), then click Start again.'
        )
      }
    } else {
      runCapture(creator, ['-m', 'venv', path.join(dir, '.venv')], { cwd: dir })
    }
  }
  if (!fs.existsSync(venvPy)) {
    throw new Error('Virtual environment was not created. Install Python 3.10+ and try again.')
  }
  // Always verify deps — empty venvs caused ModuleNotFoundError: httpx
  if (!venvHasHttpx(venvPy)) {
    ensureDeps(dir, venvPy)
  }
  return venvPy
}

function httpJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${ADMIN_KEY}`,
          'X-Admin-Key': ADMIN_KEY,
          ...headers,
        },
        timeout: 25000,
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`))
            return
          }
          try {
            resolve(JSON.parse(body || '{}'))
          } catch (e) {
            reject(e)
          }
        })
      }
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.end()
  })
}

async function fetchProductBootstrap(productId, apiUrl) {
  try {
    const data = await httpJson(`${apiUrl.replace(/\/$/, '')}/api/v1/connector/bootstrap`)
    if (!data.api_url || !data.connector_secret || !data.user_id) return null
    return {
      id: productId,
      name: productId === 'plotex' ? 'Plotex' : 'Copilot',
      api_url: String(data.api_url).replace(/\/$/, ''),
      secret: String(data.connector_secret),
      user_id: String(data.user_id),
      enabled: true,
    }
  } catch (e) {
    lastLog = `bootstrap ${productId}: ${e.message || e}`
    return null
  }
}

async function writeConfig(dir) {
  const products = []
  const plotex = await fetchProductBootstrap('plotex', DEFAULT_APIS.plotex)
  const copilot = await fetchProductBootstrap('copilot', DEFAULT_APIS.copilot)
  if (plotex) products.push(plotex)
  if (copilot) products.push(copilot)

  const cfgPath = path.join(dir, 'config.json')
  let existing = []
  if (fs.existsSync(cfgPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).products || []
    } catch {
      /* ignore */
    }
  }
  for (const p of existing) {
    if (!products.find((x) => x.id === p.id) && p.api_url && p.secret && p.user_id) {
      products.push(p)
    }
  }

  if (!products.length) {
    fs.writeFileSync(
      cfgPath,
      JSON.stringify({ products: [], poll_seconds: 2, work_dir: './work' }, null, 2)
    )
    return false
  }

  fs.writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        products,
        poll_seconds: 2,
        work_dir: './work',
        stata_edition: 'se',
        stata_path: '',
      },
      null,
      2
    )
  )

  const primary = products.find((p) => p.id === 'plotex') || products[0]
  const envLines = [
    `PLOTEX_API_URL=${products.find((p) => p.id === 'plotex')?.api_url || primary.api_url}`,
    `COPILOT_API_URL=${products.find((p) => p.id === 'copilot')?.api_url || primary.api_url}`,
    `CONNECTOR_SECRET=${primary.secret}`,
    `USER_ID=${primary.user_id}`,
    'USE_WEBSOCKET=false',
    'POLL_SECONDS=2',
    'WORK_DIR=./work',
    'STATA_EDITION=se',
  ]
  fs.writeFileSync(path.join(dir, '.env'), envLines.join('\n') + '\n')
  return true
}

async function ensureInstalled() {
  const dir = installRoot()
  const bundled = bundledConnectorRoot()
  if (!bundled) {
    throw new Error('Bundled connector missing from the desktop app package.')
  }

  fs.mkdirSync(dir, { recursive: true })
  copyDir(path.join(bundled, 'src'), path.join(dir, 'src'))
  const reqSrc = path.join(bundled, 'requirements.txt')
  if (fs.existsSync(reqSrc)) {
    fs.copyFileSync(reqSrc, path.join(dir, 'requirements.txt'))
  } else {
    fs.writeFileSync(
      path.join(dir, 'requirements.txt'),
      'httpx>=0.27.0\nwebsockets>=12.0\npython-dotenv>=1.0.0\n'
    )
  }

  const basePy = findBasePython()
  if (!basePy) {
    throw new Error(
      'Python 3.10+ was not found. Install Python from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then click Start again.'
    )
  }

  const venvPy = ensurePythonVenv(dir, basePy)
  await writeConfig(dir)
  status.installPath = dir
  status.ready = true
  return { dir, python: venvPy }
}

async function startConnector() {
  if (child && !child.killed) {
    status.message = 'Stata service already running'
    return getStatus()
  }
  if (provisioning) {
    status.message = 'Still setting up Stata service…'
    return getStatus()
  }

  provisioning = true
  status.message = 'Preparing built-in Stata service…'
  try {
    const { dir, python } = await ensureInstalled()
    // Final preflight
    if (!venvHasHttpx(python)) {
      ensureDeps(dir, python)
    }
    child = spawn(python, ['-m', 'src.run_service'], {
      cwd: dir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    status.installPath = dir
    status.running = true
    status.message = 'Stata service running (Plotex + Copilot)'
    status.ready = true

    child.stdout?.on('data', (buf) => {
      lastLog = String(buf).trim().slice(-800)
      status.lastLog = lastLog
    })
    child.stderr?.on('data', (buf) => {
      lastLog = String(buf).trim().slice(-800)
      status.lastLog = lastLog
    })
    child.on('exit', (code) => {
      child = null
      status.running = false
      status.message =
        code === 0
          ? 'Stata service stopped'
          : `Stata service exited (code ${code}). ${lastLog || 'Check that Stata is installed.'}`
    })
  } catch (e) {
    status.running = false
    status.ready = false
    status.message = e.message || String(e)
    lastLog = status.message
    status.lastLog = lastLog
  } finally {
    provisioning = false
  }
  return getStatus()
}

function stopConnector() {
  if (child && !child.killed) {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    child = null
  }
  status.running = false
  status.message = 'Stata service stopped'
  return getStatus()
}

function findConnectorInstall() {
  const dir = installRoot()
  if (fs.existsSync(path.join(dir, 'src', 'run_service.py'))) return dir
  const bundled = bundledConnectorRoot()
  return bundled || dir
}

module.exports = {
  getStatus,
  startConnector,
  stopConnector,
  findConnectorInstall,
  ensureInstalled,
  installRoot,
}
