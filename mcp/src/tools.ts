/**
 * MCP tool definitions + implementations for WZ PDF.
 *
 * Each entry in `tools` is the public-facing schema Claude sees; the matching
 * function in `handlers` does the actual work. Keeping them paired here means
 * adding a new tool is a single edit in one file.
 *
 * All file paths are absolute (or relative to the MCP server's CWD). Outputs
 * are written to disk and the tool returns a short text summary suitable for
 * Claude to relay to the user.
 */

import { readFile, writeFile, realpath, stat } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { resolve, basename, dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { PDFDocument, PDFFont, StandardFonts, rgb, degrees } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { pdfjs, pdfWorkerSrc } from './pdfjs.js'

import { convertHwpToPdf, pdfNameFor } from './hwp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// ── Sandbox ─────────────────────────────────────────────────────────────────
// When the MCP server is deployed remotely (HTTP transport), all file paths
// passed by the caller MUST be confined to a single workspace directory.
// Otherwise any user with the URL can read/write arbitrary files on the host.
//
// Set MCP_SANDBOX_DIR to enable enforcement. When unset (local stdio mode)
// paths are honoured as-is — matching the original single-user behaviour.
const SANDBOX_DIR = process.env.MCP_SANDBOX_DIR
  ? realpathSync(resolve(process.env.MCP_SANDBOX_DIR))
  : null

/** Resolve a caller-supplied path, clamped to the sandbox when configured. */
function lexicalSafePath(p: string): string {
  if (!p || typeof p !== 'string') throw new Error('invalid path')
  if (!SANDBOX_DIR) return resolve(p)
  // Treat caller paths as relative TO the sandbox so they can't escape via
  // absolute paths or `..`. After resolve, verify containment.
  const cleaned = p.replace(/^[A-Za-z]:[/\\]+/, '').replace(/^[/\\]+/, '')
  const abs = resolve(SANDBOX_DIR, cleaned)
  if (
    abs !== SANDBOX_DIR &&
    !abs.startsWith(SANDBOX_DIR + (process.platform === 'win32' ? '\\' : '/'))
  ) {
    throw new Error(`path escapes sandbox: ${p}`)
  }
  return abs
}

const MAX_DOCUMENT_BYTES = 500 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

function assertInsideSandbox(abs: string, original: string): void {
  if (!SANDBOX_DIR) return
  const separator = process.platform === 'win32' ? '\\' : '/'
  if (abs !== SANDBOX_DIR && !abs.startsWith(SANDBOX_DIR + separator)) {
    throw new Error(`path escapes sandbox: ${original}`)
  }
}

/** Resolve symlinks and bound file size before loading caller-controlled data. */
async function readInputFile(p: string, maxBytes = MAX_DOCUMENT_BYTES): Promise<Buffer> {
  const canonical = await realpath(lexicalSafePath(p))
  assertInsideSandbox(canonical, p)
  const info = await stat(canonical)
  if (!info.isFile()) throw new Error(`not a regular file: ${p}`)
  if (info.size > maxBytes) {
    throw new Error(`file exceeds ${Math.round(maxBytes / 1024 / 1024)}MB limit`)
  }
  return readFile(canonical)
}

/** Validate an output and its real parent to prevent sandbox symlink escapes. */
async function resolveOutputPath(p: string): Promise<string> {
  const candidate = lexicalSafePath(p)
  try {
    const canonical = await realpath(candidate)
    assertInsideSandbox(canonical, p)
    return canonical
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = await realpath(dirname(candidate))
    assertInsideSandbox(parent, p)
    return resolve(parent, basename(candidate))
  }
}

// pdfjs needs `workerSrc` pointed at the legacy worker file. In Node it's not
// actually run in a Worker (no native Web Worker) — pdfjs spawns a fake worker
// on the main thread by dynamic-import()ing the worker module. That import
// requires a file:// URL on Windows (a bare `D:\…` path is rejected by the
// ESM loader), so we resolve to a path and convert via pathToFileURL.
;(
  pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
).GlobalWorkerOptions.workerSrc = pdfWorkerSrc

// ── Common helpers ──────────────────────────────────────────────────────────

// Korean font location. Override via MCP_KOREAN_FONT_PATH when deploying
// outside the WZ PDF monorepo (e.g. the standalone MCP server on a remote host).
// Default assumes the path used by the local stdio mode (../../public/fonts).
const KOREAN_FONT_PATH = process.env.MCP_KOREAN_FONT_PATH
  ? resolve(process.env.MCP_KOREAN_FONT_PATH)
  : resolve(__dirname, '../../public/fonts/NotoSansKR-Regular.otf')

let _koFontBytes: Buffer | null = null
async function getKoreanFontBytes(): Promise<Buffer> {
  if (_koFontBytes) return _koFontBytes
  _koFontBytes = await readFile(KOREAN_FONT_PATH)
  return _koFontBytes
}

function hasNonLatin(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) return true
  return false
}

async function loadPdf(file: string): Promise<{ doc: PDFDocument; bytes: Uint8Array }> {
  const bytes = await readInputFile(file)
  const doc = await PDFDocument.load(bytes)
  return { doc, bytes }
}

async function savePdf(doc: PDFDocument, out: string): Promise<string> {
  const bytes = await doc.save()
  const abs = await resolveOutputPath(out)
  await writeFile(abs, bytes)
  return abs
}

/** Embed Helvetica + Noto Sans KR (lazy) and return a per-text picker. */
async function dualFont(doc: PDFDocument) {
  const helvetica = await doc.embedFont(StandardFonts.Helvetica)
  let ko: PDFFont | null = null
  const ensureKo = async (): Promise<PDFFont> => {
    if (ko) return ko
    doc.registerFontkit(fontkit)
    const bytes = await getKoreanFontBytes()
    ko = await doc.embedFont(bytes, { subset: true })
    return ko
  }
  return async (text: string): Promise<PDFFont> => (hasNonLatin(text) ? ensureKo() : helvetica)
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
}

// ── Tool: pdf_info ──────────────────────────────────────────────────────────

async function pdfInfo(args: { file: string }): Promise<string> {
  const { doc } = await loadPdf(args.file)
  const pages = doc.getPages()
  const sizes = pages.map((p, i) => {
    const { width, height } = p.getSize()
    return `  Page ${i + 1}: ${width.toFixed(0)} × ${height.toFixed(0)} pt`
  })
  const title = doc.getTitle() ?? '(none)'
  const author = doc.getAuthor() ?? '(none)'
  const subject = doc.getSubject() ?? '(none)'
  return [
    `File: ${args.file}`,
    `Pages: ${pages.length}`,
    `Title: ${title}`,
    `Author: ${author}`,
    `Subject: ${subject}`,
    ...sizes.slice(0, 10),
    ...(sizes.length > 10 ? [`  … and ${sizes.length - 10} more`] : []),
  ].join('\n')
}

// ── Tool: pdf_get_text ──────────────────────────────────────────────────────

async function pdfGetText(args: { file: string; pages?: number[] }): Promise<string> {
  const bytes = await readInputFile(args.file)
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: true,
  })
  const pdf = await loadingTask.promise
  try {
    const targetPages = args.pages ?? Array.from({ length: pdf.numPages }, (_, i) => i + 1)

    const sections: string[] = []
    for (const pageNum of targetPages) {
      if (pageNum < 1 || pageNum > pdf.numPages) continue
      const page = await pdf.getPage(pageNum)
      const content = await page.getTextContent()
      const text = content.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ')
        .trim()
      sections.push(`── Page ${pageNum} ──\n${text}`)
    }
    return sections.join('\n\n')
  } finally {
    await pdf.destroy()
  }
}

// ── Tool: pdf_search ────────────────────────────────────────────────────────

async function pdfSearch(args: {
  file: string
  query: string
  caseSensitive?: boolean
}): Promise<string> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) throw new Error('query must not be empty')
  const bytes = await readInputFile(args.file)
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    useSystemFonts: true,
  }).promise

  try {
    const needle = args.caseSensitive ? query : query.toLowerCase()
    const hits: string[] = []
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      const content = await page.getTextContent()
      const text = content.items.map(it => ('str' in it ? it.str : '')).join(' ')
      const haystack = args.caseSensitive ? text : text.toLowerCase()
      let from = 0
      while (true) {
        const idx = haystack.indexOf(needle, from)
        if (idx < 0) break
        const ctxStart = Math.max(0, idx - 40)
        const ctxEnd = Math.min(text.length, idx + needle.length + 40)
        const snippet = text.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim()
        hits.push(`p.${p}: …${snippet}…`)
        from = idx + needle.length
      }
    }
    if (hits.length === 0) return `No matches for "${query}".`
    return `${hits.length} match(es) for "${query}":\n${hits.join('\n')}`
  } finally {
    await pdf.destroy()
  }
}

// ── Tool: pdf_add_watermark ─────────────────────────────────────────────────

async function pdfAddWatermark(args: {
  file: string
  output: string
  text: string
  fontSize?: number
  color?: string
  opacity?: number
  rotation?: number
}): Promise<string> {
  const { doc } = await loadPdf(args.file)
  const pickFont = await dualFont(doc)
  const font = await pickFont(args.text)
  const fontSize = args.fontSize ?? 60
  const [r, g, b] = hexToRgb(args.color ?? '#888888')
  const opacity = args.opacity ?? 0.3
  const rot = args.rotation ?? -30

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    const textWidth = font.widthOfTextAtSize(args.text, fontSize)
    page.drawText(args.text, {
      x: (width - textWidth) / 2,
      y: height / 2 - fontSize / 2,
      size: fontSize,
      font,
      color: rgb(r, g, b),
      opacity,
      rotate: degrees(rot),
    })
  }
  const path = await savePdf(doc, args.output)
  return `Watermarked ${doc.getPageCount()} page(s) → ${path}`
}

// ── Tool: pdf_add_stamp ─────────────────────────────────────────────────────

async function pdfAddStamp(args: {
  file: string
  output: string
  image: string // path to PNG/JPG
  page: number
  x: number // PDF points from left
  y: number // PDF points from BOTTOM (pdf-lib convention)
  width: number
  height: number
  rotation?: number
}): Promise<string> {
  const { doc } = await loadPdf(args.file)
  const imgBytes = await readInputFile(args.image, MAX_IMAGE_BYTES)

  // Validate by magic bytes, not just the filename extension — prevents
  // embedding a renamed non-image (or hostile payload) and gives a clear
  // error instead of pdf-lib throwing an opaque parse failure.
  const isPng =
    imgBytes[0] === 0x89 && imgBytes[1] === 0x50 && imgBytes[2] === 0x4e && imgBytes[3] === 0x47
  const isJpg = imgBytes[0] === 0xff && imgBytes[1] === 0xd8 && imgBytes[2] === 0xff
  if (!isPng && !isJpg) {
    throw new Error('image must be a PNG or JPEG (validated by file signature)')
  }
  const image = isJpg ? await doc.embedJpg(imgBytes) : await doc.embedPng(imgBytes)
  const page = doc.getPage(args.page - 1)
  page.drawImage(image, {
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
    rotate: degrees(args.rotation ?? 0),
  })
  const path = await savePdf(doc, args.output)
  return `Stamped page ${args.page} → ${path}`
}

// ── Tool: pdf_add_text_overlay ──────────────────────────────────────────────

async function pdfAddTextOverlay(args: {
  file: string
  output: string
  page: number
  x: number
  y: number // pdf-lib bottom-up origin
  width: number
  height: number
  text: string
  fontSize?: number
  color?: string // text color, default #000000
  background?: string // hidden underlying text, default #FFFFFF
}): Promise<string> {
  const { doc } = await loadPdf(args.file)
  const pickFont = await dualFont(doc)
  const font = await pickFont(args.text)
  const page = doc.getPage(args.page - 1)
  const [br, bg, bb] = hexToRgb(args.background ?? '#FFFFFF')
  const [fr, fg, fb] = hexToRgb(args.color ?? '#000000')
  const fontSize = args.fontSize ?? Math.max(8, args.height * 0.7)

  page.drawRectangle({
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
    color: rgb(br, bg, bb),
  })
  page.drawText(args.text, {
    x: args.x + 2,
    y: args.y + args.height * 0.2,
    size: fontSize,
    font,
    color: rgb(fr, fg, fb),
  })
  const path = await savePdf(doc, args.output)
  return `Text overlay added on page ${args.page} → ${path}`
}

// ── Tool: pdf_split ─────────────────────────────────────────────────────────

async function pdfSplit(args: {
  file: string
  outputDir: string
  ranges?: string // "1-3,5,10-12" — if omitted, splits each page into its own file
}): Promise<string> {
  const { doc } = await loadPdf(args.file)
  const total = doc.getPageCount()
  const base = basename(args.file, '.pdf')

  type Range = { name: string; pages: number[] }
  const ranges: Range[] = []

  if (!args.ranges) {
    for (let p = 1; p <= total; p++) {
      ranges.push({ name: `${base}_p${p}.pdf`, pages: [p] })
    }
  } else {
    const parts = args.ranges
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    for (const part of parts) {
      const m = /^(\d+)(?:-(\d+))?$/.exec(part)
      if (!m) throw new Error(`invalid range: ${part}`)
      const a = Number(m[1])
      const b = m[2] ? Number(m[2]) : a
      const lo = Math.min(a, b),
        hi = Math.max(a, b)
      const pages: number[] = []
      for (let p = lo; p <= hi; p++) {
        if (p >= 1 && p <= total) pages.push(p)
      }
      ranges.push({ name: `${base}_${lo}-${hi}.pdf`, pages })
    }
  }

  const written: string[] = []
  for (const r of ranges) {
    const out = await PDFDocument.create()
    const copied = await out.copyPages(
      doc,
      r.pages.map(p => p - 1),
    )
    copied.forEach(p => out.addPage(p))
    const bytes = await out.save()
    const path = await resolveOutputPath(`${args.outputDir}/${r.name}`)
    await writeFile(path, bytes)
    written.push(path)
  }
  return `Wrote ${written.length} file(s):\n${written.map(p => `  ${p}`).join('\n')}`
}

// ── Tool: pdf_merge ─────────────────────────────────────────────────────────

async function pdfMerge(args: { files: string[]; output: string }): Promise<string> {
  if (!args.files?.length) throw new Error('files[] is empty')
  const out = await PDFDocument.create()
  for (const f of args.files) {
    const bytes = await readInputFile(f)
    const src = await PDFDocument.load(bytes)
    const copied = await out.copyPages(src, src.getPageIndices())
    copied.forEach(p => out.addPage(p))
  }
  const path = await savePdf(out, args.output)
  return `Merged ${args.files.length} file(s) (${out.getPageCount()} pages) → ${path}`
}

// ── Tool: pdf_delete_pages ──────────────────────────────────────────────────

async function pdfDeletePages(args: {
  file: string
  output: string
  pages: number[]
}): Promise<string> {
  const { doc } = await loadPdf(args.file)
  // Remove in descending order so indices stay valid.
  const sorted = [...args.pages].sort((a, b) => b - a)
  for (const p of sorted) {
    if (p >= 1 && p <= doc.getPageCount()) doc.removePage(p - 1)
  }
  const path = await savePdf(doc, args.output)
  return `Deleted ${args.pages.length} page(s) → ${path} (${doc.getPageCount()} remaining)`
}

// ── Tool: pdf_reorder_pages ─────────────────────────────────────────────────

async function pdfReorderPages(args: {
  file: string
  output: string
  newOrder: number[]
}): Promise<string> {
  const { doc } = await loadPdf(args.file)
  const total = doc.getPageCount()
  if (args.newOrder.length !== total) {
    throw new Error(`newOrder must have ${total} entries, got ${args.newOrder.length}`)
  }
  const fresh = await PDFDocument.create()
  const copied = await fresh.copyPages(
    doc,
    args.newOrder.map(p => p - 1),
  )
  copied.forEach(p => fresh.addPage(p))
  const path = await savePdf(fresh, args.output)
  return `Reordered ${total} pages → ${path}`
}

// ── Tool: pdf_insert_blank ──────────────────────────────────────────────────

async function pdfInsertBlank(args: {
  file: string
  output: string
  afterPage: number // 0 to prepend
  width?: number // PDF points; defaults to A4
  height?: number
}): Promise<string> {
  const { doc } = await loadPdf(args.file)
  const w = args.width ?? 595
  const h = args.height ?? 842
  doc.insertPage(args.afterPage, [w, h])
  const path = await savePdf(doc, args.output)
  return `Inserted blank page after position ${args.afterPage} → ${path}`
}

// ── Registry ────────────────────────────────────────────────────────────────

export const tools = [
  {
    name: 'pdf_info',
    description: 'Get page count, dimensions, and metadata for a PDF.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'Absolute path to the PDF.' } },
      required: ['file'],
    },
  },
  {
    name: 'pdf_get_text',
    description: 'Extract text content from a PDF. Optionally limit to specific pages.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path to the PDF.' },
        pages: {
          type: 'array',
          items: { type: 'number' },
          description: 'Page numbers (1-based). Omit for all.',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'pdf_search',
    description:
      'Search for a query string across all pages; returns matches with surrounding context.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        query: { type: 'string', description: 'Text to search for.' },
        caseSensitive: { type: 'boolean', description: 'Default false.' },
      },
      required: ['file', 'query'],
    },
  },
  {
    name: 'pdf_add_watermark',
    description: 'Apply a diagonal text watermark to every page. Korean supported.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        output: { type: 'string', description: 'Output PDF path.' },
        text: { type: 'string' },
        fontSize: { type: 'number', description: 'PDF points, default 60.' },
        color: { type: 'string', description: 'Hex color, default #888888.' },
        opacity: { type: 'number', description: '0–1, default 0.3.' },
        rotation: { type: 'number', description: 'Degrees, default -30.' },
      },
      required: ['file', 'output', 'text'],
    },
  },
  {
    name: 'pdf_add_stamp',
    description: 'Place a PNG/JPG image (stamp/signature) at a specific position on a page.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        output: { type: 'string' },
        image: { type: 'string', description: 'Path to PNG or JPG.' },
        page: { type: 'number', description: '1-based page number.' },
        x: { type: 'number', description: 'PDF points from left.' },
        y: { type: 'number', description: 'PDF points from BOTTOM (pdf-lib origin).' },
        width: { type: 'number' },
        height: { type: 'number' },
        rotation: { type: 'number', description: 'Degrees, default 0.' },
      },
      required: ['file', 'output', 'image', 'page', 'x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'pdf_add_text_overlay',
    description:
      'Cover an area with a filled rectangle and draw new text on top (WZ PDF textEdit). Korean supported.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        output: { type: 'string' },
        page: { type: 'number', description: '1-based.' },
        x: { type: 'number' },
        y: { type: 'number', description: 'PDF points from BOTTOM.' },
        width: { type: 'number' },
        height: { type: 'number' },
        text: { type: 'string' },
        fontSize: { type: 'number' },
        color: { type: 'string', description: 'Hex, default #000000.' },
        background: { type: 'string', description: 'Hex, default #FFFFFF.' },
      },
      required: ['file', 'output', 'page', 'x', 'y', 'width', 'height', 'text'],
    },
  },
  {
    name: 'pdf_split',
    description: 'Split a PDF into multiple files. With no ranges, each page becomes its own file.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        outputDir: { type: 'string', description: 'Existing directory to write output PDFs to.' },
        ranges: {
          type: 'string',
          description: 'Comma-separated ranges, e.g. "1-3,5,10-12". Omit to split per page.',
        },
      },
      required: ['file', 'outputDir'],
    },
  },
  {
    name: 'pdf_merge',
    description: 'Concatenate multiple PDFs in the given order.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'PDF paths in merge order.',
        },
        output: { type: 'string' },
      },
      required: ['files', 'output'],
    },
  },
  {
    name: 'pdf_delete_pages',
    description: 'Remove specified pages and save the result.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        output: { type: 'string' },
        pages: { type: 'array', items: { type: 'number' }, description: '1-based page numbers.' },
      },
      required: ['file', 'output', 'pages'],
    },
  },
  {
    name: 'pdf_reorder_pages',
    description: 'Rearrange pages. newOrder length must match total pages.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        output: { type: 'string' },
        newOrder: {
          type: 'array',
          items: { type: 'number' },
          description: '1-based permutation of all pages.',
        },
      },
      required: ['file', 'output', 'newOrder'],
    },
  },
  {
    name: 'pdf_insert_blank',
    description: 'Insert a blank page after the given position (0 to prepend).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        output: { type: 'string' },
        afterPage: { type: 'number', description: '0-based: 0 prepends, N inserts after page N.' },
        width: { type: 'number', description: 'PDF points; default A4 width 595.' },
        height: { type: 'number', description: 'PDF points; default A4 height 842.' },
      },
      required: ['file', 'output', 'afterPage'],
    },
  },
  {
    name: 'hwp_to_pdf',
    description:
      'Convert a Korean HWP or HWPX document to PDF. The result carries a real selectable text layer, '
      + 'so pdf_get_text and pdf_search work on it afterwards. Requires the WZ PDF desktop app.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path to the .hwp or .hwpx document.' },
        output: { type: 'string', description: 'Where to write the PDF. Defaults to the same name beside the input.' },
      },
      required: ['file'],
    },
  },
]

/**
 * Convert a Korean HWP/HWPX document to PDF.
 *
 * Delegates to the desktop app (see hwp.ts) because the conversion needs a
 * browser canvas. The resulting PDF carries a selectable text layer, so
 * `pdf_get_text` and `pdf_search` work on the output directly.
 */
async function hwpToPdf(args: Record<string, unknown>): Promise<string> {
  const file = String(args.file ?? '')
  if (!file) throw new Error('file is required')

  // Validated exactly like every other input: real path, inside the sandbox,
  // a regular file, and bounded in size.
  const input = await realpath(lexicalSafePath(file))
  assertInsideSandbox(input, file)
  const info = await stat(input)
  if (!info.isFile()) throw new Error(`not a regular file: ${file}`)
  if (info.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`file exceeds ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB limit`)
  }
  const ext = extname(input).toLowerCase()
  if (ext !== '.hwp' && ext !== '.hwpx') throw new Error(`not a HWP/HWPX document: ${file}`)

  const requested = args.output
    ? String(args.output)
    : join(dirname(input), pdfNameFor(input))
  const output = await resolveOutputPath(requested)

  const result = await convertHwpToPdf(input, output)
  return `Converted ${basename(input)} -> ${result.outputPath} `
    + `(${Math.round(result.bytes / 1024)} KB, selectable text)`
}

type ToolHandler = (args: Record<string, unknown>) => Promise<string>

const handlers = {
  pdf_info: pdfInfo,
  pdf_get_text: pdfGetText,
  pdf_search: pdfSearch,
  pdf_add_watermark: pdfAddWatermark,
  pdf_add_stamp: pdfAddStamp,
  pdf_add_text_overlay: pdfAddTextOverlay,
  pdf_split: pdfSplit,
  pdf_merge: pdfMerge,
  pdf_delete_pages: pdfDeletePages,
  pdf_reorder_pages: pdfReorderPages,
  pdf_insert_blank: pdfInsertBlank,
  hwp_to_pdf: hwpToPdf,
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const fn = handlers[name as keyof typeof handlers] as ToolHandler | undefined
  if (!fn) throw new Error(`Unknown tool: ${name}`)
  return fn(args)
}
