/**
 * Manage the local Bantuity Stata connector process from the desktop shell.
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { findConnectorInstall } = require('./config')

let child = null
let lastLog = ''
let status = {
  running: false,
  installPath: '',
  message: 'Connector not started',
  lastLog: '',
}

function getStatus() {
  status.installPath = status.installPath || findConnectorInstall()
  status.running = !!(child && !child.killed)
  return { ...status }
}

function startConnector(installPath) {
  const dir = installPath || findConnectorInstall()
  if (!dir) {
    status = {
      running: false,
      installPath: '',
      message: 'Stata connector not installed. Download it once from Plotex or Copilot.',
      lastLog,
    }
    return getStatus()
  }

  if (child && !child.killed) {
    status.message = 'Connector already running'
    return getStatus()
  }

  const pythonw = path.join(dir, '.venv', 'Scripts', 'pythonw.exe')
  const python = path.join(dir, '.venv', 'Scripts', 'python.exe')
  const exe = fs.existsSync(pythonw) ? pythonw : python
  if (!fs.existsSync(exe)) {
    status = {
      running: false,
      installPath: dir,
      message: 'Connector found but Python is missing. Re-run Install.bat in the connector folder.',
      lastLog,
    }
    return getStatus()
  }

  // Prefer GUI module if present, else headless connector / worker
  const candidates = [
    ['-m', 'src.app'],
    ['-m', 'src.worker'],
    ['-m', 'src.connector'],
  ]
  let args = candidates[candidates.length - 1]
  for (const c of candidates) {
    const mod = c[1].replace(/\./g, path.sep) + '.py'
    if (fs.existsSync(path.join(dir, ...mod.split(path.sep)))) {
      args = c
      break
    }
    // package layout src/app.py
    const simple = path.join(dir, 'src', c[1].split('.').pop() + '.py')
    if (fs.existsSync(simple)) {
      args = c
      break
    }
  }

  try {
    child = spawn(exe, args, {
      cwd: dir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    status.installPath = dir
    status.running = true
    status.message = 'Local Stata connector is running'
    child.stdout?.on('data', (buf) => {
      lastLog = String(buf).trim().slice(-500)
      status.lastLog = lastLog
    })
    child.stderr?.on('data', (buf) => {
      lastLog = String(buf).trim().slice(-500)
      status.lastLog = lastLog
    })
    child.on('exit', (code) => {
      child = null
      status.running = false
      status.message =
        code === 0
          ? 'Connector stopped'
          : `Connector exited (code ${code}). Open it again if you need Stata runs.`
    })
  } catch (e) {
    status.running = false
    status.message = `Could not start connector: ${e.message || e}`
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
  status.message = 'Connector stopped'
  return getStatus()
}

module.exports = {
  getStatus,
  startConnector,
  stopConnector,
  findConnectorInstall,
}
