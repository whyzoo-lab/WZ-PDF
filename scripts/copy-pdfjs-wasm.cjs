/**
 * Copies pdfjs-dist's WASM decoders (jbig2 / openjpeg / qcms / quickjs) from
 * node_modules into public/wasm/ so Vite serves them as static assets in BOTH
 * dev and production.
 *
 * pdfjs 5.x moved JBIG2, CCITT-Fax, JPEG2000 image decoding and color
 * management into WebAssembly modules. Without a `wasmUrl` pointing at these
 * files, pdfjs silently drops any image that needs them — e.g. the CCITT/JBIG2
 * ImageMasks that make up the text layer of Korean scanner (MRC) PDFs, so the
 * page renders with the background only and the text missing/faint.
 *
 * Run: npm run setup:pdfjs
 * Called automatically by: npm run predev, npm run predev:vite,
 *                          npm run build, npm run build:exe
 */

const fs = require('fs')
const path = require('path')

const srcDir = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'wasm')
const destDir = path.join(__dirname, '..', 'public', 'wasm')

fs.mkdirSync(destDir, { recursive: true })
let copied = 0
for (const name of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name))
  copied++
}
console.log(`[setup:pdfjs] copied ${copied} pdfjs wasm asset(s) → ${destDir}`)
