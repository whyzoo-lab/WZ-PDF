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

/** Parse HWP/HWPX bytes into a renderable document.
 *
 *  Korean faces are settled first: rhwp draws straight to a canvas, and canvas
 *  uses only fonts that are already loaded — so a face fetched afterwards would
 *  miss the first render. See hwpFonts.ts; it is a no-op on machines that
 *  already have Korean fonts. */
export async function loadHwp(bytes: ArrayBuffer): Promise<HwpDocument> {
  const { ensureKoreanFonts } = await import('./hwpFonts')
  await Promise.all([ensureInit(), ensureKoreanFonts()])
  return new HwpDocument(new Uint8Array(bytes))
}
