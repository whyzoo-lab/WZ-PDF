// A workbook and everything made from it, kept where it was read.
//
// SheetView runs this in a worker (services/sheetHost.ts): reading a big
// workbook is seconds of work — a 221 MB PSV ~2 s of parsing, a 56 MB styled
// .xlsx far longer — and the page could not even redraw meanwhile. Handing the
// parsed workbook back to the page is no answer: postMessage copies it, and
// copying a workbook was measured slower than reading it (v8 serialize +
// deserialize: the PSV 2.7 + 3.4 s against 2 s of parsing; a styled 43,935-row
// .xlsx 18 + 64 s). So the workbook stays in the worker, and the page asks it
// for what it draws: a sheet's measurements, the markup of the rows in sight,
// find's matches, the PDF's pieces — small things, cheap to copy.
//
// Everything here is plain data in, plain data out, so the same class serves
// the page directly where no worker can be started.

import { initialSheet, layoutSheet, loadWorkbook, type LoadedWorkbook, type SheetFormat, type SheetLayout } from './sheetDoc'
import { buildSheetIndex, searchSheetIndex, slicer, type SheetSearchIndex } from './sheetSearch'
import { sheetPdfPlan, type SheetPdfPlan } from './sheetPdf'

import { BLOCK_ROWS, WHOLE_SHEET_CELLS } from './sheetWindow'
export { BLOCK_ROWS, WHOLE_SHEET_CELLS }
/** Matches kept per search; past this a query is too broad to step through anyway. */
export const MAX_MATCHES = 100_000

export interface BookInfo {
  format: SheetFormat
  /** Every sheet, in order; hidden ones are not offered as tabs. */
  sheets: { name: string; hidden: boolean }[]
  /** The sheet to open on: the active one, else the first visible. */
  initial: number
}

/** A sheet laid out for the screen — SheetLayout without the workbook. */
export interface SheetMetrics {
  /** Names this layout in later requests. */
  id: number
  empty: boolean
  rowCount: number
  columnCount: number
  tableWidth: number
  tableOpen: string
  rowTop: Float64Array
  /** Drawn a block at a time (else every row is in `html`). */
  windowed: boolean
  /** Markup of rows [0, firstTo): the whole sheet, or its first window. */
  html: string
  firstTo: number
}

export class SheetBook {
  private readonly layouts = new Map<number, { layout: SheetLayout; index?: Promise<SheetSearchIndex | null> }>()
  private readonly plans = new Map<number, SheetPdfPlan>()
  private nextId = 1
  private findSeq = 0

  private readonly book: LoadedWorkbook
  /** The file's size, for sizing find's index. */
  private readonly bytes: number

  private constructor(book: LoadedWorkbook, bytes: number) {
    this.book = book
    this.bytes = bytes
  }

  /** Reads the workbook; throws EncryptedWorkbookError for a locked one. */
  static async open(bytes: ArrayBuffer, name: string): Promise<SheetBook> {
    return new SheetBook(await loadWorkbook(bytes, name), bytes.byteLength)
  }

  info(): BookInfo {
    const { workbook, format } = this.book
    return {
      format,
      sheets: workbook.sheets.map(s => ({ name: s.name, hidden: !!(s.hidden || s.veryHidden) })),
      initial: initialSheet(workbook),
    }
  }

  /** Lays out sheet `index` for the screen; null when it cannot be drawn. */
  layout(index: number): SheetMetrics | null {
    const sheet = this.book.workbook.sheets[index]
    if (!sheet) return null
    let layout: SheetLayout
    try {
      layout = layoutSheet(sheet, this.book.workbook, { csv: this.book.format === 'csv' })
    } catch (err) {
      console.error('Spreadsheet render failed:', err)
      return null
    }
    // One screen layout at a time: the previous sheet's rows and find index go.
    this.layouts.clear()
    const id = this.nextId++
    this.layouts.set(id, { layout })
    const windowed = layout.rowCount * layout.columnCount > WHOLE_SHEET_CELLS
    const firstTo = windowed ? Math.min(layout.rowCount, BLOCK_ROWS * 3) : layout.rowCount
    return {
      id, windowed, firstTo,
      empty: layout.empty,
      rowCount: layout.rowCount,
      columnCount: layout.columnCount,
      tableWidth: layout.tableWidth,
      tableOpen: layout.tableOpen,
      rowTop: layout.rowTop,
      html: layout.empty ? '' : layout.rows(0, firstTo),
    }
  }

  /** Markup of drawn rows [from, to) of layout `id`; '' when it is gone. */
  rows(id: number, from: number, to: number): string {
    return this.layouts.get(id)?.layout.rows(from, to) ?? ''
  }

  private index(id: number): Promise<SheetSearchIndex | null> {
    const entry = this.layouts.get(id)
    if (!entry) return Promise.resolve(null)
    if (!entry.index) {
      const { layout } = entry
      // Sized once from the file: a CSV's text is at most its bytes (plus a
      // separator a row); a zipped workbook holds several times its size.
      const hint = this.book.format === 'csv' ? this.bytes + layout.rowCount * 2 : this.bytes * 4
      // Not cancelled by a newer search: every search needs it.
      entry.index = buildSheetIndex(layout.rowCount, layout.columnCount - 1, layout.textAt, slicer(), hint)
    }
    return entry.index
  }

  /** Starts building find's index for layout `id` (the find bar opened). */
  prepare(id: number): void { void this.index(id) }

  /**
   * Matching cells of layout `id` as [row, column, …], or null when a newer
   * search (or `cancelFind`) overtook this one.
   */
  async find(id: number, needle: string): Promise<Int32Array | null> {
    const seq = ++this.findSeq
    const index = await this.index(id)
    if (!index || seq !== this.findSeq) return null
    const cells = await searchSheetIndex(index, needle, MAX_MATCHES, slicer(() => seq !== this.findSeq))
    return cells && seq === this.findSeq ? cells : null
  }

  cancelFind(): void { this.findSeq++ }

  /** The PDF of sheet `index`: its css and piece count. */
  pdf(index: number): { css: string; pieces: number } {
    const sheet = this.book.workbook.sheets[index]
    if (!sheet) throw new Error(`no sheet ${index}`)
    const plan = sheetPdfPlan(sheet, this.book.workbook, this.book.format)
    this.plans.clear()
    this.plans.set(index, plan)
    return { css: plan.css, pieces: plan.pieces }
  }

  /** Piece `piece` of sheet `index`'s PDF, as markup. */
  pdfPiece(index: number, piece: number): string {
    let plan = this.plans.get(index)
    if (!plan) { this.pdf(index); plan = this.plans.get(index)! }
    return plan.pieceHtml(piece)
  }
}
