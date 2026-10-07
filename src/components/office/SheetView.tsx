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
    loadWorkbook(bytes, name)
      .then(book => { if (!cancelled) setLoaded({ src: bytes, book, error: null }) })
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

  const hostRef = useRef<HTMLDivElement>(null)
  const update = useCallback(() => {
    const host = hostRef.current
    if (!layout || !windowed || !host) return
    const head = host.querySelector('thead')
    const body = host.querySelector('tbody')
    if (!head || !body) return
    // Measured from the page itself, so it holds at any zoom and in
    // fullscreen, where the scroller and the scale are ReaderFullscreen's.
    const scale = head.getBoundingClientRect().height / HEADER_PX || 1
    const top = body.getBoundingClientRect().top
    const viewTop = Math.max(0, -top) / scale
    const viewBottom = (window.innerHeight - top) / scale
    if (viewBottom < 0) return
    const first = rowAt(layout.rowTop, viewTop)
    const last = rowAt(layout.rowTop, viewBottom)
    const nextFrom = Math.max(0, Math.floor((first - BLOCK_ROWS) / BLOCK_ROWS) * BLOCK_ROWS)
    const nextTo = Math.min(layout.rowCount, Math.ceil((last + BLOCK_ROWS) / BLOCK_ROWS) * BLOCK_ROWS)
    setWin(w => (w && w.layout === layout && w.from === nextFrom && w.to === nextTo
      ? w : { layout, from: nextFrom, to: nextTo }))
  }, [layout, windowed])

  useLayoutEffect(() => {
    if (!windowed) return
    // Capture phase: scroll does not bubble, and the scroller is ours in the
    // page and ReaderFullscreen's when presenting.
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    update()
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [windowed, update, zoom, fullscreen])

  // ── Find over the data, for a sheet drawn a window at a time ──────────────
  const [found, setFound] = useState<Found | null>(null)
  const foundRef = useRef<Found | null>(null)
  useEffect(() => { foundRef.current = found })
  useEffect(() => {
    if (!windowed || !layout) return
    setFlowSearchProvider({
      find(needle) {
        const cells: number[] = []
        search: for (let ri = 0; ri < layout.rowCount; ri++) {
          for (let ci = 0; ci < layout.columnCount - 1; ci++) {
            if (layout.textAt(ri, ci).toLowerCase().includes(needle)) {
              cells.push(ri, ci)
              if (cells.length >= MAX_MATCHES * 2) break search
            }
          }
        }
        const next: Found = { layout, needle, cells: Int32Array.from(cells), active: -1, seq: 0 }
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
        setWin(w => (w && w.layout === layout && w.from <= ri && ri < w.to ? w : { layout, from: nextFrom, to: nextTo }))
        const shown: Found = { ...f, active: index, seq: f.seq + 1 }
        foundRef.current = shown
        setFound(shown)
      },
      clear() {
        setFound(null)
        const api = highlightApi()
        api?.registry.delete(HL_ALL)
        api?.registry.delete(HL_ACTIVE)
      },
    })
    return () => setFlowSearchProvider(null)
  }, [windowed, layout])

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
    const html = layout.tableOpen
      + '<tbody>'
      + gap(layout.rowTop[from])
      + layout.rows(from, to)
      + gap(layout.rowTop[layout.rowCount] - layout.rowTop[to])
      + '</tbody></table>'
    return <div className="wz-sheet" dangerouslySetInnerHTML={{ __html: html }} />
  }, [layout, from, to])

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
      <div className="flex h-full items-center justify-center gap-2 text-gray-400 text-sm select-none">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
        {t('url.loading')}
      </div>
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
