/**
 * Text out of the documents WZ Reader opens, for `doc_get_text` / `doc_info`.
 *
 * Everything here runs in this process, without the desktop app: Word and
 * PowerPoint are zips of XML whose text sits in known elements, spreadsheets
 * are read by hucre (the same reader the app uses), mail by the app's own
 * parser (services/emlParser.ts — it is what makes EUC-KR bodies and split
 * RFC 2047 subjects come out right), Markdown is text already. PDF goes
 * through pdfjs in tools.ts, and HWP — which needs the app's renderer — is
 * converted to PDF first, also in tools.ts.
 *
 * The output is for an agent to read, so it keeps structure that carries
 * meaning (slides, sheets, table cells as tabs) and drops everything else.
 */

import JSZip from 'jszip'
import { readXlsx, readXls } from 'hucre/xlsx'
import { readOds } from 'hucre/ods'
import { parseCsv } from 'hucre/csv'
import { formatValue } from 'hucre'
import type { Cell, CellValue, Sheet } from 'hucre'
import { parseEml } from '../../src/services/emlParser.js'
import {
  decodeEntities, joinPart, ooxmlText, pptxText, relsMap, tidyLines, zipText, type SlideText,
} from '../../src/services/ooxmlText.js'

export { ooxmlText, pptxText, type SlideText }

export type DocFormat = 'pdf' | 'hwp' | 'docx' | 'pptx' | 'sheet' | 'md' | 'eml' | 'image' | 'unknown'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff']
const SHEET_EXTS = ['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv', 'psv']
const MARKDOWN_EXTS = ['md', 'markdown', 'mdown', 'mkd']

/** Every extension doc_to_pdf / doc_get_text accept. */
export const DOCUMENT_EXTS = ['pdf', 'hwp', 'hwpx', 'docx', 'pptx', ...SHEET_EXTS, ...MARKDOWN_EXTS, 'eml', ...IMAGE_EXTS, 'zip']

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v)

/**
 * What a file is, by its first bytes where it has a signature and its
 * extension otherwise — the same order of trust as the app's detectDocType.
 */
export function detectFormat(name: string, bytes: Uint8Array): DocFormat {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf'
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return ext === 'xls' ? 'sheet' : 'hwp'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const head = Buffer.from(bytes.subarray(0, 256)).toString('latin1')
    if (head.includes('application/hwp+zip') || ext === 'hwpx') return 'hwp'
    const tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 256 * 1024))).toString('latin1')
    if (tail.includes('word/document.xml')) return 'docx'
    if (tail.includes('ppt/presentation.xml')) return 'pptx'
    if (tail.includes('xl/workbook.') || head.includes('opendocument.spreadsheet')) return 'sheet'
  }
  // A ZIP that is not an Office or HWPX document: a collection of pictures.
  if (IMAGE_EXTS.includes(ext) || ext === 'zip') return 'image'
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp'
  if (ext === 'docx') return 'docx'
  if (ext === 'pptx') return 'pptx'
  if (SHEET_EXTS.includes(ext)) return 'sheet'
  if (MARKDOWN_EXTS.includes(ext)) return 'md'
  if (ext === 'eml') return 'eml'
  return 'unknown'
}

/**
 * A picture the recognizer can read, by its first bytes: the extension it is
 * written out under for the app, or null (EMF, WMF, SVG and the rest).
 */
export function pictureExtension(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  if (startsWith(bytes, [0x42, 0x4d])) return 'bmp'
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'tif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP') return 'webp'
  return null
}

/** Strict UTF-8, else CP949 — Korean notes and CSVs are still often CP949. */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

// ── Word ────────────────────────────────────────────────────────────────────

export interface DocxText {
  text: string
  /** Pages as Word last counted them (docProps/app.xml), when it saved the file. */
  pages: number | null
}

/** With `picture`, each picture is written where it stands as what it returns for its part. */
export async function docxText(bytes: Uint8Array, picture?: (part: string) => string): Promise<DocxText> {
  const zip = await JSZip.loadAsync(bytes)
  const body = await zipText(zip, 'word/document.xml')
  if (body === null) throw new Error('not a Word document (no word/document.xml)')
  const app = await zipText(zip, 'docProps/app.xml')
  const pages = app ? Number(/<Pages>(\d+)<\/Pages>/.exec(app)?.[1] ?? NaN) : NaN
  const rels = picture ? relsMap(await zipText(zip, 'word/_rels/document.xml.rels')) : null
  const text = ooxmlText(body, 'w', picture && (rid => {
    const target = rels?.get(rid)?.target
    return target ? picture(joinPart('word', target)) : ''
  }))
  return { text, pages: Number.isFinite(pages) ? pages : null }
}

/**
 * The pictures placed on each sheet of an .xlsx, by sheet name, in the order
 * they are drawn: workbook → sheet → its drawing → the drawing's pictures.
 * Other workbook formats (.xls, .ods, CSV) give none.
 */
export async function sheetPictures(bytes: Uint8Array): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return out
  const zip = await JSZip.loadAsync(bytes)
  const book = await zipText(zip, 'xl/workbook.xml')
  if (book === null) return out
  const bookRels = relsMap(await zipText(zip, 'xl/_rels/workbook.xml.rels'))
  const relsOf = async (part: string) => {
    const name = part.split('/').pop()!
    return relsMap(await zipText(zip, `${part.slice(0, -name.length)}_rels/${name}.rels`))
  }
  const dirOf = (part: string) => part.split('/').slice(0, -1).join('/')
  for (const m of book.matchAll(/<sheet\b[^>]*>/g)) {
    const name = decodeEntities(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? '')
    const rid = /\br:id="([^"]*)"/.exec(m[0])?.[1] ?? ''
    const target = bookRels.get(rid)?.target
    if (!target) continue
    const sheet = joinPart('xl', target)
    const parts: string[] = []
    for (const rel of (await relsOf(sheet)).values()) {
      if (!rel.type.endsWith('/drawing')) continue
      const drawing = joinPart(dirOf(sheet), rel.target)
      const xml = await zipText(zip, drawing)
      if (xml === null) continue
      const drawingRels = await relsOf(drawing)
      for (const b of xml.matchAll(/<a:blip\b[^>]*\br:embed="([^"]*)"/g)) {
        const media = drawingRels.get(b[1])?.target
        if (media) parts.push(joinPart(dirOf(drawing), media))
      }
    }
    if (parts.length) out.set(name, parts)
  }
  return out
}

// ── Spreadsheets ────────────────────────────────────────────────────────────

export interface SheetText {
  name: string
  hidden: boolean
  /** 1-based, inclusive; 0 / 0 when the requested range is empty. */
  fromRow: number
  toRow: number
  /** Rows read; a lower bound when `more` is set. */
  rowCount: number
  /** The sheet continues past what was read. */
  more: boolean
  /** Tab-separated, one line per row. */
  text: string
}

function cellText(value: CellValue | undefined, cell: Cell | undefined): string {
  let v = value ?? null
  if (v === null && cell?.type === 'formula') v = cell.formulaResult ?? null
  if (v === null) return ''
  const fmt = cell?.style?.numFmt
  if ((typeof v === 'number' || v instanceof Date) && fmt && fmt.toLowerCase() !== 'general') {
    try { return formatValue(v, fmt) } catch { /* fall through */ }
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v).replace(/[\t\r\n]+/g, ' ')
}

export interface SheetRange {
  /** Name or 1-based index; omitted, every visible sheet. */
  sheet?: string | number
  /** 1-based first row. Default 1. */
  startRow?: number
  /** Rows per sheet. Default 500. */
  maxRows?: number
}

export async function sheetText(bytes: Uint8Array, name: string, range: SheetRange = {}): Promise<SheetText[]> {
  const start = Math.max(1, Math.floor(range.startRow ?? 1))
  const count = Math.max(1, Math.floor(range.maxRows ?? 500))
  // One row past the window is read to know whether the sheet goes on, and no
  // more: a 215,897-row export need not be read whole for its first page.
  const readRows = start - 1 + count + 1
  let sheets: Sheet[]
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    sheets = name.toLowerCase().endsWith('.xls')
      ? (await readXls(bytes)).sheets
      : (await readXlsx(bytes, { readStyles: true, maxRows: readRows })).sheets
  } else if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const head = Buffer.from(bytes.subarray(0, 256)).toString('latin1')
    sheets = head.includes('opendocument.spreadsheet')
      ? (await readOds(bytes, { readStyles: true, maxRows: readRows })).sheets
      : (await readXlsx(bytes, { readStyles: true, maxRows: readRows })).sheets
  } else {
    // TSV: tabs, PSV: pipes — named rather than detected (their text may hold commas).
    const delimiter = /\.tsv$/i.test(name) ? '\t' : /\.psv$/i.test(name) ? '|' : undefined
    const rows = parseCsv(decodeText(bytes), { typeInference: false, maxRows: readRows, delimiter })
    sheets = [{ name: name.replace(/\.[^.]+$/, '') || 'Sheet1', rows }]
  }

  const picked = range.sheet === undefined
    ? sheets.filter(s => !s.hidden && !s.veryHidden)
    : sheets.filter((s, i) => (typeof range.sheet === 'number' ? i + 1 === range.sheet : s.name === range.sheet))
  if (range.sheet !== undefined && picked.length === 0) {
    throw new Error(`no sheet ${JSON.stringify(range.sheet)}; sheets: ${sheets.map(s => s.name).join(', ')}`)
  }

  return picked.map(sheet => {
    const rows = sheet.rows ?? []
    // Trailing empty rows are layout, not data.
    let last = rows.length
    while (last > 0 && rows[last - 1].every(v => v === null || v === '')) last--
    const from = start - 1
    const to = Math.min(last, from + count)
    const lines: string[] = []
    for (let r = from; r < to; r++) {
      lines.push(rows[r].map((v, c) => cellText(v, sheet.cells?.get(`${r},${c}`))).join('\t').replace(/\t+$/, ''))
    }
    return {
      name: sheet.name,
      hidden: !!(sheet.hidden || sheet.veryHidden),
      fromRow: to > from ? from + 1 : 0,
      toRow: to > from ? to : 0,
      rowCount: last,
      more: last > to,
      text: lines.join('\n'),
    }
  })
}

// ── Mail ────────────────────────────────────────────────────────────────────

/**
 * The body without script, style and head elements. Found one at a time: as
 * one regular expression, each unclosed opening tag scanned to the end of the
 * message, and a message is the sender's to write.
 */
function withoutHiddenElements(html: string): string {
  const open = /<(script|style|head)\b/gi
  const unclosed = new Set<string>()
  let out = ''
  let kept = 0
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const tag = m[1].toLowerCase()
    if (unclosed.has(tag)) continue
    const close = new RegExp(`</${tag}>`, 'gi')
    close.lastIndex = open.lastIndex
    if (!close.exec(html)) { unclosed.add(tag); continue }
    out += html.slice(kept, m.index)
    kept = close.lastIndex
    open.lastIndex = kept
  }
  return out + html.slice(kept)
}

/** Visible text of an HTML body: blocks on their own lines, no markup. */
export function htmlToText(html: string): string {
  return tidyLines(decodeEntities(
    withoutHiddenElements(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, '\t')
      .replace(/<[^<>]+>/g, ''),
  ))
}

export interface EmailText {
  subject: string
  from: string
  to: string
  cc: string
  date: string
  attachments: Array<{ filename: string; size: number }>
  body: string
}

/**
 * A message's pictures: those shown in its body (inlined from cid: parts as
 * data: URLs by the parser) and picture attachments.
 */
export function emlPictures(bytes: Uint8Array): Array<{ name: string; bytes: Uint8Array }> {
  const mail = parseEml(bytes)
  const out: Array<{ name: string; bytes: Uint8Array }> = []
  let n = 0
  for (const m of (mail.html ?? '').matchAll(/data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)/gi)) {
    out.push({ name: `picture ${++n} in the message`, bytes: new Uint8Array(Buffer.from(m[1], 'base64')) })
  }
  for (const a of mail.attachments) {
    if (a.mimeType.toLowerCase().startsWith('image/') || pictureExtension(a.bytes)) out.push({ name: a.filename, bytes: a.bytes })
  }
  return out
}

export function emlText(bytes: Uint8Array): EmailText {
  const mail = parseEml(bytes)
  return {
    subject: mail.subject,
    from: mail.from,
    to: mail.to,
    cc: mail.cc,
    date: mail.date,
    attachments: mail.attachments.map(a => ({ filename: a.filename, size: a.size })),
    body: mail.text?.trim() || (mail.html ? htmlToText(mail.html) : ''),
  }
}
