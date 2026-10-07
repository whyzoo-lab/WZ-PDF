// src/services/sheetDoc.ts
//
// Spreadsheets (.xlsx/.xlsm, legacy .xls, .ods, .csv) → an HTML table, via hucre.
//
// hucre reads values, styles and merges; this module draws them the way Excel
// does closely enough to read a sheet: column widths and row heights, fonts,
// fills, borders, number formats, merged cells, text running over empty
// neighbours, column letters and row numbers.
//
// The table is generated here as a string (escaped by us, never from markup in
// the file), because a real sheet is tens of thousands of cells and DOM built
// through React for each would be the slow part of opening it. Every value the
// file controls that lands in a style attribute — colours, font names, sizes —
// is validated first, so a crafted file cannot write its own CSS.

import { readXlsx, readXls, resolveThemeColor } from 'hucre/xlsx'
import { readOds } from 'hucre/ods'
import { parseCsv } from 'hucre/csv'
import { formatValue, EncryptedFileError } from 'hucre'
import type {
  BorderSide, Cell, CellStyle, CellValue, Color, FontStyle, Sheet, Workbook,
} from 'hucre'

export type SheetFormat = 'xlsx' | 'xls' | 'ods' | 'csv'

export interface LoadedWorkbook {
  workbook: Workbook
  format: SheetFormat
}

/** Thrown for a workbook saved with a password ("암호로 보호된 통합 문서"). */
export class EncryptedWorkbookError extends Error {
  constructor() { super('encrypted workbook') }
}

const OLE2 = [0xD0, 0xCF, 0x11, 0xE0]
const ZIP = [0x50, 0x4B, 0x03, 0x04]
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v)

/**
 * Decode CSV text. Excel on Korean Windows writes CSV in CP949 without a BOM,
 * so a strict UTF-8 decode that throws is how those files are noticed — the
 * same rule Markdown uses.
 */
function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

/**
 * Read a workbook whole — every row. A 58 MB, 215,897 x 38 export takes ~9 s
 * (measured in Node; most of it inflating a 277 MB sheet part) and settles at
 * ~134 MB of heap. hucre drops per-cell styles on a sheet that large, so such a
 * sheet shows its values unstyled; nothing is left out.
 */
export async function loadWorkbook(bytes: ArrayBuffer, name: string): Promise<LoadedWorkbook> {
  const head = new Uint8Array(bytes.slice(0, 512))
  try {
    if (startsWith(head, OLE2)) {
      // An encrypted .xlsx is also an OLE2 container (EncryptionInfo +
      // EncryptedPackage), which readXls rejects; readXlsx recognises it.
      if (name.toLowerCase().endsWith('.xls')) {
        return { workbook: await readXls(new Uint8Array(bytes)), format: 'xls' }
      }
      return { workbook: await readXlsx(new Uint8Array(bytes), { readStyles: true }), format: 'xlsx' }
    }
    if (startsWith(head, ZIP)) {
      const ascii = new TextDecoder('latin1').decode(head)
      if (ascii.includes('application/vnd.oasis.opendocument.spreadsheet')) {
        return { workbook: await readOds(new Uint8Array(bytes), { readStyles: true }), format: 'ods' }
      }
      return { workbook: await readXlsx(new Uint8Array(bytes), { readStyles: true }), format: 'xlsx' }
    }
  } catch (err) {
    if (err instanceof EncryptedFileError) throw new EncryptedWorkbookError()
    throw err
  }
  // CSV: shown as written. Type inference would turn "007" into 7 and "1.50"
  // into 1.5 — a viewer should not reformat what is in the file.
  const rows = parseCsv(decodeText(bytes), { typeInference: false })
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
  for (const r of rows) while (r.length < width) r.push(null)
  const sheetName = name.replace(/\.[^.]+$/, '') || 'Sheet1'
  return { workbook: { sheets: [{ name: sheetName, rows }] }, format: 'csv' }
}

// ── Rendering ──────────────────────────────────────────────────────────────

/**
 * A sheet laid out for drawing: everything that is the same whichever rows are
 * on screen, plus `rows(from, to)` to draw any run of them. A 215,897-row
 * export cannot be one DOM table, and cutting it short is no answer in a
 * viewer meant for people without Excel — so the view draws the rows in sight
 * and stands spacers in for the rest (see SheetView).
 */
export interface SheetLayout {
  /** Nothing in the sheet at all (or a chart sheet). */
  empty: boolean
  /** Rows that are drawn (hidden rows are not). */
  rowCount: number
  /** Sheet row number (0-based) of each drawn row. */
  rowNumbers: number[]
  /** rowTop[i] = declared top of drawn row i below the header, px; length rowCount + 1. */
  rowTop: Float64Array
  /** Columns drawn, plus the row-number column (not when laid out for print). */
  columnCount: number
  /** Width of the whole table, px. */
  tableWidth: number
  /** `<table …><colgroup>…</colgroup><thead>…</thead>` — close with `</table>`. */
  tableOpen: string
  /** Drawn rows [from, to) as `<tr>` markup. */
  rows(from: number, to: number): string
  /**
   * The text shown in drawn row `ri`, drawn column `ci` — what find matches
   * against when the sheet is too large to be in the DOM at once. A cell a
   * merge covers reads as empty, so a merged value is found once.
   */
  textAt(ri: number, ci: number): string
}

export interface RenderedSheet {
  html: string
  empty: boolean
}

/** Index of the first element of a sorted array that is >= value. */
function lowerBound(sorted: ArrayLike<number>, value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** How many of a sorted array's values fall in [from, to]. */
const countIn = (sorted: number[], from: number, to: number) =>
  lowerBound(sorted, to + 1) - lowerBound(sorted, from)

// Excel's default palette for `indexed` colours (BIFF8, 0–63). 64 and 65 are
// "system foreground / background".
const INDEXED = (
  '000000FFFFFFFF000000FF000000FFFFFF00FF00FF00FFFF000000FFFFFFFF000000FF000000FFFFFF00FF00FF00FFFF' +
  '800000008000000080808000800080008080C0C0C0808080' +
  '9999FF993366FFFFCCCCFFFF660066FF8080' + '0066CCCCCCFF000080FF00FFFFFF0000FFFF800080800000008080' + '0000FF' +
  '00CCFFCCFFFFCCFFCCFFFF9999CCFFFF99CCCC99FFFFCC99' + '3366FF33CCCC99CC00FFCC00FF9900FF6600666699969696' +
  '003366339966003300333300993300993366333399333333'
).match(/.{6}/g) as string[]

const HEX6 = /^[0-9A-Fa-f]{6}$/

function cssColor(color: Color | undefined, theme: string[] | undefined): string | null {
  if (!color) return null
  let hex: string | null = null
  if (color.rgb) {
    const rgb = color.rgb.length === 8 ? color.rgb.slice(2) : color.rgb   // ARGB → RGB
    if (HEX6.test(rgb)) hex = rgb
  } else if (color.theme !== undefined && theme?.length) {
    try {
      const resolved = resolveThemeColor(theme, color.theme, color.tint).replace(/^#/, '')
      if (HEX6.test(resolved)) hex = resolved
    } catch { /* unknown theme slot */ }
  } else if (color.indexed !== undefined) {
    if (color.indexed === 64) hex = '000000'
    else if (color.indexed === 65) hex = 'FFFFFF'
    else hex = INDEXED[color.indexed] ?? null
  }
  return hex ? `#${hex.toLowerCase()}` : null
}

/** A font name safe to put inside a quoted CSS string. */
function fontName(name: string | undefined): string | null {
  if (!name) return null
  const safe = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim()
  return safe || null
}

function fontCss(font: FontStyle | undefined, theme: string[] | undefined): string {
  if (!font) return ''
  const out: string[] = []
  const family = fontName(font.name)
  if (family) out.push(`font-family:"${family}",var(--wz-sheet-font)`)
  if (typeof font.size === 'number' && font.size > 0 && font.size < 410) out.push(`font-size:${font.size}pt`)
  if (font.bold) out.push('font-weight:700')
  if (font.italic) out.push('font-style:italic')
  const lines = [font.underline ? 'underline' : '', font.strikethrough ? 'line-through' : ''].filter(Boolean)
  if (lines.length) out.push(`text-decoration:${lines.join(' ')}`)
  const color = cssColor(font.color, theme)
  if (color) out.push(`color:${color}`)
  if (font.vertAlign === 'superscript') out.push('vertical-align:super;font-size:smaller')
  if (font.vertAlign === 'subscript') out.push('vertical-align:sub;font-size:smaller')
  return out.join(';')
}

function fillColor(style: CellStyle | undefined, theme: string[] | undefined): string | null {
  const fill = style?.fill
  if (!fill) return null
  if (fill.type === 'pattern') {
    if (!fill.pattern || fill.pattern === 'none') return null
    // A patterned fill is drawn as its foreground: close enough to read by.
    return cssColor(fill.fgColor, theme) ?? cssColor(fill.bgColor, theme)
  }
  return cssColor(fill.stops[0]?.color, theme)
}

const BORDER_WEIGHT: Record<string, number> = {
  hair: 1, thin: 2, dotted: 2, dashed: 2, dashDot: 2, dashDotDot: 2,
  mediumDashed: 3, mediumDashDot: 3, mediumDashDotDot: 3, slantDashDot: 3,
  medium: 4, double: 5, thick: 6,
}

function borderCss(side: BorderSide, theme: string[] | undefined): string {
  const color = cssColor(side.color, theme) ?? '#000'
  switch (side.style) {
    case 'thick': return `3px solid ${color}`
    case 'double': return `3px double ${color}`
    case 'medium': return `2px solid ${color}`
    case 'mediumDashed': case 'mediumDashDot': case 'mediumDashDotDot': case 'slantDashDot':
      return `2px dashed ${color}`
    case 'dotted': return `1px dotted ${color}`
    case 'dashed': case 'dashDot': case 'dashDotDot': return `1px dashed ${color}`
    default: return `1px solid ${color}`
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** "A", "B", … "Z", "AA" … */
export function columnLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * Excel's "General": up to ~11 significant digits, scientific beyond that.
 * JavaScript's own `String(1/3)` prints 16 digits, which Excel never shows.
 */
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e11 || abs < 1e-9) {
    return value.toExponential(5).replace(/\.?0+e/, 'e').replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2')
  }
  return String(Number(value.toPrecision(10)))
}

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  const time = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()
    ? ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` : ''
  return date + time
}

/** What Excel would print in the cell. */
export function displayValue(value: CellValue | undefined, cell: Cell | undefined, is1904 = false): string {
  let v = value ?? null
  if (v === null && cell?.type === 'formula') v = cell.formulaResult ?? null
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  const numFmt = cell?.style?.numFmt
  const custom = numFmt && numFmt.toLowerCase() !== 'general' ? numFmt : null
  if (v instanceof Date) {
    if (custom) try { return formatValue(v, custom, { is1904 }) } catch { /* fall through */ }
    return isoDate(v)
  }
  if (typeof v === 'number') {
    if (custom) try { return formatValue(v, custom, { is1904 }) } catch { /* fall through */ }
    return formatGeneral(v)
  }
  return String(v)
}

const NUMERIC_TEXT = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?%?$/

/** Column width in Excel character units → pixels (Calibri 11, as Excel does). */
const colPx = (width: number) => Math.max(0, Math.round(width * 7 + 5))
/** Row height in points → pixels. */
const rowPx = (points: number) => Math.max(0, Math.round(points * 96 / 72))

interface Edge { css: string; weight: number }

/** Picture formats drawn from a sheet. SVG is left out: nothing needs it. */
const PICTURE_TYPES: Record<string, string> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/** Pixels from one row/column to another, counting only the visible ones. */
function spanPx(visible: number[], from: number, to: number, size: (i: number) => number): number {
  return visible.filter(i => i >= from && i < to).reduce((sum, i) => sum + size(i), 0)
}

/** Width of the row-number column. */
const ROW_HEADER_PX = 44

/** Draw a whole sheet as one table — for small sheets, print and tests. */
export interface LayoutOptions {
  /** Right-align numeric-looking text (CSV holds no types). */
  csv?: boolean
  /**
   * Lay out for paper, as Excel saves a PDF: no column letters or row
   * numbers, and no gridlines — only the borders the sheet itself draws.
   */
  print?: boolean
}

export function renderSheetHtml(sheet: Sheet, workbook: Workbook, opts: LayoutOptions = {}): RenderedSheet {
  const layout = layoutSheet(sheet, workbook, opts)
  if (layout.empty) return { html: '', empty: true }
  return { html: `${layout.tableOpen}<tbody>${layout.rows(0, layout.rowCount)}</tbody></table>`, empty: false }
}

/**
 * Lay one sheet out as a table.
 *
 * Borders follow Excel's model, not CSS's: each edge between two cells is
 * decided once — the heavier of what either cell says, else a gridline — and
 * drawn by one of them (the cell to its left or above), in a non-collapsing
 * table. CSS's own collapsing rules would settle a tie between an explicit
 * border and a gridline by position, dropping a thin border on the left side
 * of a cell; and in the separate model two cells that both carry the shared
 * border would draw it twice.
 */
export function layoutSheet(sheet: Sheet, workbook: Workbook, opts: LayoutOptions = {}): SheetLayout {
  const theme = workbook.themeColors
  const is1904 = workbook.dateSystem === '1904'
  const rows = sheet.rows ?? []
  const cells = sheet.cells ?? new Map<string, Cell>()
  const cellAt = (r: number, c: number) => cells.get(`${r},${c}`)

  // ── Extent: the last row and column with anything worth showing ──
  let lastRow = -1
  let lastCol = -1
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v !== null && v !== '') { if (r > lastRow) lastRow = r; if (c > lastCol) lastCol = c }
  }))
  for (const [key, cell] of cells) {
    const visible = cell.style?.fill || cell.style?.border || cell.richText?.length
      || (cell.type === 'formula' && cell.formulaResult != null)
    if (!visible) continue
    const [r, c] = key.split(',').map(Number)
    if (r > lastRow) lastRow = r
    if (c > lastCol) lastCol = c
  }
  // Pictures count too: a logo or a seal can sit beyond the last value.
  for (const img of sheet.images ?? []) {
    lastRow = Math.max(lastRow, img.anchor.from.row)
    lastCol = Math.max(lastCol, img.anchor.from.col)
  }
  for (const m of sheet.merges ?? []) {
    if (m.startRow <= lastRow && m.startCol <= lastCol) {
      lastRow = Math.max(lastRow, m.endRow)
      lastCol = Math.max(lastCol, m.endCol)
    }
  }
  if (lastRow < 0 || lastCol < 0 || sheet.kind && sheet.kind !== 'worksheet') {
    return {
      empty: true, rowCount: 0, rowNumbers: [], rowTop: new Float64Array(1), columnCount: 0, tableWidth: 0,
      tableOpen: '', rows: () => '', textAt: () => '',
    }
  }

  const columns = sheet.columns ?? []
  const visibleCols: number[] = []
  for (let c = 0; c <= lastCol; c++) if (!columns[c]?.hidden) visibleCols.push(c)
  const endRow = lastRow
  const visibleRows: number[] = []
  for (let r = 0; r <= endRow; r++) if (!sheet.rowDefs?.get(r)?.hidden) visibleRows.push(r)

  const colPos = new Map(visibleCols.map((c, i) => [c, i]))
  const rowIndex = (r: number) => {
    const i = lowerBound(visibleRows, r)
    return visibleRows[i] === r ? i : -1
  }

  // ── Merges → spans over visible rows/columns, and the cells they cover ──
  // A span's row count is worked out when it is drawn, because a run of rows
  // may start or stop part-way through it.
  const spans = new Map<string, { cs: number; endRow: number; endCol: number }>()
  const covered = new Map<string, string>()   // covered cell → its span's anchor
  for (const m of sheet.merges ?? []) {
    if (m.startRow > endRow) continue
    const mEndRow = Math.min(m.endRow, endRow)
    const rs = countIn(visibleRows, m.startRow, mEndRow)
    const cs = visibleCols.filter(c => c >= m.startCol && c <= m.endCol).length
    if (rs === 0 || cs === 0) continue
    // The span is anchored at the first *visible* cell of the range.
    const r0 = visibleRows[lowerBound(visibleRows, m.startRow)]
    const c0 = visibleCols.find(c => c >= m.startCol)!
    const anchor = `${r0},${c0}`
    for (let r = m.startRow; r <= mEndRow; r++) {
      for (let c = m.startCol; c <= m.endCol; c++) covered.set(`${r},${c}`, anchor)
    }
    covered.delete(anchor)
    spans.set(anchor, { cs, endRow: mEndRow, endCol: m.endCol })
  }

  // On screen, the sheet's view setting; on paper, its print setting, which
  // Excel leaves off unless asked.
  const showGrid = opts.print ? sheet.pageSetup?.showGridLines === true : sheet.view?.showGridLines !== false
  const headings = !opts.print
  const defaultWidth = sheet.defaultColWidth ?? 8.43
  const defaultHeight = sheet.defaultRowHeight ?? 15
  const valueAt = (r: number, c: number) => rows[r]?.[c] ?? null
  const hasValue = (r: number, c: number) => {
    const v = valueAt(r, c)
    return (v !== null && v !== '') || covered.has(`${r},${c}`) || spans.has(`${r},${c}`)
  }
  const fillAt = (r: number, c: number) => fillColor(cellAt(r, c)?.style, theme)
  const side = (r: number, c: number, which: 'top' | 'right' | 'bottom' | 'left'): Edge | null => {
    const s = cellAt(r, c)?.style?.border?.[which]
    if (!s || !s.style) return null
    return { css: borderCss(s, theme), weight: BORDER_WEIGHT[s.style] ?? 2 }
  }
  const heavier = (a: Edge | null, b: Edge | null) => (!a ? b : !b ? a : b.weight > a.weight ? b : a)
  const grid = (filled: boolean) => (showGrid && !filled ? '1px solid var(--wz-sheet-grid)' : '1px solid transparent')

  const nextCol = (c: number) => visibleCols[(colPos.get(c) ?? -2) + 1]
  const nextRow = (r: number) => {
    const i = rowIndex(r)
    return i === -1 ? undefined : visibleRows[i + 1]
  }

  // ── Pictures (a logo, the company seal on a quote) ──
  // Each is placed in the cell it is anchored to, as an absolutely positioned
  // child of that cell, so it lands where the rows really are once laid out —
  // a wrapped row is taller than its declared height.
  const pictures = new Map<string, string[]>()
  for (const img of sheet.images ?? []) {
    const mime = PICTURE_TYPES[img.type]
    if (!mime) continue
    let r = visibleRows.find(x => x >= img.anchor.from.row)
    let c = visibleCols.find(x => x >= img.anchor.from.col)
    if (r === undefined || c === undefined) continue
    if (covered.has(`${r},${c}`)) {
      // Anchored inside a merge: the merge's own cell is the one drawn.
      const owner = [...spans.entries()].find(([k, sp]) => {
        const [r0, c0] = k.split(',').map(Number)
        return r! >= r0 && r! <= sp.endRow && c! >= c0 && c! <= sp.endCol
      })
      if (!owner) continue
      ;[r, c] = owner[0].split(',').map(Number)
    }
    const to = img.anchor.to
    const width = img.width ?? (to ? spanPx(visibleCols, img.anchor.from.col, to.col, x => colPx(columns[x]?.width ?? defaultWidth)) : 0)
    const height = img.height ?? (to ? spanPx(visibleRows, img.anchor.from.row, to.row, x => rowPx(sheet.rowDefs?.get(x)?.height ?? defaultHeight)) : 0)
    if (!(width > 0 && height > 0)) continue
    const tag = `<img class="wz-sheet-img" alt="${escapeHtml(img.altText ?? '')}" src="data:${mime};base64,${toBase64(img.data)}" style="width:${Math.round(width)}px;height:${Math.round(height)}px">`
    const key = `${r},${c}`
    pictures.set(key, [...(pictures.get(key) ?? []), tag])
  }

  // ── The parts that do not depend on which rows are drawn ──
  const out: string[] = []
  const defaultFont = fontName(workbook.defaultFont?.name)
  const widths = visibleCols.map(c => colPx(columns[c]?.width ?? defaultWidth))
  const tableStyle = [
    // An explicit width, so the fixed layout uses the column widths and
    // nothing else: with an intrinsic width, text running over its neighbours
    // widened its own column to fit.
    `width:${(headings ? ROW_HEADER_PX : 0) + widths.reduce((a, b) => a + b, 0)}px`,
    defaultFont ? `font-family:"${defaultFont}",var(--wz-sheet-font)` : '',
    workbook.defaultFont?.size ? `font-size:${Math.min(72, Math.max(6, workbook.defaultFont.size))}pt` : '',
  ].filter(Boolean).join(';')
  out.push(`<table class="wz-sheet-table" style="${tableStyle}"><colgroup>`)
  if (headings) out.push(`<col style="width:${ROW_HEADER_PX}px">`)
  for (const w of widths) out.push(`<col style="width:${w}px">`)
  out.push('</colgroup>')
  if (headings) {
    out.push('<thead><tr><th class="wz-sheet-corner"></th>')
    // Labels come from CSS (`content: attr(data-l)`), not text: find and
    // read-aloud walk the table's text, and "A" or "12" there is not the sheet.
    for (const c of visibleCols) out.push(`<th data-l="${columnLetter(c)}"></th>`)
    out.push('</tr></thead>')
  }
  const tableOpen = out.join('')

  const heightOf = (r: number) => rowPx(sheet.rowDefs?.get(r)?.height ?? defaultHeight)
  const rowTop = new Float64Array(visibleRows.length + 1)
  for (let i = 0; i < visibleRows.length; i++) rowTop[i + 1] = rowTop[i] + heightOf(visibleRows[i])

  // ── Rows [from, to) ──
  const drawRows = (from: number, to: number): string => {
  const html: string[] = []
  const lastDrawn = visibleRows[Math.min(to, visibleRows.length) - 1]
  for (let ri = from; ri < Math.min(to, visibleRows.length); ri++) {
    const r = visibleRows[ri]
    html.push(`<tr data-r="${ri}" style="height:${heightOf(r)}px">${headings ? `<th data-l="${r + 1}"></th>` : ''}`)
    visibleCols.forEach((c, ci) => {
      let key = `${r},${c}`
      // Where (in the sheet) this cell's content and style come from: itself,
      // or — for the first row drawn part-way down a merge — the merge's anchor,
      // which has scrolled out of the drawn rows.
      let srcR = r
      let srcC = c
      let span = spans.get(key)
      const owner = covered.get(key)
      if (owner !== undefined) {
        const [r0, c0] = owner.split(',').map(Number)
        if (ri !== from || c0 !== c || r0 >= r) return
        srcR = r0; srcC = c0; key = owner
        span = spans.get(owner)
      }
      // Rows this span covers among the rows being drawn.
      const rs = span ? countIn(visibleRows, r, Math.min(span.endRow, lastDrawn)) : 1
      const cell = cellAt(srcR, srcC)
      const style = cell?.style
      const value = valueAt(srcR, srcC)
      const css: string[] = []

      // Edges this cell owns: right and bottom, plus top/left on the first
      // row/column, which no neighbour draws.
      const rightCol = span ? span.endCol : c
      const bottomRow = span ? span.endRow : r
      const nc = nextCol(rightCol)
      const nr = nextRow(bottomRow)
      const fill = fillColor(style, theme)
      const right = heavier(side(r, rightCol, 'right'), nc !== undefined ? side(r, nc, 'left') : null)
      const bottom = heavier(side(bottomRow, c, 'bottom'), nr !== undefined ? side(nr, c, 'top') : null)
      css.push(`border-right:${right?.css ?? grid(!!fill || (nc !== undefined && !!fillAt(r, nc)))}`)
      css.push(`border-bottom:${bottom?.css ?? grid(!!fill || (nr !== undefined && !!fillAt(nr, c)))}`)
      if (ri === 0) { const t = side(r, c, 'top'); if (t) css.push(`border-top:${t.css}`) }
      if (ci === 0) { const l = side(r, c, 'left'); if (l) css.push(`border-left:${l.css}`) }
      if (fill) css.push(`background:${fill}`)

      const font = fontCss(style?.font, theme)
      if (font) css.push(font)

      const align = style?.alignment
      const text = displayValue(value, cell, is1904)
      const numeric = typeof value === 'number' || value instanceof Date
        || (opts.csv && typeof value === 'string' && value !== '' && NUMERIC_TEXT.test(value.trim()))
      let h = align?.horizontal
      if (!h || h === 'general') h = numeric ? 'right' : typeof value === 'boolean' ? 'center' : 'left'
      if (h === 'centerContinuous') h = 'center'
      if (h === 'distributed') h = 'justify'
      if (h !== 'left' && h !== 'fill') css.push(`text-align:${h}`)
      const v = align?.vertical
      css.push(`vertical-align:${v === 'center' || v === 'distributed' ? 'middle' : v === 'top' ? 'top' : 'bottom'}`)
      if (align?.indent) css.push(`padding-left:${Math.min(60, align.indent) * 9 + 3}px`)

      // Text runs over empty neighbours, as in Excel; anything else is clipped.
      const wrap = !!align?.wrapText
      const spill = !wrap && !span && !numeric && h === 'left' && text !== ''
        && (nc === undefined || !hasValue(r, nc))
      const pics = pictures.get(key)
      const cls = [wrap ? 'wz-wrap' : spill ? 'wz-spill' : '', pics ? 'wz-anchor' : ''].filter(Boolean).join(' ')

      let inner: string
      if (cell?.richText?.length) {
        inner = cell.richText
          .map(run => {
            const f = fontCss(run.font, theme)
            return f ? `<span style="${escapeHtml(f)}">${escapeHtml(run.text)}</span>` : escapeHtml(run.text)
          })
          .join('')
      } else {
        inner = escapeHtml(text)
      }
      const link = cell?.hyperlink?.target
      if (link && /^(?:https?:|mailto:)/i.test(link.trim())) {
        inner = `<a href="${escapeHtml(link.trim())}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      }

      if (pics) inner = pics.join('') + inner
      const spanAttrs = span ? `${rs > 1 ? ` rowspan="${rs}"` : ''}${span.cs > 1 ? ` colspan="${span.cs}"` : ''}` : ''
      html.push(`<td data-c="${ci}"${spanAttrs}${cls ? ` class="${cls}"` : ''} style="${escapeHtml(css.join(';'))}">${inner}</td>`)
    })
    html.push('</tr>')
  }
  return html.join('')
  }

  return {
    empty: false,
    rowCount: visibleRows.length,
    rowNumbers: visibleRows,
    rowTop,
    columnCount: visibleCols.length + (headings ? 1 : 0),
    tableWidth: (headings ? ROW_HEADER_PX : 0) + widths.reduce((a, b) => a + b, 0),
    tableOpen,
    rows: drawRows,
    textAt: (ri, ci) => {
      const r = visibleRows[ri]
      const c = visibleCols[ci]
      if (r === undefined || c === undefined || covered.has(`${r},${c}`)) return ''
      const cell = cellAt(r, c)
      if (cell?.richText?.length) return cell.richText.map(run => run.text).join('')
      return displayValue(valueAt(r, c), cell, is1904)
    },
  }
}

/** Index of the sheet to show first: the one Excel had open, if visible. */
export function initialSheet(workbook: Workbook): number {
  const active = workbook.activeSheet ?? 0
  const visible = (i: number) => !!workbook.sheets[i] && !workbook.sheets[i].hidden && !workbook.sheets[i].veryHidden
  if (visible(active)) return active
  const first = workbook.sheets.findIndex((_, i) => visible(i))
  return first === -1 ? 0 : first
}
