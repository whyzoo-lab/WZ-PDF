/**
 * Stage the rhwp engine for both of the places that load it.
 *
 * 1. public/hwp/rhwp_bg.wasm — the renderer's copy, which Vite includes in the
 *    production bundle as a static asset.
 * 2. build/rhwp/ — the JS glue for the main process, which runs HWP ⇄ HWPX
 *    conversion with no window at all (electron/hwpxCliBackend.ts). Only the
 *    glue is staged: the main process reads the wasm from the renderer's copy,
 *    so the 7 MB binary is shipped once rather than twice.
 *
 * The package.json beside the glue is not optional. Node would otherwise fail
 * to parse the lone .js as CommonJS, retry it as ESM and print a
 * MODULE_TYPELESS_PACKAGE_JSON warning to stderr — straight into the console
 * tool's output.
 *
 * Run: npm run setup:hwp
 * Called automatically by: npm run build, npm run build:exe
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PKG = path.join(ROOT, 'node_modules', '@rhwp', 'core')

const wasmDest = path.join(ROOT, 'public', 'hwp', 'rhwp_bg.wasm')
fs.mkdirSync(path.dirname(wasmDest), { recursive: true })
fs.copyFileSync(path.join(PKG, 'rhwp_bg.wasm'), wasmDest)
console.log(`[setup:hwp] copied rhwp_bg.wasm → ${wasmDest}`)

const glueDir = path.join(ROOT, 'build', 'rhwp')
fs.mkdirSync(glueDir, { recursive: true })
fs.copyFileSync(path.join(PKG, 'rhwp.js'), path.join(glueDir, 'rhwp.js'))
fs.writeFileSync(path.join(glueDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n')
console.log(`[setup:hwp] staged rhwp.js → ${glueDir}`)
