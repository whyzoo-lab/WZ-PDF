/**
 * The print layout a spreadsheet's PDF is made from — see officePdfJobs.ts.
 */

import type { PdfJob } from './officePdf'
import { layoutSheet, type SheetFormat } from './sheetDoc'
import type { Sheet, Workbook } from 'hucre'

/** Rows printed per piece of a large sheet's PDF. */
const PDF_PIECE_ROWS = 3000
/** Cells above which a sheet is printed in pieces (SheetView windows at the same size). */
const WHOLE_SHEET_CELLS = 60_000
/** Printable width of A4 with Excel's normal margins (18 mm a side), px. */
const A4_PRINTABLE_PX = { portrait: (210 - 36) * 96 / 25.4, landscape: (297 - 36) * 96 / 25.4 }

/**
 * A spreadsheet, as Excel saves one: on A4 with its normal margins, without
 * gridlines or headings, scaled down to the paper's width so no column ends up
 * on a page of its own. Every row — a large sheet is printed in pieces and
 * joined.
 */
export function sheetPdfJob(sheet: Sheet, workbook: Workbook, format: SheetFormat): PdfJob {
  const print = layoutSheet(sheet, workbook, { csv: format === 'csv', print: true })
  const set = sheet.pageSetup?.orientation
  const orientation = set ?? (print.tableWidth > A4_PRINTABLE_PX.portrait ? 'landscape' : 'portrait')
  const fit = Math.min(1, A4_PRINTABLE_PX[orientation] / Math.max(1, print.tableWidth))
  const pieceRows = print.rowCount * print.columnCount > WHOLE_SHEET_CELLS ? PDF_PIECE_ROWS : Math.max(1, print.rowCount)
  return {
    pieces: Math.max(1, Math.ceil(print.rowCount / pieceRows)),
    piece: (i: number) => {
      const el = document.createElement('div')
      el.className = 'wz-sheet wz-sheet-pdf'
      el.innerHTML = print.empty
        ? ''
        : `${print.tableOpen}<tbody>${print.rows(i * pieceRows, (i + 1) * pieceRows)}</tbody></table>`
      return el
    },
    css: `@page { size: A4 ${orientation}; margin: 19mm 18mm; }
      #wz-print-root .wz-sheet-pdf { display: block; min-width: 0; }
      #wz-print-root .wz-sheet-pdf .wz-sheet-table { zoom: ${fit}; }
      #wz-print-root .wz-sheet-pdf tr { break-inside: avoid; }`,
  }
}
