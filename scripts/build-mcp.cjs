/**
 * Bundle the MCP server so the installer can ship it.
 *
 * The server lives in its own package (`mcp/`) with ~157 MB of dependencies,
 * which is not something to copy into an installer. esbuild collapses it into a
 * single file instead — except pdfjs, which is deliberately left external.
 *
 * Why pdfjs cannot be bundled: `pdfjs-dist/legacy/build/pdf.mjs` evaluates
 * `new DOMMatrix()` at module scope and relies on its own Node startup order to
 * have a polyfill in place first. Bundling reorders that and the server dies on
 * import with `DOMMatrix is not defined`. Left external, Node loads it exactly
 * as it does today, so only the two files it actually needs are shipped
 * (~3.3 MB) beside the bundle.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const MCP = path.join(ROOT, 'mcp')
const OUT = path.join(ROOT, 'build', 'mcp')

/**
 * The two pdfjs files the server actually loads.
 *
 * They land in `pdfjs/`, NOT in a `node_modules/` directory: electron-builder
 * silently skips a nested node_modules when copying extraResources, and the
 * server would ship without pdfjs and die on its first import. src/pdfjs.ts
 * looks for them here and falls back to package resolution in a checkout.
 */
const PDFJS_FILES = [
  path.join('legacy', 'build', 'pdf.mjs'),
  path.join('legacy', 'build', 'pdf.worker.mjs'),
]

function ensureDeps() {
  if (fs.existsSync(path.join(MCP, 'node_modules', 'esbuild'))) return
  console.log('[build-mcp] installing mcp dependencies...')
  execFileSync('npm', ['ci'], { cwd: MCP, stdio: 'inherit', shell: process.platform === 'win32' })
}

function bundle() {
  const esbuild = require(path.join(MCP, 'node_modules', 'esbuild'))
  return esbuild.build({
    entryPoints: [path.join(MCP, 'src', 'server.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: path.join(OUT, 'wz-pdf-mcp.mjs'),
    external: ['pdfjs-dist'],
    // The bundle is ESM but its dependencies still call require(); give them one.
    banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
    logLevel: 'warning',
  })
}

function copyPdfjs() {
  const from = path.join(MCP, 'node_modules', 'pdfjs-dist')
  const to = path.join(OUT, 'pdfjs')
  fs.mkdirSync(to, { recursive: true })
  for (const rel of PDFJS_FILES) {
    const src = path.join(from, rel)
    if (!fs.existsSync(src)) throw new Error(`pdfjs file missing: ${src}`)
    fs.copyFileSync(src, path.join(to, path.basename(rel)))
  }
}

function totalSize(dir) {
  let bytes = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    bytes += entry.isDirectory() ? totalSize(full) : fs.statSync(full).size
  }
  return bytes
}

async function main() {
  ensureDeps()
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  await bundle()
  copyPdfjs()
  console.log(`[build-mcp] MCP server bundled (${(totalSize(OUT) / 1048576).toFixed(1)} MB)`)
}

main().catch(err => {
  console.error('[build-mcp] failed:', err.message)
  process.exit(1)
})
