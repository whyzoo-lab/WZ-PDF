import React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import type { Annotation } from '../../types/annotation'

const GRID_ZOOM = 0.3

interface GridViewProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  annotations: Annotation[]
  onPageClick: (pageNumber: number) => void
}

export function GridView({ pdfDoc, numPages, annotations, onPageClick }: GridViewProps) {
  return (
    <div className="grid grid-cols-3 gap-4 p-6 overflow-auto h-full bg-gray-300">
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
        <button
          key={pageNum}
          className="flex flex-col items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity bg-transparent border-0 p-0"
          onClick={() => onPageClick(pageNum)}
          aria-label={`Go to page ${pageNum}`}
        >
          <div className="shadow-md">
            <PdfPage
              pdfDoc={pdfDoc}
              pageNumber={pageNum}
              zoom={GRID_ZOOM}
              annotations={annotations}
              selectedId={null}
              activeMode={null}
              pendingStamp={null}
              pendingSignature={null}
              onAnnotationSelect={() => {}}
              onAnnotationUpdate={() => {}}
              onAnnotationAdd={() => {}}
            />
          </div>
          <span className="text-xs text-gray-600">{pageNum}</span>
        </button>
      ))}
    </div>
  )
}
