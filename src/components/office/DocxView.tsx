import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderDocx, type RenderedDocx } from '../../services/docxDoc'
import { FLOW_PRINT_ATTR } from '../../services/htmlPrint'
import type { PdfJob } from '../../services/officePdf'
import { DOCX_PAGE_SELECTOR as PAGE_SELECTOR, docxPageSize as pageSize, docxPdfJob } from '../../services/officePdfJobs'
import { paginateDocx } from '../../services/docxPaginate'
import { ReaderFullscreen } from '../reader/ReaderFullscreen'
import { OfficePagePanel } from './OfficePagePanel'
import { GRID_PAGE_PX, GUTTER_PX, PAGE_GAP_PX, type OfficeViewProps } from './officeView'
import { t } from '../../i18n'

interface DocxViewProps extends OfficeViewProps {
  bytes: ArrayBuffer
}

/**
 * Reads a Word document with the PDF viewer's controls: one page per row, two
 * per row, or all of them as a grid; a page list on the left.
 *
 * Like Markdown and mail it stays off the canvas pipeline: docx-preview lays
 * it out as HTML pages, which keeps the text selectable and searchable — see
 * services/docxDoc.ts for what is removed from that HTML before it reaches
 * the screen. Pages break where Word last broke them (it records that in the
 * file), so page N here is page N in Word.
 */
export function DocxView({
  bytes, zoom, fullscreen, onExitFullscreen, viewMode, onViewModeChange, panelOpen, handleRef, onPageInfo,
}: DocxViewProps) {
  // Keyed to the bytes it came from, so a new file reads as "not ready" without
  // a setState in the effect body.
  const [result, setResult] = useState<{ src: ArrayBuffer; doc: RenderedDocx | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    let made: RenderedDocx | null = null
    renderDocx(bytes)
      .then(doc => {
        made = doc
        if (cancelled) doc.objectUrls.forEach(u => URL.revokeObjectURL(u))
        else setResult({ src: bytes, doc })
      })
      .catch(err => {
        console.error('Word render failed:', err)
        if (!cancelled) setResult({ src: bytes, doc: null })
      })
    return () => {
      cancelled = true
      // The pictures are blob: URLs docx-preview made; they outlive the DOM
      // that showed them unless released.
      made?.objectUrls.forEach(u => URL.revokeObjectURL(u))
    }
  }, [bytes])

  const current = result && result.src === bytes ? result : null
  const doc = current?.doc ?? null

  // Memoized for the same reason as MarkdownView's body: a re-render must not
  // re-assign innerHTML, which would drop the reader's selection and every
  // find highlight over it.
  const body = useMemo(() => doc && (
    <>
      <style>{doc.css}</style>
      <div className="wz-docx-host" dangerouslySetInnerHTML={{ __html: doc.html }} />
    </>
  ), [doc])

  // ── Pages ─────────────────────────────────────────────────────────────────
  const markedRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<{ doc: RenderedDocx; list: HTMLElement[]; width: number } | null>(null)
  useLayoutEffect(() => {
    const host = markedRef.current
    if (!doc || !host) return
    // Pages that run past their paper are split first (services/docxPaginate):
    // a document Word never laid out has no page breaks of its own.
    const wrapper = host.querySelector<HTMLElement>('.wz-docx-wrapper')
    if (wrapper) paginateDocx(wrapper)
    const list = Array.from(host.querySelectorAll<HTMLElement>(PAGE_SELECTOR))
    const width = list.reduce((w, s) => Math.max(w, pageSize(s).w), 0) || 794
    // Measured again on entering or leaving fullscreen: the body is mounted
    // afresh there, so the old page elements are gone.
    setPages({ doc, list, width })
  }, [doc, fullscreen])
  // Memoized: a fresh [] each render would rebuild every callback below.
  const pageList = useMemo(() => (pages?.doc === doc ? pages.list : []), [pages, doc])
  const pageWidth = pages?.doc === doc ? pages.width : 794

  const [column, setColumn] = useState(0)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setColumn(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [doc, fullscreen, panelOpen])

  // Word opens at 100 %, so zoom 1 is the page's real size — or the column's
  // width when the window is narrower. Two-page fits two side by side.
  const perRow = viewMode === 'spread' ? 2 : 1
  const rowWidth = (column - GUTTER_PX - PAGE_GAP_PX * (perRow - 1)) / perRow
  const base = column > 0 ? Math.min(1, rowWidth / pageWidth) : 1
  const scale = viewMode === 'grid' ? GRID_PAGE_PX / pageWidth : Math.max(0.05, base * zoom)

  // ── Which page is on screen ───────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1)
  // Where the reader is, as a fraction of the whole column — kept so a zoom
  // or a layout change lands on the same page instead of the same pixel.
  const position = useRef(0)
  const onScrollPages = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    position.current = el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0
    const line = el.getBoundingClientRect().top + el.clientHeight * 0.3
    let page = 1
    pageList.forEach((s, i) => { if (s.getBoundingClientRect().top <= line) page = i + 1 })
    setCurrentPage(page)
  }, [pageList])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = position.current * el.scrollHeight
  }, [scale, viewMode])
  const count = pageList.length
  useEffect(() => {
    onPageInfo?.(count ? { count, current: Math.min(currentPage, count) } : null)
  }, [count, currentPage, onPageInfo])
  useEffect(() => () => onPageInfo?.(null), [onPageInfo])

  const goTo = useCallback((page: number) => {
    pageList[page - 1]?.scrollIntoView({ block: 'start' })
    setCurrentPage(page)
  }, [pageList])

  // A page clicked in the all-pages grid opens there in the one-per-row view.
  const [pendingPage, setPendingPage] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (pendingPage === null || viewMode === 'grid') return
    // Scrolling reports the page through the scroll handler.
    pageList[pendingPage - 1]?.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: the jump has been made
    setPendingPage(null)
  }, [pendingPage, viewMode, pageList])
  const onGridClick = useCallback((e: React.MouseEvent) => {
    const section = (e.target as Element).closest('section.wz-docx')
    const index = section ? pageList.indexOf(section as HTMLElement) : -1
    if (index < 0) return
    setPendingPage(index + 1)
    onViewModeChange('single')
  }, [pageList, onViewModeChange])

  // ── What the app can ask of this view ─────────────────────────────────────
  const metrics = useRef({ rowWidth, base, pageWidth, mode: viewMode })
  useLayoutEffect(() => { metrics.current = { rowWidth, base, pageWidth, mode: viewMode } })
  useEffect(() => {
    if (!doc) return
    handleRef.current = {
      fitWidth: () => {
        const m = metrics.current
        if (m.mode === 'grid' || m.base <= 0) return null
        return (m.rowWidth / m.pageWidth) / m.base
      },
      goTo,
      pdfJob: async (): Promise<PdfJob> => {
        const marked = markedRef.current
        if (!marked) throw new Error('document not on screen')
        return docxPdfJob(marked)
      },
    }
    return () => { handleRef.current = null }
  }, [doc, handleRef, goTo])

  if (current && !doc) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-red-400">
        {t('office.docxFailed')}
      </div>
    )
  }
  if (!body) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-gray-400 text-sm select-none">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
        {t('url.loading')}
      </div>
    )
  }

  if (fullscreen) {
    return (
      <ReaderFullscreen onExit={onExitFullscreen} layout="page">
        <div ref={markedRef} {...{ [FLOW_PRINT_ATTR]: '' }}>{body}</div>
      </ReaderFullscreen>
    )
  }

  return (
    <div className="flex h-full">
      {panelOpen && count > 0 && (
        <OfficePagePanel
          count={count}
          current={currentPage}
          aspect={i => { const p = pageList[i]; if (!p) return 0.75; const s = pageSize(p); return s.w / s.h }}
          source={i => pageList[i] ?? null}
          version={count}
          onPick={goTo}
        />
      )}
      <div ref={scrollRef} onScroll={onScrollPages} className="h-full min-w-0 flex-1 overflow-auto bg-gray-300">
        {/* CSS zoom rather than a transform: it changes layout size too, so the
            scrollbars match what is on screen. On a wrapper, not the marked
            element, so printing (which clones that element) is not zoomed. */}
        <div style={{ zoom: scale }} data-wz-docx-mode={viewMode} onClick={viewMode === 'grid' ? onGridClick : undefined}>
          <div ref={markedRef} {...{ [FLOW_PRINT_ATTR]: '' }}>{body}</div>
        </div>
      </div>
    </div>
  )
}
