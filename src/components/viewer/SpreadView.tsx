import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import { LazyPdfPage } from './LazyPdfPage'
import { buildSpreads, wideTest, type PageSize } from '../../utils/spreadLayout'
import { PDF_RENDER_SCALE } from '../../utils/constants'
import { t } from '../../i18n'
import type { Annotation, ActiveMode, OmitId, PendingStamp } from '../../types/annotation'

interface SpreadViewProps {
  pdfDoc: ViewerDoc
  kind: DocKind
  numPages: number
  zoom: number
  rotation?: number
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  pendingStamp: PendingStamp | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: OmitId<Annotation>) => void
  onRegionCopy?: (text: string) => void
  /** Rows of one or two pages (`buildSpreads`). Plain pairs when absent. */
  spreads?: number[][]
  /** Every page's size at scale 1, once known — sizes the blank partner page. */
  pageSizes?: readonly PageSize[] | null
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
  pageSizes = null,
}: SpreadViewProps) {
  // A wide page (landscape among portrait) has a row of its own.
  const pairs = spreads ?? buildSpreads(numPages, null)
  // Any other page on its own — before a wide page, or the last of an odd
  // count — gets a blank partner, as it will in "책자 형태로 저장": the view
  // shows the booklet the save writes.
  const isWide = wideTest(pageSizes, rotation)
  const turned = rotation === 90 || rotation === 270
  const blankFor = (page: number) => {
    const size = pageSizes?.[page - 1]
    if (!size || isWide(page)) return null
    const scale = PDF_RENDER_SCALE * zoom
    return { width: (turned ? size.height : size.width) * scale, height: (turned ? size.width : size.height) * scale }
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
          {pair.length === 1 && (() => {
            const blank = blankFor(pair[0])
            return blank && (
              <div
                data-spread-blank
                aria-hidden="true"
                style={blank}
                className="shadow-md bg-white flex items-center justify-center text-xs text-gray-300 select-none"
              >{t('spread.blank')}</div>
            )
          })()}
        </div>
      ))}
    </div>
  )
}
