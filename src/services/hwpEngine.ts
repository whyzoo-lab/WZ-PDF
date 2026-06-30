import init, { HwpDocument } from '@rhwp/core'

let initPromise: Promise<void> | null = null

export function __resetHwpForTests() { initPromise = null }

/** Resolve the rhwp wasm URL. Prod: bundled next to the app (offline, app://);
 *  dev: Vite serves the package file from node_modules. Resolved against the
 *  document so it works under Electron file://-style app:// loads too. */
function wasmUrl(): string {
  const base = new URL('./', document.baseURI).href
  return import.meta.env.DEV
    ? new URL('@rhwp/core/rhwp_bg.wasm', import.meta.url).href
    : `${base}hwp/rhwp_bg.wasm`
}

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init(wasmUrl()).then(() => undefined).catch(err => {
      initPromise = null
      throw new Error(`HWP engine failed to load: ${err instanceof Error ? err.message : String(err)}`)
    })
  }
  return initPromise
}

/** Parse HWP/HWPX bytes into a renderable document. */
export async function loadHwp(bytes: ArrayBuffer): Promise<HwpDocument> {
  await ensureInit()
  return new HwpDocument(new Uint8Array(bytes))
}
