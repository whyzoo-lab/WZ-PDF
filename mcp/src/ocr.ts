import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAppExecutable, runApp } from './hwp.js'
import { pictureExtension } from './docText.js'
import { tidyLines } from '../../src/services/ooxmlText.js'

/**
 * OCR for `doc_get_text`, by the desktop app.
 *
 * The recognizer is the viewer's own (PaddleOCR with the Korean model, run in
 * the app's Chromium), so this delegates exactly as `doc_to_pdf` does: the
 * app is started with `--ocr-json <request> <result>` (electron/ocrJob.ts) and
 * recognizes in a window that is never shown (src/services/docOcr.ts).
 *
 * Two uses:
 * - pages: a PDF, HWP or picture file is sent as it is, with the pages to
 *   look at; the app recognizes those without text of their own, and in
 *   'images' mode also the pictures on pages that have text.
 * - pictures: Word, PowerPoint, sheets and mail are read here, so their
 *   pictures are taken out of the file, written to a scratch folder and sent
 *   one by one.
 */

export type OcrMode = 'auto' | 'images'

export interface OcrPage { page: number; hasText: boolean; lines: string[] }

export interface OcrFileResult {
  path: string
  numPages: number
  pages: OcrPage[]
  pending: number[]
  error?: string
}

export interface OcrRequest { path: string; pages?: number[]; mode: OcrMode; maxPages?: number }

/** Pictures sent in one call. A deck of screenshots is dozens; past this, the rest are reported. */
export const MAX_PICTURES = 60
/** A picture larger than this is not a document's figure; it is skipped. */
export const MAX_PICTURE_BYTES = 20 * 1024 * 1024

const serverDir = () => dirname(fileURLToPath(import.meta.url))

/** Run the app's OCR over these files and return what it recognized, in order. */
export async function runOcr(requests: OcrRequest[], fromDir = serverDir()): Promise<OcrFileResult[]> {
  if (requests.length === 0) return []
  const exe = findAppExecutable(fromDir)
  const scratch = await mkdtemp(join(tmpdir(), 'wzpdf-mcp-ocr-'))
  try {
    const requestPath = join(scratch, 'request.json')
    const resultPath = join(scratch, 'result.json')
    await writeFile(requestPath, JSON.stringify({ files: requests }), 'utf8')
    const run = await runApp(exe, ['--ocr-json', requestPath, resultPath])
    let parsed: { files?: OcrFileResult[] }
    try {
      parsed = JSON.parse(await readFile(resultPath, 'utf8'))
    } catch {
      const detail = (run.stderr || run.stdout).trim().split('\n').slice(-3).join(' ')
      throw new Error(`OCR failed${detail ? `: ${detail}` : ` (exit ${run.code})`}`)
    }
    return parsed.files ?? []
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
  }
}

export interface Picture { key: string; bytes: Uint8Array }

/**
 * Recognize pictures, each as one document; the text of each by its key.
 * Formats the recognizer cannot read (EMF, WMF, SVG) and oversized ones are
 * left out, and so are those past MAX_PICTURES — `skipped` counts both.
 */
export async function recognizePictures(
  pictures: Picture[],
  fromDir = serverDir(),
): Promise<{ text: Map<string, string[]>; skipped: number; failed: number }> {
  const text = new Map<string, string[]>()
  const readable = pictures.filter(p => p.bytes.length <= MAX_PICTURE_BYTES && pictureExtension(p.bytes))
  const sent = readable.slice(0, MAX_PICTURES)
  const skipped = pictures.length - sent.length
  if (sent.length === 0) return { text, skipped, failed: 0 }
  const scratch = await mkdtemp(join(tmpdir(), 'wzpdf-mcp-pictures-'))
  try {
    const paths = await Promise.all(sent.map(async (p, i) => {
      const path = join(scratch, `picture-${String(i + 1).padStart(3, '0')}.${pictureExtension(p.bytes)}`)
      await writeFile(path, p.bytes)
      return path
    }))
    const results = await runOcr(paths.map(path => ({ path, mode: 'auto' as const })), fromDir)
    let failed = 0
    sent.forEach((p, i) => {
      const r = results[i]
      if (!r || r.error) { failed++; return }
      text.set(p.key, r.pages.flatMap(page => page.lines))
    })
    return { text, skipped, failed }
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ── Marking pictures in text ────────────────────────────────────────────────

/** A private-use character: never in a document's text, and not a control character. */
const MARK = ''

/**
 * Where pictures stand in a text read out of a document. `mark` is handed to
 * the readers (docxText, pptxText) and returns a marker for a picture's part,
 * one per part however often it is used; `fill` puts each picture's text
 * where it first stands and drops the rest of the markers.
 */
export class PictureMarks {
  readonly parts: string[] = []

  mark = (part: string): string => {
    let i = this.parts.indexOf(part)
    if (i < 0) { i = this.parts.length; this.parts.push(part) }
    return `${MARK}${i}${MARK}`
  }

  /** The parts marked in `text`, in order of first appearance. */
  partsIn(text: string): string[] {
    const seen = new Set<number>()
    for (const m of text.matchAll(/(\d+)/g)) seen.add(Number(m[1]))
    return [...seen].map(i => this.parts[i]).filter(Boolean)
  }

  fill(text: string, recognized: ReadonlyMap<string, string[]>): string {
    const done = new Set<number>()
    return tidyLines(text
      .replace(/(\d+)/g, (_, n: string) => {
        const i = Number(n)
        if (done.has(i)) return ''
        done.add(i)
        const lines = recognized.get(this.parts[i])
        return lines?.length ? `\n${pictureBlock(lines)}\n` : ''
      }))
  }

  static strip(text: string): string {
    return tidyLines(text.replace(/\d+/g, ''))
  }
}

/** Text OCR recognized in a picture, marked as such for the reader. */
export function pictureBlock(lines: readonly string[], what = 'image'): string {
  return `[OCR: ${what}]\n${lines.join('\n')}\n[/OCR]`
}
