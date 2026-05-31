/**
 * Convert public/icon.svg → build/icon.ico (multi-resolution).
 *
 * Windows uses ICO for both the exe icon and file-association icons.
 * electron-builder expects a single .ico containing several sizes;
 * Windows picks the closest match per UI context (taskbar, jump-list,
 * Explorer tile, etc.).
 *
 * Sizes embedded: 16, 24, 32, 48, 64, 128, 256.
 * Also emits build/icon-512.png for any platforms that prefer raw PNG.
 *
 * Run via:  npm run build:icon
 */

const fs = require('fs')
const path = require('path')
const sharp = require('sharp')
const pngToIco = require('png-to-ico').default

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'public', 'icon.svg')
const OUT_DIR = path.join(ROOT, 'build')
const OUT_ICO = path.join(OUT_DIR, 'icon.ico')
const OUT_PNG = path.join(OUT_DIR, 'icon-512.png')

const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error('❌ Source SVG not found:', SRC)
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const svg = fs.readFileSync(SRC)

  // Render the SVG to PNGs at each target size.
  console.log('[icon] Rendering PNG sizes:', SIZES.join(', '))
  const pngs = await Promise.all(
    SIZES.map((size) =>
      sharp(svg, { density: 512 })
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  )

  // Combine PNGs into a single multi-resolution ICO.
  const ico = await pngToIco(pngs)
  fs.writeFileSync(OUT_ICO, ico)
  console.log('[icon] Wrote', path.relative(ROOT, OUT_ICO), `(${ico.length} bytes)`)

  // Also write a 512×512 PNG for non-Windows targets / docs / GitHub social.
  const png512 = await sharp(svg, { density: 512 }).resize(512, 512).png().toBuffer()
  fs.writeFileSync(OUT_PNG, png512)
  console.log('[icon] Wrote', path.relative(ROOT, OUT_PNG), `(${png512.length} bytes)`)
}

main().catch((err) => {
  console.error('❌ build-icon failed:', err)
  process.exit(1)
})
