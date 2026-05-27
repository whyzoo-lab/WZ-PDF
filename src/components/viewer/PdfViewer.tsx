import React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { LazyPdfPage } from './LazyPdfPage'
import { SpreadView } from './SpreadView'
import { GridView } from './GridView'
import { FullscreenView } from './FullscreenView'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'
import type { ViewMode } from '../../types/viewModes'

interface PdfViewerProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  zoom: number
  rotation: number
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
}

export function PdfViewer({
  pdfDoc,
  numPages,
  zoom,
  rotation,
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
  onGridPageClick,
  onFullscreenExit,
  onCurrentPageChange,
}: PdfViewerProps) {
  const sharedAnnotationProps = {
    pdfDoc,
    zoom,
    rotation,
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
      ;(container as HTMLDivElement & { _obs?: IntersectionObserver })._obs?.disconnect()
      ;(container as HTMLDivElement & { _obs?: IntersectionObserver })._obs = obs
    }, 100)
    return () => {
      clearTimeout(timer)
      const containerForCleanup = singleScrollRef.current
      if (containerForCleanup) {
        ;(containerForCleanup as HTMLDivElement & { _obs?: IntersectionObserver })._obs?.disconnect()
      }
    }
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
          <LazyPdfPage {...sharedAnnotationProps} pageNumber={pageNum} />
        </div>
      ))}
    </div>
  )
}
