/**
 * Build professional Windows desktop icons from the official Bantuity mark PNG.
 * Source: assets/brand-mark-master.png (Bantuity_Favicon_512 / Mark favicon)
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const assets = path.join(__dirname, '..', 'assets')

const masters = [
  path.join(assets, 'brand-mark-master.png'),
  path.join(assets, 'brand-favicon-512.png'),
  path.join(assets, 'brand-mark-ref.png'),
]

const masterPath = masters.find((p) => fs.existsSync(p))
if (!masterPath) {
  console.error('No brand-mark-master.png found in assets/. Copy the official Bantuity mark PNG first.')
  process.exit(1)
}

console.log('master:', masterPath)

// Normalize master to 1024² sRGB, no stretch (contain on brand black)
const MASTER_SIZE = 1024
const BRAND_BG = { r: 19, g: 18, b: 0, alpha: 1 } // #131200

const masterBuf = await sharp(masterPath)
  .ensureAlpha()
  .resize(MASTER_SIZE, MASTER_SIZE, {
    fit: 'contain',
    background: BRAND_BG,
    kernel: sharp.kernel.lanczos3,
  })
  .png()
  .toBuffer()

// Also write a clean SVG-like shell mark as PNG for UI
fs.writeFileSync(path.join(assets, 'icon-master.png'), masterBuf)

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512]
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoBuffers = []

for (const size of sizes) {
  // Slight padding only at very small sizes to keep the coral square readable
  const pad = size <= 24 ? Math.round(size * 0.04) : 0
  const inner = size - pad * 2

  let pipeline = sharp(masterBuf).resize(inner, inner, {
    fit: 'fill',
    kernel: size <= 32 ? sharp.kernel.lanczos3 : sharp.kernel.lanczos3,
  })

  if (pad > 0) {
    pipeline = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: BRAND_BG,
      },
    }).composite([{ input: await pipeline.png().toBuffer(), left: pad, top: pad }])
  }

  const buf = await pipeline.png().toBuffer()
  const out = path.join(assets, `icon-${size}.png`)
  fs.writeFileSync(out, buf)
  console.log('wrote', out, buf.length)
  if (icoSizes.includes(size)) icoBuffers.push(buf)
}

// Canonical PNG (512) for Electron fallback / docs
const iconPng = await sharp(masterBuf).resize(512, 512, { kernel: sharp.kernel.lanczos3 }).png().toBuffer()
fs.writeFileSync(path.join(assets, 'icon.png'), iconPng)
console.log('wrote icon.png')

// UI shell mark (same as master, 256)
const uiMark = await sharp(masterBuf).resize(256, 256).png().toBuffer()
fs.writeFileSync(path.join(assets, 'bantuity_mark.png'), uiMark)

// Multi-resolution ICO for Windows taskbar / installer / .exe
const ico = await pngToIco(icoBuffers)
fs.writeFileSync(path.join(assets, 'icon.ico'), ico)
console.log('wrote icon.ico', ico.length)

// Keep a simple SVG wrapper that references brand (shell may prefer PNG)
const svgShell = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Bantuity">
  <rect width="120" height="120" fill="#131200"/>
  <!-- Official mark is delivered as PNG for pixel-perfect desktop; SVG kept for layout. -->
  <image href="bantuity_mark.png" x="0" y="0" width="120" height="120" preserveAspectRatio="xMidYMid meet"/>
</svg>
`
fs.writeFileSync(path.join(assets, 'icon.svg'), svgShell)

console.log('Done. Professional Bantuity desktop icons generated from official mark.')
