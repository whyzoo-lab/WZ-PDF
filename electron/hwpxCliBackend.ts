import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { app } from 'electron'
import type { ConverterSpec } from './cli'
import type { ConversionBackend } from './convertRunner'

/**
 * HWP ⇄ HWPX, converted in the main process with no window at all.
 *
 * Unlike the PDF converter beside it, this one never touches Chromium: it is a
 * document-structure transform, not a rendering job, so rhwp's WASM does the
 * whole thing. No BrowserWindow, no page load, no bridge, no Korean fonts —
 * which is why a document converts in tens of milliseconds here against the
 * hundreds the PDF path needs, and why none of that path's startup traps apply.
 */

/** Only the surface we actually use, described here rather than imported from
 *  @rhwp/core: the package is not a runtime dependency of the main process (it
 *  is loaded from disk at the paths below), and writing it out documents
 *  exactly which four members an engine upgrade has to keep. */
interface RhwpDocument {
  pageCount(): number
  exportHwp(): Uint8Array
  exportHwpx(): Uint8Array
  free(): void
}

/**
 * A compiled WebAssembly module, typed structurally.
 *
 * TypeScript declares the `WebAssembly` namespace in its DOM lib, and the
 * project that type-checks this file builds with `lib: ["ES2023"]` — so naming
 * the type (or the global) directly fails there while compiling fine under the
 * Electron project. Reaching the constructor through globalThis keeps one
 * spelling that satisfies both.
 */
type WasmModule = object

const WasmModuleCtor = (globalThis as unknown as {
  WebAssembly: { Module: new (bytes: Uint8Array) => WasmModule }
}).WebAssembly.Module

interface RhwpModule {
  initSync(input: { module: WasmModule }): unknown
  HwpDocument: new (bytes: Uint8Array) => RhwpDocument
}

/**
 * A real dynamic import, kept out of TypeScript's reach.
 *
 * The main process is compiled to CommonJS, and tsc rewrites a literal
 * `import()` into a require() call — which cannot load rhwp.js, an ES module.
 * Building the import through Function leaves it untouched in the output. This
 * is the wrapper the project's "never patch a dependency" rule asks for: rhwp
 * stays exactly as published and this comment can be deleted the day the main
 * process is itself ESM.
 */
const importEsm = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<RhwpModule>

/** Engine loading is bounded like every other wait, though it is local I/O. */
const WARMUP_TIMEOUT_MS = 60_000
/** A pathological document must not hang the rest of the batch. */
const PER_FILE_TIMEOUT_MS = 120_000

/**
 * Where the engine lives at runtime.
 *
 * Packaged, the glue is shipped by itself (electron-builder `extraResources`)
 * while the 7 MB wasm is the copy the renderer already uses — asarUnpack'd, and
 * fs transparently redirects the app.asar path to app.asar.unpacked, so there
 * is no second copy in the installer.
 */
function enginePaths(): { glue: string; wasm: string } {
  if (app.isPackaged) {
    return {
      glue: path.join(process.resourcesPath, 'rhwp', 'rhwp.js'),
      wasm: path.join(app.getAppPath(), 'dist', 'hwp', 'rhwp_bg.wasm'),
    }
  }
  const pkg = path.join(app.getAppPath(), 'node_modules', '@rhwp', 'core')
  return { glue: path.join(pkg, 'rhwp.js'), wasm: path.join(pkg, 'rhwp_bg.wasm') }
}

async function loadEngine(): Promise<RhwpModule> {
  const { glue, wasm } = enginePaths()
  for (const [label, file] of [['engine', glue], ['engine data', wasm]] as const) {
    if (!fs.existsSync(file)) {
      throw new Error(`HWP ${label} is missing at ${file} — reinstall WZ PDF`)
    }
  }
  const rhwp = await importEsm(pathToFileURL(glue).href)
  // initSync with an explicit module, not the default async initialiser: that
  // one fetches the wasm by URL, which means nothing outside a browser.
  rhwp.initSync({ module: new WasmModuleCtor(fs.readFileSync(wasm)) })
  return rhwp
}

export function createHwpxBackend(spec: ConverterSpec): ConversionBackend {
  let engine: RhwpModule | null = null

  return {
    warmupTimeoutMs: WARMUP_TIMEOUT_MS,
    perFileTimeoutMs: PER_FILE_TIMEOUT_MS,

    async warmup() {
      engine = await loadEngine()
    },

    async convert(inputPath) {
      if (!engine) throw new Error('converter is not running')
      const bytes = await fs.promises.readFile(inputPath)
      const doc = new engine.HwpDocument(new Uint8Array(bytes))
      try {
        // Copied out of the WASM heap before the document is freed.
        return Uint8Array.from(spec.targetExt === 'hwpx' ? doc.exportHwpx() : doc.exportHwp())
      } finally {
        // Without this the whole batch's documents stay in WASM memory, which
        // a folder of several hundred files notices.
        doc.free()
      }
    },

    dispose() {
      engine = null
    },
  }
}
