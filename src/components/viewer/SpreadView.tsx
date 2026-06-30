import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import { LazyPdfPage } from './LazyPdfPage'
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
}: SpreadViewProps) {
  // Build pairs: [[1,2], [3,4], [5]] for numPages=5
  const pairs: number[][] = []
  for (let i = 1; i <= numPages; i += 2) {
    pairs.push(i + 1 <= numPages ? [i, i + 1] : [i])
  }

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
  }

  return (
    <div className="flex flex-col items-center gap-2 py-4 px-2 overflow-auto h-full bg-gray-300">
      {pairs.map((pair, idx) => (
        <div key={idx} data-spread-row className="flex gap-0">
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
