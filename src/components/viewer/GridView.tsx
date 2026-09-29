import type { CSSProperties } from 'react'
import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import { LazyPdfPage } from './LazyPdfPage'
import type { Annotation } from '../../types/annotation'
import { PDF_RENDER_SCALE } from '../../utils/constants'
import { usePageSizes } from '../../hooks/usePageSizes'
import { median, type PageSize } from '../../utils/spreadLayout'

const GRID_ZOOM = 0.3
/** Gap between cells, px. */
const GAP = 12
/** Cell width before page sizes are known: an A4 page at the grid's scale. */
const FALLBACK_CELL = 595 * PDF_RENDER_SCALE * GRID_ZOOM

interface GridViewProps {
  pdfDoc: ViewerDoc
  kind: DocKind
  numPages: number
  rotation?: number
  annotations: Annotation[]
  onPageClick: (pageNumber: number) => void
}

/**
 * Every page as a thumbnail, packed to the window.
 *
 * This was a fixed three columns: on a wide window each third was far wider
 * than the page in it, so the pages sat far apart with a band of grey between
 * them. Columns are now the width of the document's typical page and there are
 * as many as fit, so a wide window shows more pages per row, not more gap. A
 * page much wider than the rest (a landscape page among portrait ones) spans
 * as many columns as it needs instead of overflowing its neighbour.
 */
export function GridView({ pdfDoc, kind, numPages, rotation, annotations, onPageClick }: GridViewProps) {
  const sizes = usePageSizes(pdfDoc, true)
  const turned = rotation === 90 || rotation === 270
  const widthOf = (s: PageSize) => (turned ? s.height : s.width) * PDF_RENDER_SCALE * GRID_ZOOM
  const cell = Math.ceil(sizes && sizes.length > 0 ? median(sizes.map(widthOf)) : FALLBACK_CELL)
  const spanOf = (page: number): number => {
    const size = sizes?.[page - 1]
    return size ? Math.max(1, Math.ceil((widthOf(size) + GAP) / (cell + GAP) - 0.01)) : 1
  }

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(auto-fill, ${cell}px)`,
    gap: GAP,
  }

  return (
    <div className="grid content-start justify-center p-4 overflow-auto h-full bg-gray-400" style={gridStyle}>
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => {
        const span = spanOf(pageNum)
        return (
          <button
            key={pageNum}
            className="flex flex-col items-center gap-0.5 cursor-pointer hover:opacity-80 transition-opacity bg-transparent border-0 p-0"
            style={span > 1 ? { gridColumn: `span ${span}` } : undefined}
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
        )
      })}
    </div>
  )
}
