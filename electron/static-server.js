/**
 * Tiny static file server for offline Next.js exports (SPA-friendly).
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent((reqPath || '/').split('?')[0])
  const cleaned = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '')
  const full = path.join(root, cleaned)
  if (!full.startsWith(root)) return null
  return full
}

function createStaticServer(rootDir, port) {
  const root = path.resolve(rootDir)
  if (!fs.existsSync(root)) {
    throw new Error(`Static app missing: ${root}`)
  }

  const server = http.createServer((req, res) => {
    try {
      let filePath = safeJoin(root, req.url || '/')
      if (!filePath) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html')
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        // SPA / Next trailingSlash fallback
        const fallback = path.join(root, 'index.html')
        if (fs.existsSync(fallback)) {
          filePath = fallback
        } else {
          res.writeHead(404)
          res.end('Not found')
          return
        }
      }

      const ext = path.extname(filePath).toLowerCase()
      const type = MIME[ext] || 'application/octet-stream'
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
      })
      fs.createReadStream(filePath).pipe(res)
    } catch (e) {
      res.writeHead(500)
      res.end(String(e.message || e))
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        port,
        origin: `http://127.0.0.1:${port}`,
        root,
        close: () =>
          new Promise((resClose) => {
            server.close(() => resClose())
          }),
      })
    })
  })
}

function appsRoot() {
  // Packaged: resources/apps ; dev: project/apps
  if (process.resourcesPath && process.resourcesPath !== process.cwd()) {
    const packed = path.join(process.resourcesPath, 'apps')
    if (fs.existsSync(packed)) return packed
  }
  return path.join(__dirname, '..', 'apps')
}

module.exports = {
  createStaticServer,
  appsRoot,
  pathToFileURL,
}
