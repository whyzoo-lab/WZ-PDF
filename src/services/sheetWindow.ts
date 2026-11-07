// Where the rows of a windowed sheet sit on the page, when there are too many
// of them for the page to be as tall as they are.
//
// A big sheet is drawn a block of rows at a time, with a spacer above and
// below standing in for the rest (SheetView). Chromium caps the height of any
// element at 33,554,432 px, so a 2,100,000-row CSV (42,000,000 px at 20 px a
// row) was cut off there: its last ~420,000 rows could not be scrolled to.
// CSV is what a sheet is saved as precisely when it is past Excel's
// 1,048,576 rows, so those are the files this has to open.
//
// Past MAX_SHEET_PX the spacers are shrunk by a factor k, so the whole page
// stays under the cap, and the drawn rows keep their real height: a wheel
// notch still moves the rows under the pointer by a notch. The cost is that a
// row's place on the page depends on which block is drawn, so when the block
// moves the view has to be moved with it (pageY of the row that was at the
// top) — see SheetView. Below the limit k is 1 and every function here is the
// identity it replaced.

/**
 * Layout px the spacers and drawn rows may add up to: the 33,554,432 px cap
 * at the largest zoom (3x, in the page and in fullscreen), with room to spare.
 */
export const MAX_SHEET_PX = 8_000_000

/** How much the spacers are shrunk for a sheet `total` layout px tall. */
export function compression(total: number, cap = MAX_SHEET_PX): number {
  return total > cap ? total / cap : 1
}

/** Heights of the spacers above and below the drawn rows [from, to). */
export function spacers(rowTop: Float64Array, from: number, to: number, k: number): { above: number; below: number } {
  return { above: rowTop[from] / k, below: (rowTop[rowTop.length - 1] - rowTop[to]) / k }
}

/**
 * The declared position (rowTop units) shown at `y` px below the top of the
 * table body, with rows [from, to) drawn: real inside them, scaled by k in
 * the spacers.
 */
export function declaredAt(y: number, rowTop: Float64Array, from: number, to: number, k: number): number {
  const { above } = spacers(rowTop, from, to, k)
  const span = rowTop[to] - rowTop[from]
  const end = rowTop[rowTop.length - 1]
  if (y < above) return Math.min(end, Math.max(0, y * k))
  if (y < above + span) return rowTop[from] + (y - above)
  return Math.min(end, rowTop[to] + (y - above - span) * k)
}

/** Where a declared position is drawn, px below the top of the table body: the inverse of declaredAt. */
export function pageY(declared: number, rowTop: Float64Array, from: number, to: number, k: number): number {
  const { above } = spacers(rowTop, from, to, k)
  if (declared < rowTop[from]) return declared / k
  if (declared <= rowTop[to]) return above + (declared - rowTop[from])
  return above + (rowTop[to] - rowTop[from]) + (declared - rowTop[to]) / k
}

/**
 * Cells drawn as one table before the view switches to drawing only the rows
 * in sight. Below it the whole sheet is in the DOM, so find, print and
 * read-aloud cover all of it; above it they cover the rows drawn.
 */
export const WHOLE_SHEET_CELLS = 60_000
/** Rows are drawn in blocks, so scrolling re-draws now and then, not per row. */
export const BLOCK_ROWS = 100
/**
 * Columns are drawn in blocks too, once a windowed sheet has more than three
 * of them: a 273-column survey drew 54,600 cells for the rows in sight, where
 * the screen shows ~10 columns (5.9 s of the main thread while opening). 16
 * columns a block left redraws of 0.2-0.9 s when scrolling sideways; 8 gives
 * 0.1-0.26 s.
 */
export const COL_BLOCK = 8
/** Width of the row-number column, px (sheetDoc draws it; SheetView measures past it). */
export const ROW_HEADER_PX = 44

/** Cells in one drawn row: the row number, the columns [cFrom, cTo) of `cols`, and a spacer each side that has columns behind it. */
export function cellsAcross(cols: number, cFrom: number, cTo: number): number {
  return 1 + (cTo - cFrom) + (cFrom > 0 ? 1 : 0) + (cTo < cols ? 1 : 0)
}
