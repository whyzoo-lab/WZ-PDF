/**
 * Generate public/og-image.png (1200×630) for social / link previews.
 * Rasterizes an inline SVG with sharp. Run via `npm run build:og`.
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const OUT = path.resolve(__dirname, '..', 'public', 'og-image.png')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/>
      <stop offset="1" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="wordmark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- App icon: rounded blue square with PDF -->
  <g transform="translate(110, 195)">
    <rect width="240" height="240" rx="46" fill="#0A84FF"/>
    <text x="120" y="158" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
          font-size="92" font-weight="900" letter-spacing="-6" fill="#ffffff">PDF</text>
  </g>

  <!-- Wordmark + tagline -->
  <text x="410" y="288" font-family="Arial, Helvetica, sans-serif" font-size="120"
        font-weight="800" letter-spacing="-3" fill="url(#wordmark)">WZ PDF</text>
  <text x="414" y="360" font-family="Arial, Helvetica, sans-serif" font-size="36"
        font-weight="600" fill="#e2e8f0">PDF Viewer · Editor · Annotator</text>
  <text x="414" y="412" font-family="Arial, Helvetica, sans-serif" font-size="26"
        fill="#94a3b8">Free · No upload · Runs entirely in your browser</text>

  <!-- Bottom accent bar -->
  <rect x="0" y="618" width="1200" height="12" fill="url(#wordmark)"/>
</svg>`

sharp(Buffer.from(svg)).png().toFile(OUT)
  .then(() => console.log('[og] Wrote', path.relative(path.resolve(__dirname, '..'), OUT)))
  .catch(err => { console.error('[og] failed:', err); process.exit(1) })
