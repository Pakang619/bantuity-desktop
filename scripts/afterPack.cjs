/**
 * Embed Bantuity icon.ico into Bantuity.exe PE resources.
 * Windows taskbar uses the .exe icon — not BrowserWindow.setIcon alone.
 */
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const projectDir = context.packager.projectDir
  const icoPath = path.join(projectDir, 'assets', 'icon.ico')

  if (!fs.existsSync(exePath)) {
    console.warn('[afterPack] exe missing:', exePath)
    return
  }
  if (!fs.existsSync(icoPath)) {
    console.warn('[afterPack] icon.ico missing:', icoPath)
    return
  }

  const binDir = path.join(projectDir, 'node_modules', 'rcedit', 'bin')
  const rceditExe = path.join(
    binDir,
    process.arch === 'ia32' ? 'rcedit.exe' : 'rcedit-x64.exe'
  )
  if (!fs.existsSync(rceditExe)) {
    console.warn('[afterPack] rcedit binary missing:', rceditExe)
    return
  }

  console.log('[afterPack] embedding icon →', exePath)
  const args = [
    exePath,
    '--set-icon',
    icoPath,
    '--set-version-string',
    'CompanyName',
    'Bantuity',
    '--set-version-string',
    'FileDescription',
    'Bantuity Desktop',
    '--set-version-string',
    'ProductName',
    'Bantuity',
    '--set-version-string',
    'InternalName',
    'Bantuity',
    '--set-version-string',
    'OriginalFilename',
    exeName,
    '--set-file-version',
    context.packager.appInfo.version,
    '--set-product-version',
    context.packager.appInfo.version,
  ]

  const res = spawnSync(rceditExe, args, { encoding: 'utf8', windowsHide: true })
  if (res.status !== 0) {
    console.error('[afterPack] rcedit failed:', res.stderr || res.stdout || res.error)
    throw new Error(`rcedit exit ${res.status}`)
  }
  console.log('[afterPack] Bantuity icon embedded into executable')
}
