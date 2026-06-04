import React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { LazyPdfPage } from './LazyPdfPage'
import { SpreadView } from './SpreadView'
import { GridView } from './GridView'
import { FullscreenView } from './FullscreenView'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'
import type { AppMode, ViewMode } from '../../types/viewModes'
import type { SearchMatch } from '../../hooks/useSearch'
import type { TextLayerHighlight } from './PdfTextLayer'
import type { OcrPageResult } from '../../types/ocr'

interface PdfViewerProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  zoom: number
  rotation: number
  /** Viewer/Editor toggle — enables text editing on double-click in editor mode. */
  appMode?: AppMode
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  viewMode: ViewMode
  /** Layout to use when entering fullscreen: mirrors the pre-fullscreen view mode. */
  fullscreenLayout: 'single' | 'spread'
  pendingStamp: { src: string; presetId?: string } | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: OmitId<Annotation>) => void
  onGridPageClick: (pageNumber: number) => void
  onFullscreenExit: () => void
  onCurrentPageChange: (page: number) => void
  /** Active search results (single-view highlighting). */
  search?: { matches: SearchMatch[]; activeIndex: number }
  /** Per-page OCR results (single-view text layer + search). */
  ocrResults?: Map<number, OcrPageResult>
  /** Page currently being recognized (drives the scanning animation). */
  ocrActivePage?: number | null
  /** Request OCR for a page (double-click on an un-recognized page). */
  onOcrRequest?: (page: number) => void
}

export function PdfViewer({
  pdfDoc,
  numPages,
  zoom,
  rotation,
  appMode,
  annotations,
  selectedId,
  activeMode,
  viewMode,
  fullscreenLayout,
  pendingStamp,
  pendingSignature,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
  ocrActivePage,
  onOcrRequest,
  onGridPageClick,
  onFullscreenExit,
  onCurrentPageChange,
  search,
  ocrResults,
}: PdfViewerProps) {
  // Group search hits by page → highlight descriptors, marking the active one.
  const highlightsByPage = React.useMemo(() => {
    const map = new Map<number, TextLayerHighlight[]>()
    if (!search) return map
    search.matches.forEach((m, i) => {
      const arr = map.get(m.page) ?? []
      arr.push({ itemStart: m.itemStart, itemEnd: m.itemEnd, active: i === search.activeIndex })
      map.set(m.page, arr)
    })
    return map
  }, [search])

  const sharedAnnotationProps = {
    pdfDoc,
    zoom,
    rotation,
    appMode,
    annotations,
    selectedId,
    activeMode,
    pendingStamp,
    pendingSignature,
    onAnnotationSelect,
    onAnnotationUpdate,
    onAnnotationAdd,
  }

  // ── Single-mode scroll container ref for IntersectionObserver page tracking ──
  const singleScrollRef = React.useRef<HTMLDivElement>(null)

  // Track the most visible page in single mode for the ActionBar page indicator.
  // The observer is held in a ref (not stashed on the DOM node) so cleanup is
  // type-safe and not subject to the node being swapped out by React.
  const obsRef = React.useRef<IntersectionObserver | null>(null)
  React.useEffect(() => {
    if (viewMode !== 'single') return
    onCurrentPageChange(1)
    const timer = setTimeout(() => {
      const container = singleScrollRef.current
      if (!container) return
      const pageEls = Array.from(container.querySelectorAll<HTMLElement>('[data-page-num]'))
      if (pageEls.length === 0) return
      const ratios = new Map<number, number>()
      const obs = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            const pn = Number((entry.target as HTMLElement).dataset.pageNum)
            ratios.set(pn, entry.intersectionRatio)
          })
          let best = 1, bestRatio = -1
          ratios.forEach((ratio, pn) => {
            if (ratio > bestRatio) { bestRatio = ratio; best = pn }
          })
          onCurrentPageChange(best)
        },
        { root: container, threshold: Array.from({ length: 11 }, (_, i) => i / 10) },
      )
      pageEls.forEach(el => obs.observe(el))
      obsRef.current?.disconnect()
      obsRef.current = obs
    }, 100)
    return () => {
      clearTimeout(timer)
      obsRef.current?.disconnect()
      obsRef.current = null
    }
  // onCurrentPageChange is a stable setState dispatcher; re-running only on
  // view/page-count change is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, numPages])

  if (viewMode === 'spread') {
    return <SpreadView {...sharedAnnotationProps} numPages={numPages} />
  }

  if (viewMode === 'grid') {
    return (
      <GridView
        pdfDoc={pdfDoc}
        numPages={numPages}
        rotation={rotation}
        annotations={annotations}
        onPageClick={onGridPageClick}
      />
    )
  }

  if (viewMode === 'fullscreen') {
    return (
      <FullscreenView
        pdfDoc={pdfDoc}
        numPages={numPages}
        annotations={annotations}
        selectedId={selectedId}
        layout={fullscreenLayout}
        rotation={rotation}
        activeMode={activeMode}
        onAnnotationSelect={onAnnotationSelect}
        onAnnotationUpdate={onAnnotationUpdate}
        onAnnotationAdd={onAnnotationAdd}
        onExit={onFullscreenExit}
        onCurrentPageChange={onCurrentPageChange}
      />
    )
  }

  // Default: single mode (vertically stacked pages, lazy-loaded by viewport)
  return (
    <div ref={singleScrollRef} className="flex flex-col items-center gap-4 py-6 px-4 overflow-auto h-full bg-gray-300" id="pdf-single-container">
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
        <div key={pageNum} id={`pdf-page-${pageNum}`} data-page-num={pageNum} className="shadow-xl">
          <LazyPdfPage
            {...sharedAnnotationProps}
            pageNumber={pageNum}
            searchHighlights={highlightsByPage.get(pageNum)}
            ocrResult={ocrResults?.get(pageNum)}
            ocrActive={ocrActivePage === pageNum}
            onOcrRequest={onOcrRequest}
          />
        </div>
      ))}
    </div>
  )
}
