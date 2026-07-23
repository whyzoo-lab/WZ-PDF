/**
 * Copies pdfjs-dist's runtime assets from node_modules into public/ so Vite
 * serves them as static assets in BOTH dev and production:
 *
 *   wasm/            JBIG2 / OpenJPEG / QCMS / QuickJS decoders
 *   cmaps/           predefined CJK CMaps (.bcmap)
 *   standard_fonts/  Foxit substitutes for the 14 non-embedded standard fonts
 *
 * Why each is required:
 *
 * - wasm: pdfjs 5.x moved JBIG2, CCITT-Fax, JPEG2000 image decoding and colour
 *   management into WebAssembly. Without a `wasmUrl` pointing at these files,
 *   pdfjs silently drops any image that needs them — e.g. the CCITT/JBIG2
 *   ImageMasks that make up the text layer of Korean scanner (MRC) PDFs, so the
 *   page renders with the background only and the text missing/faint.
 *
 * - standard_fonts + cmaps: we pass `disableFontFace: true` (the FontFace path
 *   hangs in Electron for canvas-only rendering), which also turns OFF pdfjs's
 *   system-font fallback. A font the PDF references but does NOT embed then has
 *   no glyph source at all, so every character renders as a .notdef box (▯) —
 *   e.g. the account-number / date / phone fields of a bank passbook printout,
 *   while the embedded-font body text around them renders fine.
 *   `standardFontDataUrl` supplies the substitute font programs; `cMapUrl`
 *   supplies the predefined CJK CMaps a Korean CID font needs to map codes to
 *   glyphs.
 *
 * Run: npm run setup:pdfjs
 * Called automatically by: npm run predev, npm run predev:vite,
 *                          npm run build, npm run build:exe
 */

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const pkgDir = path.join(root, 'node_modules', 'pdfjs-dist')

/** Asset directories mirrored from pdfjs-dist into public/. */
const DIRS = ['wasm', 'cmaps', 'standard_fonts']

for (const dir of DIRS) {
  const srcDir = path.join(pkgDir, dir)
  const destDir = path.join(root, 'public', dir)
  if (!fs.existsSync(srcDir)) {
    console.warn(`[setup:pdfjs] pdfjs-dist/${dir} not found — skipped`)
    continue
  }
  fs.mkdirSync(destDir, { recursive: true })
  let copied = 0
  for (const name of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name))
    copied++
  }
  console.log(`[setup:pdfjs] copied ${copied} file(s) → public/${dir}/`)
}
