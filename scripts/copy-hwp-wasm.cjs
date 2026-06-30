/**
 * Copies the rhwp WASM binary from node_modules into public/hwp/ so Vite
 * includes it in the production bundle (served as a static asset).
 *
 * Run: npm run setup:hwp
 * Called automatically by: npm run build, npm run build:exe
 */

const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'node_modules', '@rhwp', 'core', 'rhwp_bg.wasm')
const destDir = path.join(__dirname, '..', 'public', 'hwp')
const dest = path.join(destDir, 'rhwp_bg.wasm')

fs.mkdirSync(destDir, { recursive: true })
fs.copyFileSync(src, dest)
console.log(`[setup:hwp] copied rhwp_bg.wasm → ${dest}`)
