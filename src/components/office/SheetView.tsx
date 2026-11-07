import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  loadWorkbook, layoutSheet, initialSheet, EncryptedWorkbookError,
  type LoadedWorkbook, type SheetLayout,
} from '../../services/sheetDoc'
import { FLOW_PRINT_ATTR } from '../../services/htmlPrint'
import { setFlowSearchProvider } from '../../services/flowSearchProvider'
import { highlightApi, indexText, rangeAt } from '../../services/domText'
import { HL_ACTIVE, HL_ALL } from '../../hooks/useFlowSearch'
import { ReaderFullscreen } from '../reader/ReaderFullscreen'
import type { PdfJob } from '../../services/officePdf'
import { sheetPdfJob } from '../../services/sheetPdf'
import type { OfficeViewProps } from './officeView'
import { t } from '../../i18n'
import { onceAFrame } from '../../utils/onceAFrame'
import { compression, declaredAt, pageY, spacers } from '../../services/sheetWindow'
import { buildSheetIndex, searchSheetIndex, slicer, type SheetSearchIndex } from '../../services/sheetSearch'
import LoadingIndicator from '../LoadingIndicator'
import { loaderShown } from '../../services/loaderSignal'

interface SheetViewProps extends OfficeViewProps {
  bytes: ArrayBuffer
  /** File name — decides CSV vs .xls and names a CSV's only sheet. */
  name: string
}

type Loaded = { src: ArrayBuffer; book: LoadedWorkbook | null; error: string | null }

/**
 * Cells drawn as one table before the view switches to drawing only the rows
 * in sight. Below it the whole sheet is in the DOM, so find, print and
 * read-aloud cover all of it; above it they cover the rows drawn.
 */
const WHOLE_SHEET_CELLS = 60_000
/** Rows are drawn in blocks, so scrolling re-draws now and then, not per row. */
const BLOCK_ROWS = 100
/** Declared height of the column-letter row (.wz-sheet-table thead th). */
const HEADER_PX = 22

type Window = { layout: SheetLayout; from: number; to: number }

/**
 * Where the view must be once the block [from, to) is drawn: the declared
 * position that was at its top stays `y` px below the table body's top, or
 * the view stays at the very end. Only needed when the spacers are shrunk
 * (sheetWindow.ts); otherwise rows never move.
 */
type Anchor = Window & {
  declared: number
  y: number
  /** Height of the view, layout px. */
  viewH: number
  /** The row at the top was a drawn one: the reader is scrolling through rows. */
  inBlock: boolean
  /** The view was at the very end of the sheet. */
  end: boolean
}

/** The element that scrolls the sheet: ours in the page, ReaderFullscreen's when presenting. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p
  }
  return null
}

/** Past this a workbook waits for the loader to be painted before it is read. */
const BIG_WORKBOOK_BYTES = 4 * 1024 * 1024

/** Matches kept per search; past this a query is too broad to step through anyway. */
const MAX_MATCHES = 100_000

/** A find in progress on a sheet too large for the DOM. */
type Found = {
  layout: SheetLayout
  needle: string
  /** Matching cells as [row, column, row, column, …] in drawn-row order. */
  cells: Int32Array
  /** The match on screen, and a counter so revealing the same one again repaints. */
  active: number
  seq: number
}

/** Ranges of every occurrence of `needle` inside one cell. */
function rangesInCell(td: HTMLElement, needle: string): Range[] {
  const idx = indexText(td)
  const hay = idx.text.toLowerCase()
  const out: Range[] = []
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
    const range = rangeAt(idx, at, needle.length)
    if (range) out.push(range)
  }
  return out
}

/** Drawn-row index whose declared top is at or above `y` (layout px). */
function rowAt(rowTop: Float64Array, y: number): number {
  let lo = 0
  let hi = rowTop.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (rowTop[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return Math.min(lo, rowTop.length - 2)
}

/**
 * Reads a spreadsheet: one sheet at a time as a table, with Excel's sheet tabs
 * along the bottom. Read-only — formulas show their saved results, and
 * nothing is recalculated.
 *
 * Every row is shown, however many. A large sheet is drawn a window at a
 * time: the rows in sight plus a block either side, with spacers of the
 * declared height standing in for the rest so the scrollbar is the sheet's.
 */
export function SheetView({ bytes, name, zoom, fullscreen, onExitFullscreen, handleRef }: SheetViewProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // Keyed to the workbook, so opening another file starts on its own sheet.
  const [picked, setPicked] = useState<{ book: LoadedWorkbook; index: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    // Reading a big workbook holds the main thread for seconds: let the
    // loader reach the screen first, or the reader sees an empty page for all
    // of it (services/loaderSignal.ts). A small one starts at once.
    const ready = bytes.byteLength > BIG_WORKBOOK_BYTES ? loaderShown() : Promise.resolve()
    ready
      .then(() => (cancelled ? null : loadWorkbook(bytes, name)))
      .then(book => { if (!cancelled && book) setLoaded({ src: bytes, book, error: null }) })
      .catch(err => {
        console.error('Spreadsheet read failed:', err)
        if (cancelled) return
        const error = err instanceof EncryptedWorkbookError ? t('office.sheetEncrypted') : t('office.sheetFailed')
        setLoaded({ src: bytes, book: null, error })
      })
    return () => { cancelled = true }
  }, [bytes, name])

  const current = loaded && loaded.src === bytes ? loaded : null
  const book = current?.book ?? null
  const index = book ? (picked?.book === book ? picked.index : initialSheet(book.workbook)) : 0

  const layout = useMemo(() => {
    if (!book) return null
    const sheet = book.workbook.sheets[index]
    if (!sheet) return null
    try {
      return layoutSheet(sheet, book.workbook, { csv: book.format === 'csv' })
    } catch (err) {
      console.error('Spreadsheet render failed:', err)
      return null
    }
  }, [book, index])

  const windowed = !!layout && layout.rowCount * layout.columnCount > WHOLE_SHEET_CELLS

  // ── Which rows are drawn ──────────────────────────────────────────────────
  // Keyed to the layout, so a new sheet starts from its top without an effect
  // that sets state after render.
  const [win, setWin] = useState<Window | null>(null)
  const firstWindow = layout ? Math.min(layout.rowCount, BLOCK_ROWS * 3) : 0
  const from = windowed && win?.layout === layout ? win.from : 0
  const to = !layout ? 0 : !windowed ? layout.rowCount : win?.layout === layout ? win.to : firstWindow

  // How much the spacers are shrunk: 1 unless the sheet is taller than a page
  // can be (sheetWindow.ts).
  const k = layout ? compression(layout.rowTop[layout.rowCount]) : 1

  const hostRef = useRef<HTMLDivElement>(null)
  // The block on the page now, and where the view goes once the next is drawn.
  const drawnRef = useRef<{ layout: SheetLayout | null; from: number; to: number }>({ layout: null, from: 0, to: 0 })
  const anchorRef = useRef<Anchor | null>(null)
  const update = useCallback(() => {
    const host = hostRef.current
    if (!layout || !windowed || !host) return
    const head = host.querySelector('thead')
    const body = host.querySelector('tbody')
    const drawn = drawnRef.current
    if (!head || !body || drawn.layout !== layout) return
    // Measured from the page itself, so it holds at any zoom and in
    // fullscreen, where the scroller and the scale are ReaderFullscreen's.
    const scale = head.getBoundingClientRect().height / HEADER_PX || 1
    const top = body.getBoundingClientRect().top
    const bottom = scrollParent(host)?.getBoundingClientRect().bottom ?? window.innerHeight
    const viewTop = Math.max(0, -top) / scale
    const viewBottom = (bottom - top) / scale
    if (viewBottom < 0) return
    const { rowTop } = layout
    const declared = declaredAt(viewTop, rowTop, drawn.from, drawn.to, k)
    const first = rowAt(rowTop, declared)
    // Rows from `first` on, at their real height — what the view shows once
    // it is moved to `first` — or, from a spacer, what the spacer stands for.
    const last = rowAt(rowTop, Math.max(
      declared + (viewBottom - viewTop), declaredAt(viewBottom, rowTop, drawn.from, drawn.to, k)))
    const nextFrom = Math.max(0, Math.floor((first - BLOCK_ROWS) / BLOCK_ROWS) * BLOCK_ROWS)
    const nextTo = Math.min(layout.rowCount, Math.ceil((last + BLOCK_ROWS) / BLOCK_ROWS) * BLOCK_ROWS)
    if (nextFrom === drawn.from && nextTo === drawn.to) return
    const { above, below } = spacers(rowTop, drawn.from, drawn.to, k)
    const pageEnd = above + (rowTop[drawn.to] - rowTop[drawn.from]) + below
    anchorRef.current = k > 1
      ? {
          layout, from: nextFrom, to: nextTo, declared, y: viewTop, viewH: viewBottom - viewTop,
          inBlock: first >= drawn.from && first < drawn.to,
          end: viewBottom >= pageEnd - 1,
        }
      : null
    setWin({ layout, from: nextFrom, to: nextTo })
  }, [layout, windowed, k])

  // Record what is drawn, and move the view with the rows when the spacers
  // are shrunk: before paint, so the move is never seen.
  useLayoutEffect(() => {
    drawnRef.current = { layout, from, to }
    const a = anchorRef.current
    anchorRef.current = null
    if (!a || !layout || a.layout !== layout || a.from !== from || a.to !== to) return
    const host = hostRef.current
    const head = host?.querySelector('thead')
    const scroller = scrollParent(host)
    if (!head || !scroller) return
    // At the very end, stay there: the last row is what was asked for.
    if (a.end) { scroller.scrollTop = scroller.scrollHeight; return }
    // Scrolling through drawn rows: the row at the top stays where it is.
    // A jump into a spacer (the scrollbar dragged, Home/End) lands on its
    // share of the sheet and is left there while the new rows cover the
    // view, since writing scrollTop cuts short a smooth scroll on its way.
    const { above } = spacers(layout.rowTop, from, to, k)
    const blockEnd = above + layout.rowTop[to] - layout.rowTop[from]
    if (!a.inBlock && a.y >= above && a.y + a.viewH <= blockEnd) return
    const scale = head.getBoundingClientRect().height / HEADER_PX || 1
    const delta = (pageY(a.declared, layout.rowTop, from, to, k) - a.y) * scale
    if (Math.abs(delta) >= 0.5) scroller.scrollTop += delta
  }, [layout, from, to, k])

  useLayoutEffect(() => {
    if (!windowed) return
    // Capture phase: scroll does not bubble, and the scroller is ours in the
    // page and ReaderFullscreen's when presenting.
    const onScroll = onceAFrame(update)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    update()
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      onScroll.cancel()
    }
  }, [windowed, update, zoom, fullscreen])

  // ── Find over the data, for a sheet drawn a window at a time ──────────────
  const [found, setFound] = useState<Found | null>(null)
  const foundRef = useRef<Found | null>(null)
  useEffect(() => { foundRef.current = found })
  // The text laid out for find (services/sheetSearch.ts), built on the first
  // search of this layout and kept for the next ones.
  const indexRef = useRef<{ layout: SheetLayout; index: Promise<SheetSearchIndex | null> } | null>(null)
  const findSeq = useRef(0)
  useEffect(() => {
    if (!windowed || !layout) return
    // Not cancelled by a newer search: every search needs it.
    const indexFor = () => {
      if (indexRef.current?.layout !== layout) {
        // Sized once from the file: a CSV's text is at most its bytes (plus a
        // separator a row); a zipped workbook holds several times its size.
        const hint = book?.format === 'csv' ? bytes.byteLength + layout.rowCount * 2 : bytes.byteLength * 4
        indexRef.current = { layout, index: buildSheetIndex(layout.rowCount, layout.columnCount - 1, layout.textAt, slicer(), hint) }
      }
      return indexRef.current.index
    }
    setFlowSearchProvider({
      prepare() { void indexFor() },
      async find(needle) {
        const seq = ++findSeq.current
        const index = await indexFor()
        if (!index || seq !== findSeq.current) return 0
        const cells = await searchSheetIndex(index, needle, MAX_MATCHES, slicer(() => seq !== findSeq.current))
        if (!cells || seq !== findSeq.current) return 0
        const next: Found = { layout, needle, cells, active: -1, seq: 0 }
        // Set at once as well: the find bar reveals the first match in the
        // same tick, before this state has rendered.
        foundRef.current = next
        setFound(next)
        return cells.length / 2
      },
      reveal(index) {
        const f = foundRef.current
        const ri = f?.cells[index * 2]
        if (!f || ri === undefined) return
        // Draw the block around the match before scrolling to it.
        const nextFrom = Math.max(0, Math.floor(ri / BLOCK_ROWS) * BLOCK_ROWS - BLOCK_ROWS)
        const nextTo = Math.min(layout.rowCount, nextFrom + BLOCK_ROWS * 3)
        anchorRef.current = null   // the find bar scrolls to the match itself
        setWin(w => (w && w.layout === layout && w.from <= ri && ri < w.to ? w : { layout, from: nextFrom, to: nextTo }))
        const shown: Found = { ...f, active: index, seq: f.seq + 1 }
        foundRef.current = shown
        setFound(shown)
      },
      clear() {
        findSeq.current++
        setFound(null)
        const api = highlightApi()
        api?.registry.delete(HL_ALL)
        api?.registry.delete(HL_ACTIVE)
      },
    })
    return () => setFlowSearchProvider(null)
  }, [windowed, layout, book, bytes])

  // ── What the app can ask of this view ─────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!book || !layout || layout.empty) return
    const sheet = book.workbook.sheets[index]
    handleRef.current = {
      fitWidth: () => {
        const width = scrollerRef.current?.clientWidth
        return width ? (width - 16) / layout.tableWidth : null
      },
      // A sheet has no pages to go to.
      goTo: () => undefined,
      pdfJob: async (): Promise<PdfJob> => sheetPdfJob(sheet, book.workbook, book.format),
    }
    return () => { handleRef.current = null }
  }, [book, index, layout, handleRef])

  // Memoized like the other reflowing views, so zooming or a find keystroke
  // does not rebuild thousands of cells.
  const table = useMemo(() => {
    if (!layout || layout.empty) return null
    const gap = (px: number) => (px > 0
      ? `<tr class="wz-sheet-gap" aria-hidden="true" style="height:${px}px"><td colspan="${layout.columnCount}"></td></tr>`
      : '')
    const { above, below } = spacers(layout.rowTop, from, to, k)
    const html = layout.tableOpen
      + '<tbody>'
      + gap(above)
      + layout.rows(from, to)
      + gap(below)
      + '</tbody></table>'
    return <div className="wz-sheet" dangerouslySetInnerHTML={{ __html: html }} />
  }, [layout, from, to, k])

  // Paint the matches among the drawn rows, and bring the active one on
  // screen. Re-run whenever the drawn rows change, since that replaces them.
  // Scroll to a match once, when it becomes the active one — not on every
  // re-draw, or scrolling away would snap straight back to it (the bug
  // CLAUDE.md records for PDF find).
  const scrolledSeq = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const f = found
    const host = hostRef.current
    const api = highlightApi()
    if (!f || f.layout !== layout || !host) return
    const all: Range[] = []
    let active: Range[] = []
    for (let i = 0; i < f.cells.length; i += 2) {
      const ri = f.cells[i]
      if (ri < from || ri >= to) continue
      const td = host.querySelector<HTMLElement>(`tr[data-r="${ri}"] > td[data-c="${f.cells[i + 1]}"]`)
      if (!td) continue
      const ranges = rangesInCell(td, f.needle)
      all.push(...ranges)
      if (i / 2 === f.active) {
        active = ranges
        if (scrolledSeq.current !== f.seq) {
          scrolledSeq.current = f.seq
          td.scrollIntoView({ block: 'center', inline: 'nearest' })
        }
      }
    }
    if (!api) return
    if (all.length) api.registry.set(HL_ALL, new api.Highlight(...all))
    else api.registry.delete(HL_ALL)
    if (active.length) api.registry.set(HL_ACTIVE, new api.Highlight(...active))
    else api.registry.delete(HL_ACTIVE)
  }, [layout, from, to, found])

  if (current?.error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-red-400">
        {current.error}
      </div>
    )
  }
  if (!book) {
    return (
      <LoadingIndicator label={t('url.loading')} />
    )
  }

  const content = table
    ? <div ref={hostRef} {...{ [FLOW_PRINT_ATTR]: '' }}>{table}</div>
    : (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        {layout ? t('office.sheetEmpty') : t('office.sheetFailed')}
      </div>
    )

  if (fullscreen) {
    return <ReaderFullscreen onExit={onExitFullscreen} layout="page">{content}</ReaderFullscreen>
  }

  const tabs = book.workbook.sheets
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.hidden && !s.veryHidden)

  return (
    <div className="flex h-full flex-col bg-white">
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto">
        {/* Zoom on a wrapper, not the marked element, so printing is not zoomed. */}
        <div style={{ zoom }} className="h-full">{content}</div>
      </div>
      {tabs.length > 1 && (
        <div role="tablist" aria-label={t('office.sheets')} className="flex shrink-0 gap-px overflow-x-auto border-t border-gray-300 bg-gray-200 px-2">
          {tabs.map(({ s, i }) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === index}
              onClick={() => setPicked({ book, index: i })}
              className={`shrink-0 whitespace-nowrap px-4 py-1.5 text-xs transition-colors ${
                i === index
                  ? 'bg-white font-semibold text-green-800 shadow-[inset_0_-2px_0_#15803d]'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
