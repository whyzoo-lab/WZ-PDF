// Find over a spreadsheet too large for the DOM, fast and without freezing.
//
// SheetView searched by asking every cell for its text, lower-casing it and
// testing it — 2.0-2.5 s per search, measured on a 221 MB PSV (1,315,498 rows
// x 24 columns: 31.6 M cells), on the main thread, once per keystroke the find
// bar let through. Typing a word froze the window for seconds at a time.
// Testing without the lower-casing saved little: reading 31.6 M cells is most
// of it. So the text is read once, into an index, and searched there.
//
// **The index is one Uint16Array, not strings.** The first version kept a
// lower-cased string per block of rows (~180 M characters). It searched in
// 20-70 ms, but building it took 15 s in the app against 3.6 s in Node: the
// workbook already puts ~2 GB on the renderer's heap, so each major GC costs
// 0.6-1.6 s, and allocating a few hundred MB of strings (plus as much garbage
// from joins and lower-casing) set off one after another — the window stalled
// for up to 1.6 s at a time. Character codes copied into one typed array make
// no garbage and do not add to what a GC must walk.
//
// Layout: each cell's text, lower-cased a code unit at a time (`lowerCode`),
// cells separated by 1 and rows by 10; `rowStart[r]` is where row r begins.
// A hit maps back to its row by binary search and to its column by counting
// separators before it. Building and searching hand the thread back every few
// tens of ms, so the window keeps responding, and a search that a newer one
// replaced stops. Cells are matched, not occurrences — a cell holding the
// word twice counts once, as before; a newline or 1 inside a cell reads as a
// space, so no query matches across two cells or rows.

const SLICE_MS = 24
const CELL = 1
const ROW = 10

export interface SheetSearchIndex {
  rowCount: number
  /** The text, `length` code units of it used. */
  text: Uint16Array
  length: number
  /** Offset of each row's first unit; rowCount + 1 entries. */
  rowStart: Int32Array
}

/** Gives the thread back; true when the work should stop. */
export type Pause = () => Promise<boolean>

/** A pause that yields to the event loop at most every SLICE_MS, stopping once `cancelled()`. */
export function slicer(cancelled: () => boolean = () => false): Pause {
  let since = performance.now()
  return async () => {
    if (performance.now() - since >= SLICE_MS) {
      await new Promise(resolve => setTimeout(resolve, 0))
      since = performance.now()
    }
    return cancelled()
  }
}

// ── Lower-casing a code unit at a time ─────────────────────────────────────
// What toLowerCase does to each UTF-16 code unit on its own, learned once per
// unit. A unit whose lower case is longer (İ → i + combining dot) keeps its
// first unit; the needle goes through the same table, so both sides agree.
const LOWER = new Uint16Array(65536)
const KNOWN = new Uint8Array(65536)
export function lowerCode(c: number): number {
  if (c < 128) return c >= 65 && c <= 90 ? c + 32 : c
  if (!KNOWN[c]) {
    KNOWN[c] = 1
    const l = String.fromCharCode(c).toLowerCase()
    LOWER[c] = l.length === 1 ? l.charCodeAt(0) : l.length > 1 ? l.charCodeAt(0) : c
  }
  return LOWER[c]
}

/** `needle` as the index stores text; null when it could never match (a separator in it). */
export function needleCodes(needle: string): Uint16Array | null {
  const out = new Uint16Array(needle.length)
  for (let i = 0; i < needle.length; i++) {
    let c = needle.charCodeAt(i)
    if (c === 13) c = 32
    if (c === CELL || c === ROW) return null
    out[i] = lowerCode(c)
  }
  return out
}

/**
 * The index for a sheet of `rowCount` x `colCount` cells read through `textAt`.
 * `sizeHint` (code units, e.g. the file's byte length) sizes the buffer so it
 * is allocated once; it grows by doubling if the guess was short.
 */
export async function buildSheetIndex(
  rowCount: number, colCount: number, textAt: (ri: number, ci: number) => string,
  pause: Pause = slicer(), sizeHint = 1 << 20,
): Promise<SheetSearchIndex | null> {
  let text = new Uint16Array(Math.max(1024, Math.ceil(sizeHint)))
  const rowStart = new Int32Array(rowCount + 1)
  let at = 0
  const room = (need: number) => {
    if (at + need <= text.length) return
    let size = text.length * 2
    while (at + need > size) size *= 2
    const grown = new Uint16Array(size)
    grown.set(text.subarray(0, at))
    text = grown
  }
  for (let ri = 0; ri < rowCount; ri++) {
    rowStart[ri] = at
    for (let ci = 0; ci < colCount; ci++) {
      const s = textAt(ri, ci)
      room(s.length + 1)
      for (let k = 0; k < s.length; k++) {
        const c = s.charCodeAt(k)
        text[at++] = c === CELL || c === ROW || c === 13 ? 32 : lowerCode(c)
      }
      text[at++] = ci === colCount - 1 ? ROW : CELL
    }
    if ((ri & 1023) === 1023 && await pause()) return null
  }
  rowStart[rowCount] = at
  return { rowCount, text, length: at, rowStart }
}

/** Last row whose start is at or before `pos`. */
function rowOf(starts: Int32Array, rows: number, pos: number): number {
  let lo = 0, hi = rows - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Units scanned between checks of the clock. */
const SCAN_STEP = 1 << 22

/**
 * Every cell containing `needle` (already lower-cased), as [row, column, …] in
 * reading order, at most `max` cells; null when stopped by `pause`.
 */
export async function searchSheetIndex(
  index: SheetSearchIndex, needle: string, max: number, pause: Pause = slicer(),
): Promise<Int32Array | null> {
  const n = needleCodes(needle)
  if (!n || n.length === 0) return new Int32Array(0)
  const { text, length, rowStart, rowCount } = index
  const m = n.length
  const first = n[0], last = n[m - 1]
  const end = length - m
  const out: number[] = []
  let lastRow = -1, lastCol = -1
  for (let from = 0; from <= end; from += SCAN_STEP) {
    const to = Math.min(end, from + SCAN_STEP - 1)
    for (let i = from; i <= to; i++) {
      if (text[i] !== first || text[i + m - 1] !== last) continue
      let k = 1
      while (k < m - 1 && text[i + k] === n[k]) k++
      if (k < m - 1) continue
      const r = rowOf(rowStart, rowCount, i)
      let col = 0
      for (let p = rowStart[r]; p < i; p++) if (text[p] === CELL) col++
      if (r === lastRow && col === lastCol) continue
      lastRow = r; lastCol = col
      out.push(r, col)
      if (out.length >= max * 2) return Int32Array.from(out)
    }
    if (await pause()) return null
  }
  return Int32Array.from(out)
}
