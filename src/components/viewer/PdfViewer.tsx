import React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import type { Annotation, ActiveMode } from '../../types/annotation'

interface PdfViewerProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  zoom: number
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  pendingStamp: { src: string; presetId?: string } | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: Omit<Annotation, 'id'>) => void
}

export function PdfViewer({
  pdfDoc,
  numPages,
  zoom,
  annotations,
  selectedId,
  activeMode,
  pendingStamp,
  pendingSignature,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
}: PdfViewerProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4 overflow-auto h-full bg-gray-300">
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
        <div key={pageNum} className="shadow-xl">
          <PdfPage
            pdfDoc={pdfDoc}
            pageNumber={pageNum}
            zoom={zoom}
            annotations={annotations}
            selectedId={selectedId}
            activeMode={activeMode}
            pendingStamp={pendingStamp}
            pendingSignature={pendingSignature}
            onAnnotationSelect={onAnnotationSelect}
            onAnnotationUpdate={onAnnotationUpdate}
            onAnnotationAdd={onAnnotationAdd}
          />
        </div>
      ))}
    </div>
  )
}
