import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import { LazyPdfPage } from './LazyPdfPage'
import type { Annotation } from '../../types/annotation'

const GRID_ZOOM = 0.3

interface GridViewProps {
  pdfDoc: ViewerDoc
  kind: DocKind
  numPages: number
  rotation?: number
  annotations: Annotation[]
  onPageClick: (pageNumber: number) => void
}

export function GridView({ pdfDoc, kind, numPages, rotation, annotations, onPageClick }: GridViewProps) {
  return (
    <div className="grid grid-cols-3 gap-1 p-2 overflow-auto h-full bg-gray-400">
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
        <button
          key={pageNum}
          className="flex flex-col items-center gap-0.5 cursor-pointer hover:opacity-80 transition-opacity bg-transparent border-0 p-0"
          onClick={() => onPageClick(pageNum)}
          aria-label={`Go to page ${pageNum}`}
        >
          <div className="shadow-sm">
            <LazyPdfPage
              pdfDoc={pdfDoc}
              kind={kind}
              pageNumber={pageNum}
              zoom={GRID_ZOOM}
              rotation={rotation}
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
          <span className="text-xs text-gray-700 font-medium">{pageNum}</span>
        </button>
      ))}
    </div>
  )
}
