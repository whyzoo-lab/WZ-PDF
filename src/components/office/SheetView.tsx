import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EncryptedWorkbookError } from '../../services/sheetErrors'
import { openSheetHost, type SheetHost } from '../../services/sheetHost'
import type { SheetMetrics } from '../../services/sheetBook'
import { sheetPdfPiece } from '../../services/sheetPdfPiece'
import { FLOW_PRINT_ATTR } from '../../services/htmlPrint'
import { setFlowSearchProvider } from '../../services/flowSearchProvider'
import { highlightApi, indexText, rangeAt } from '../../services/domText'
import { HL_ACTIVE, HL_ALL } from '../../hooks/useFlowSearch'
import { ReaderFullscreen } from '../reader/ReaderFullscreen'
import type { PdfJob } from '../../services/officePdf'
import type { OfficeViewProps } from './officeView'
import { t } from '../../i18n'
import { onceAFrame } from '../../utils/onceAFrame'
import { BLOCK_ROWS, COL_BLOCK, ROW_HEADER_PX, cellsAcross, compression, declaredAt, pageY, spacers } from '../../services/sheetWindow'
import LoadingIndicator from '../LoadingIndicator'
import { loaderShown } from '../../services/loaderSignal'

interface SheetViewProps extends OfficeViewProps {
  bytes: ArrayBuffer
  /** File name — decides CSV vs .xls and names a CSV's only sheet. */
  name: string
}

type Loaded = { src: ArrayBuffer; host: SheetHost | null; error: string | null }
/** Declared height of the column-letter row (.wz-sheet-table thead th). */
const HEADER_PX = 22

type SheetLayout = SheetMetrics
/** Rows [from, to) and columns [cFrom, cTo) of a layout. */
type Window = { layout: SheetLayout; from: number; to: number; cFrom: number; cTo: number }
/** What is on the page: a window, its table head and its rows, from the workbook's worker. */
type Drawn = Window & { open: string; html: string }

const sameWindow = (a: Window | null, b: Window) => !!a && a.layout === b.layout
  && a.from === b.from && a.to === b.to && a.cFrom === b.cFrom && a.cTo === b.cTo

/** The block of columns to draw around drawn-column indices [first, last]. */
function columnBlock(layout: SheetLayout, first: number, last: number): { cFrom: number; cTo: number } {
  if (!layout.colsWindowed) return { cFrom: 0, cTo: layout.cols }
  return {
    cFrom: Math.max(0, Math.floor((first - COL_BLOCK) / COL_BLOCK) * COL_BLOCK),
    cTo: Math.min(layout.cols, Math.ceil((last + COL_BLOCK) / COL_BLOCK) * COL_BLOCK),
  }
}

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

/** A spacer at least this tall (layout px) measures the scale; the header row stands in below it. */
const SCALE_FROM_SPACER_PX = 2000

/**
 * Screen px per layout px of the sheet, measured from the page itself, so it
 * holds at any zoom and in fullscreen, where the scroller and the scale are
 * ReaderFullscreen's. Read off the tallest spacer, whose declared height is
 * exact: the header row renders 22.4 px for its declared 22, and that 1.8 %
 * put a view 8,000,000 px down 143,000 px short — on the 1.3 M-row PSV the
 * End key came to rest in an empty spacer instead of on the last row.
 */
function sheetScale(host: HTMLElement, head: Element): number {
  let declared = 0
  let scale = 0
  for (const gap of host.querySelectorAll<HTMLElement>('tr.wz-sheet-gap')) {
    const px = parseFloat(gap.style.height)
    if (px > declared) { declared = px; scale = gap.getBoundingClientRect().height / px }
  }
  if (declared >= SCALE_FROM_SPACER_PX && scale > 0) return scale
  return head.getBoundingClientRect().height / HEADER_PX || 1
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
  const [picked, setPicked] = useState<{ wb: SheetHost; index: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let opened: SheetHost | null = null
    // The workbook is read in a worker (services/sheetBook.ts), so the page
    // keeps drawing; the loader still waits to be painted first, so a view
    // that must fall back to reading in the page does not show an empty
    // window for all of it (services/loaderSignal.ts).
    const ready = bytes.byteLength > BIG_WORKBOOK_BYTES ? loaderShown() : Promise.resolve()
    ready
      .then(() => (cancelled ? null : openSheetHost(bytes, name)))
      .then(wb => {
        if (!wb) return
        if (cancelled) { wb.close(); return }
        opened = wb
        setLoaded({ src: bytes, host: wb, error: null })
      })
      .catch(err => {
        console.error('Spreadsheet read failed:', err)
        if (cancelled) return
        const error = err instanceof EncryptedWorkbookError ? t('office.sheetEncrypted') : t('office.sheetFailed')
        setLoaded({ src: bytes, host: null, error })
      })
    return () => { cancelled = true; opened?.close() }
  }, [bytes, name])

  const current = loaded && loaded.src === bytes ? loaded : null
  const wb = current?.host ?? null
  const index = wb ? (picked?.wb === wb ? picked.index : wb.info.initial) : 0

  // The sheet's measurements and first rows, from the workbook's worker.
  const [laid, setLaid] = useState<{ wb: SheetHost; index: number; layout: SheetLayout | null } | null>(null)
  useEffect(() => {
    if (!wb) return
    let cancelled = false
    wb.layout(index).then(
      layout => { if (!cancelled) setLaid({ wb, index, layout }) },
      err => {
        console.error('Spreadsheet render failed:', err)
        if (!cancelled) setLaid({ wb, index, layout: null })
      },
    )
    return () => { cancelled = true }
  }, [wb, index])
  const laidOut = !!laid && laid.wb === wb && laid.index === index
  const layout = laidOut ? laid.layout : null

  const windowed = !!layout?.windowed

  // ── Which rows are drawn ──────────────────────────────────────────────────
  // Keyed to the layout, so a new sheet starts from its top without an effect
  // that sets state after render. `win` is the block wanted; what is on the
  // page is the last block whose markup has arrived (`drawn`), else the first
  // window, which comes with the layout.
  const [win, setWin] = useState<Window | null>(null)
  const [drawn, setDrawn] = useState<Drawn | null>(null)
  const shown: Drawn | null = !layout
    ? null
    : drawn?.layout === layout
      ? drawn
      : { layout, from: 0, to: layout.firstTo, cFrom: 0, cTo: layout.firstCols, open: layout.tableOpen, html: layout.html }
  const from = shown?.from ?? 0
  const to = shown?.to ?? 0
  const cFrom = shown?.cFrom ?? 0
  const cTo = shown?.cTo ?? 0

  // How much the spacers are shrunk: 1 unless the sheet is taller than a page
  // can be (sheetWindow.ts).
  const k = layout ? compression(layout.rowTop[layout.rowCount]) : 1

  // Ask for the wanted block, one request at a time. A block that arrives
  // after the view has moved on is drawn anyway while the spacers are true to
  // size — rows are where they belong whichever block is drawn — and the next
  // is asked for. With shrunk spacers a row's place depends on the block
  // drawn, so only the block still wanted is drawn: a stale one in between
  // moved the rows under the view the anchor was measured against, and a jump
  // to the end came to rest in an empty spacer.
  const fetchingRef = useRef(false)
  const wantRef = useRef<Window | null>(null)
  const [fetchTick, setFetchTick] = useState(0)
  useEffect(() => {
    const w = windowed && win?.layout === layout ? win : null
    wantRef.current = w
    if (!wb || !w || fetchingRef.current
      || (w.from === from && w.to === to && w.cFrom === cFrom && w.cTo === cTo)) return
    fetchingRef.current = true
    wb.rows(w.layout.id, w.from, w.to, w.cFrom, w.cTo).then(
      ({ open, html }) => {
        fetchingRef.current = false
        if (k === 1 || wantRef.current === w) setDrawn({ ...w, open, html })
        else setFetchTick(n => n + 1)   // ask again, for the block wanted now
      },
      () => { fetchingRef.current = false },
    )
  }, [wb, windowed, win, layout, from, to, cFrom, cTo, k, fetchTick])

  const hostRef = useRef<HTMLDivElement>(null)
  // The block on the page now, and where the view goes once the next is drawn.
  const drawnRef = useRef<Omit<Window, 'layout'> & { layout: SheetLayout | null }>({ layout: null, from: 0, to: 0, cFrom: 0, cTo: 0 })
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
    const scale = sheetScale(host, head)
    const bodyRect = body.getBoundingClientRect()
    const top = bodyRect.top
    const view = scrollParent(host)?.getBoundingClientRect()
    const bottom = view?.bottom ?? window.innerHeight
    // Columns in sight, past the row numbers (which stay on screen, sticky,
    // but keep their place in the layout).
    const x0 = ((view?.left ?? 0) - bodyRect.left) / scale - ROW_HEADER_PX
    const x1 = ((view?.right ?? window.innerWidth) - bodyRect.left) / scale - ROW_HEADER_PX
    const { cFrom: nextCFrom, cTo: nextCTo } = columnBlock(
      layout, rowAt(layout.colLeft, Math.max(0, x0)), rowAt(layout.colLeft, Math.max(0, x1)))
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
    const next: Window = { layout, from: nextFrom, to: nextTo, cFrom: nextCFrom, cTo: nextCTo }
    if (nextFrom === drawn.from && nextTo === drawn.to) {
      // Back on the rows already drawn: a block still on its way is no longer
      // wanted, and other columns of the same rows move nothing up or down.
      anchorRef.current = null
      setWin(w => (sameWindow(w, next) ? w : next))
      return
    }
    const { above, below } = spacers(rowTop, drawn.from, drawn.to, k)
    const pageEnd = above + (rowTop[drawn.to] - rowTop[drawn.from]) + below
    anchorRef.current = k > 1
      ? {
          ...next, declared, y: viewTop, viewH: viewBottom - viewTop,
          inBlock: first >= drawn.from && first < drawn.to,
          end: viewBottom >= pageEnd - 1,
        }
      : null
    setWin(w => (sameWindow(w, next) ? w : next))
  }, [layout, windowed, k])

  // Record what is drawn, and move the view with the rows when the spacers
  // are shrunk: before paint, so the move is never seen. The anchor waits for
  // its own block: rows arrive from the worker, and a block asked for earlier
  // may be drawn first.
  useLayoutEffect(() => {
    drawnRef.current = { layout, from, to, cFrom, cTo }
    const a = anchorRef.current
    if (!a || !layout) return
    if (a.layout !== layout) { anchorRef.current = null; return }
    if (a.from !== from || a.to !== to || a.cFrom !== cFrom || a.cTo !== cTo) return
    anchorRef.current = null
    const host = hostRef.current
    const head = host?.querySelector('thead')
    const scroller = scrollParent(host)
    if (!host || !head || !scroller) return
    // At the very end, stay there: the last row is what was asked for.
    if (a.end) { scroller.scrollTop = scroller.scrollHeight; return }
    // Scrolling through drawn rows: the row at the top stays where it is.
    // A jump into a spacer (the scrollbar dragged, Home/End) lands on its
    // share of the sheet and is left there while the new rows cover the
    // view, since writing scrollTop cuts short a smooth scroll on its way.
    const { above } = spacers(layout.rowTop, from, to, k)
    const blockEnd = above + layout.rowTop[to] - layout.rowTop[from]
    if (!a.inBlock && a.y >= above && a.y + a.viewH <= blockEnd) return
    const scale = sheetScale(host, head)
    const delta = (pageY(a.declared, layout.rowTop, from, to, k) - a.y) * scale
    if (Math.abs(delta) >= 0.5) scroller.scrollTop += delta
  }, [layout, from, to, cFrom, cTo, k])

  // Look again once a block is drawn. Drawing moves the spacers, and with them
  // what the view (whose scrollTop stays put) is showing; no scroll event
  // says so. A smooth scroll to the end (End key) asked for blocks on its
  // way, drew them under its feet, and came to rest in an empty spacer.
  useEffect(() => {
    if (!windowed) return
    const id = requestAnimationFrame(() => update())
    return () => cancelAnimationFrame(id)
  }, [windowed, update, from, to, cFrom, cTo])

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
  // find's index lives with the workbook (services/sheetBook.ts): built there
  // on the first search of this layout, or when the find bar opens.
  const findSeq = useRef(0)
  useEffect(() => {
    if (!windowed || !layout || !wb) return
    setFlowSearchProvider({
      prepare() { wb.prepare(layout.id) },
      async find(needle) {
        const seq = ++findSeq.current
        const cells = await wb.find(layout.id, needle).catch(() => null)
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
        const ci = f?.cells[index * 2 + 1]
        if (!f || ri === undefined || ci === undefined) return
        // Draw the block around the match before scrolling to it.
        const nextFrom = Math.max(0, Math.floor(ri / BLOCK_ROWS) * BLOCK_ROWS - BLOCK_ROWS)
        const nextTo = Math.min(layout.rowCount, nextFrom + BLOCK_ROWS * 3)
        const cols = columnBlock(layout, ci, ci)
        anchorRef.current = null   // the find bar scrolls to the match itself
        setWin(w => (w && w.layout === layout && w.from <= ri && ri < w.to && w.cFrom <= ci && ci < w.cTo
          ? w
          : { layout, from: nextFrom, to: nextTo, ...cols }))
        const shown: Found = { ...f, active: index, seq: f.seq + 1 }
        foundRef.current = shown
        setFound(shown)
      },
      clear() {
        findSeq.current++
        wb.cancelFind()
        setFound(null)
        const api = highlightApi()
        api?.registry.delete(HL_ALL)
        api?.registry.delete(HL_ACTIVE)
      },
    })
    return () => setFlowSearchProvider(null)
  }, [windowed, layout, wb])

  // ── What the app can ask of this view ─────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!wb || !layout || layout.empty) return
    handleRef.current = {
      fitWidth: () => {
        const width = scrollerRef.current?.clientWidth
        return width ? (width - 16) / layout.tableWidth : null
      },
      // A sheet has no pages to go to.
      goTo: () => undefined,
      // Laid out for print where the workbook is; the page only builds the DOM.
      pdfJob: async (): Promise<PdfJob> => {
        const { css, pieces } = await wb.pdf(index)
        return { css, pieces, piece: async i => sheetPdfPiece(await wb.pdfPiece(index, i)) }
      },
    }
    return () => { handleRef.current = null }
  }, [wb, index, layout, handleRef])

  // Memoized like the other reflowing views, so zooming or a find keystroke
  // does not rebuild thousands of cells.
  const rowsHtml = shown?.html ?? ''
  const tableOpen = shown?.open ?? ''
  const table = useMemo(() => {
    if (!layout || layout.empty) return null
    const across = cellsAcross(layout.cols, cFrom, cTo)
    const gap = (px: number) => (px > 0
      ? `<tr class="wz-sheet-gap" aria-hidden="true" style="height:${px}px"><td colspan="${across}"></td></tr>`
      : '')
    const { above, below } = spacers(layout.rowTop, from, to, k)
    const html = tableOpen
      + '<tbody>'
      + gap(above)
      + rowsHtml
      + gap(below)
      + '</tbody></table>'
    return <div className="wz-sheet" dangerouslySetInnerHTML={{ __html: html }} />
  }, [layout, from, to, cFrom, cTo, tableOpen, rowsHtml, k])

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
      const ci = f.cells[i + 1]
      if (ri < from || ri >= to || ci < cFrom || ci >= cTo) continue
      const td = host.querySelector<HTMLElement>(`tr[data-r="${ri}"] > td[data-c="${ci}"]`)
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
  }, [layout, from, to, cFrom, cTo, found])

  if (current?.error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-red-400">
        {current.error}
      </div>
    )
  }
  // Reading the workbook, or laying out the sheet just picked.
  if (!wb || !laidOut) {
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

  const tabs = wb.info.sheets
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.hidden)

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
              onClick={() => setPicked({ wb, index: i })}
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
