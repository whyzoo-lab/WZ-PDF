import React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import { SpreadView } from './SpreadView'
import { GridView } from './GridView'
import { FullscreenView } from './FullscreenView'
import type { Annotation, ActiveMode } from '../../types/annotation'
import type { ViewMode } from '../../types/viewModes'

interface PdfViewerProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  zoom: number
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  viewMode: ViewMode
  pendingStamp: { src: string; presetId?: string } | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: Omit<Annotation, 'id'>) => void
  onGridPageClick: (pageNumber: number) => void
  onFullscreenExit: () => void
}

export function PdfViewer({
  pdfDoc,
  numPages,
  zoom,
  annotations,
  selectedId,
  activeMode,
  viewMode,
  pendingStamp,
  pendingSignature,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
  onGridPageClick,
  onFullscreenExit,
}: PdfViewerProps) {
  const sharedAnnotationProps = {
    pdfDoc,
    zoom,
    annotations,
    selectedId,
    activeMode,
    pendingStamp,
    pendingSignature,
    onAnnotationSelect,
    onAnnotationUpdate,
    onAnnotationAdd,
  }

  if (viewMode === 'spread') {
    return <SpreadView {...sharedAnnotationProps} numPages={numPages} />
  }

  if (viewMode === 'grid') {
    return (
      <GridView
        pdfDoc={pdfDoc}
        numPages={numPages}
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
        onAnnotationSelect={onAnnotationSelect}
        onAnnotationUpdate={onAnnotationUpdate}
        onExit={onFullscreenExit}
      />
    )
  }

  // Default: single mode
  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4 overflow-auto h-full bg-gray-300">
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
        <div key={pageNum} id={`pdf-page-${pageNum}`} className="shadow-xl">
          <PdfPage {...sharedAnnotationProps} pageNumber={pageNum} />
        </div>
      ))}
    </div>
  )
}
