import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import { LazyPdfPage } from './LazyPdfPage'
import { buildSpreads } from '../../utils/spreadLayout'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'

interface SpreadViewProps {
  pdfDoc: ViewerDoc
  kind: DocKind
  numPages: number
  zoom: number
  rotation?: number
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  pendingStamp: { src: string; presetId?: string } | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: OmitId<Annotation>) => void
  onRegionCopy?: (text: string) => void
  /** Rows of one or two pages (`buildSpreads`). Plain pairs when absent. */
  spreads?: number[][]
}

export function SpreadView({
  pdfDoc,
  kind,
  numPages,
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
  onRegionCopy,
  spreads,
}: SpreadViewProps) {
  // A wide page (landscape among portrait) has a row of its own.
  const pairs = spreads ?? buildSpreads(numPages, null)

  const pageProps = {
    pdfDoc,
    kind,
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
    onRegionCopy,
  }

  return (
    <div className="flex flex-col items-center gap-2 py-4 px-2 overflow-auto h-full bg-gray-300">
      {pairs.map(pair => (
        // Keyed by the first page: rows are re-cut once page sizes arrive, and
        // an index key would hand one row's mounted pages to another.
        <div key={pair[0]} data-spread-row className="flex gap-0">
          {pair.map(pageNum => (
            <div key={pageNum} className="shadow-md">
              <LazyPdfPage {...pageProps} pageNumber={pageNum} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
