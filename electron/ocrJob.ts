import fs from 'node:fs/promises'
import { withTimeout } from './convertRunner'
import { openCliWindow } from './pdfCliBackend'

/**
 * `WZ PDF.exe --ocr-json <request.json> <result.json>` — the MCP server's
 * OCR (mcp/src/ocr.ts), not a console tool.
 *
 * Recognition needs the renderer: the engine is onnxruntime-web with the
 * viewer's models, and pages are drawn on a canvas. So, like `topdf`, this
 * opens the app page in a window that is never shown and drives
 * src/services/docOcr.ts there, one file at a time; the answers are written
 * to `result.json` as `{ files: DocOcrResult[] }`.
 *
 * Files go through the renderer's `readFile`, i.e. the same checks as opening
 * them in the app (extension, signature, size).
 */

export const OCR_JOB_FLAG = '--ocr-json'

/** The recognizer's models and runtime load once (~2 s warm, more cold). */
const WARMUP_TIMEOUT_MS = 300_000
/** One document — up to `maxPages` pages at a few seconds each. */
const PER_FILE_TIMEOUT_MS = 900_000

export interface OcrFileRequest {
  path: string
  pages?: number[]
  mode: 'auto' | 'images'
  maxPages?: number
}

/** The request file, checked: anything malformed is refused before any window opens. */
export function parseOcrRequest(json: string): OcrFileRequest[] {
  const data = JSON.parse(json) as { files?: unknown }
  if (!data || !Array.isArray(data.files)) throw new Error('request must be { files: [...] }')
  return data.files.map((raw, i) => {
    const f = raw as Record<string, unknown>
    if (!f || typeof f.path !== 'string' || !f.path) throw new Error(`files[${i}].path must be a string`)
    if (f.mode !== 'auto' && f.mode !== 'images') throw new Error(`files[${i}].mode must be "auto" or "images"`)
    const out: OcrFileRequest = { path: f.path, mode: f.mode }
    if (f.pages !== undefined) {
      if (!Array.isArray(f.pages) || !f.pages.every(n => Number.isInteger(n))) {
        throw new Error(`files[${i}].pages must be whole numbers`)
      }
      out.pages = f.pages as number[]
    }
    if (f.maxPages !== undefined) {
      if (!Number.isInteger(f.maxPages) || (f.maxPages as number) < 1) throw new Error(`files[${i}].maxPages must be a positive whole number`)
      out.maxPages = f.maxPages as number
    }
    return out
  })
}

export async function runOcrJob(argv: readonly string[], loadUrl: string): Promise<number> {
  const at = argv.indexOf(OCR_JOB_FLAG)
  const requestPath = argv[at + 1]
  const resultPath = argv[at + 2]
  if (!requestPath || !resultPath) {
    process.stderr.write(`usage: ${OCR_JOB_FLAG} <request.json> <result.json>\n`)
    return 2
  }
  const files = parseOcrRequest(await fs.readFile(requestPath, 'utf8'))

  const win = await openCliWindow(loadUrl)
  try {
    await withTimeout(win.webContents.executeJavaScript('window.__wzCli.ocrWarmup()'), WARMUP_TIMEOUT_MS, 'OCR startup')
    const results: unknown[] = []
    for (const file of files) {
      try {
        const json = await withTimeout(
          win.webContents.executeJavaScript(`window.__wzCli.ocr(${JSON.stringify(file)})`) as Promise<string>,
          PER_FILE_TIMEOUT_MS,
          'OCR',
        )
        results.push(JSON.parse(json))
      } catch (error) {
        // One unreadable picture must not cost the rest of the document.
        const message = error instanceof Error ? error.message : String(error)
        results.push({ path: file.path, numPages: 0, pages: [], pending: [], error: message })
      }
    }
    await fs.writeFile(resultPath, JSON.stringify({ files: results }), 'utf8')
    return 0
  } finally {
    win.destroy()
  }
}
