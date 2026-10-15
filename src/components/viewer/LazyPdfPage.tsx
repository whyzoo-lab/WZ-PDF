import { useCallback, useEffect, useRef, useState, memo } from 'react'
import { PdfPage } from './PdfPage'
import { useInViewport } from '../../hooks/useInViewport'
import { pagePlaceholder } from '../../utils/pagePlaceholder'
import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import type { Annotation, ActiveMode, OmitId, PendingStamp } from '../../types/annotation'
import type { AppMode } from '../../types/viewModes'

interface LazyPdfPageProps {
  pdfDoc: ViewerDoc
  kind: DocKind
  pageNumber: number
  zoom: number
  rotation?: number
  appMode?: AppMode
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  pendingStamp: PendingStamp | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: OmitId<Annotation>) => void
  searchHighlights?: import('./PdfTextLayer').TextLayerHighlight[]
  ocrResult?: import('../../types/ocr').OcrPageResult
  ocrActive?: boolean
  onOcrRequest?: (page: number) => void
  /** Ctrl+drag region → OCR → clipboard (view mode). Receives the recognized text. */
  onRegionCopy?: (text: string) => void
}

/**
 * Wraps PdfPage with IntersectionObserver gating. Only mounts the heavy
 * Konva Stage when the container is near the viewport, and unmounts it again
 * once it is well out of view (see useInViewport) — the render cache makes
 * coming back cheap.
 *
 * A page that has been shown leaves behind a placeholder of its own measured
 * size, scaled with the zoom. Falling back to the generic Letter placeholder
 * would change the height of every page above the reader as they unmount, and
 * the document would jump under them.
 */
export const LazyPdfPage = memo(function LazyPdfPage(props: LazyPdfPageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(props.zoom)
  useEffect(() => { zoomRef.current = props.zoom })
  const [held, setHeld] = useState<{ w: number; h: number; zoom: number; rotation?: number } | null>(null)
  const onLeave = useCallback(() => {
    const el = ref.current
    if (el) setHeld({ w: el.offsetWidth, h: el.offsetHeight, zoom: zoomRef.current, rotation: props.rotation })
  }, [props.rotation])
  const inView = useInViewport(ref, { onLeave })
  const guess = pagePlaceholder(props.pdfDoc, props.pageNumber, props.zoom, props.rotation)
  let pw = guess.width
  let ph = guess.height
  if (held && held.rotation === props.rotation && held.w > 0 && held.h > 0) {
    const k = props.zoom / held.zoom
    pw = held.w * k
    ph = held.h * k
  }

  return (
    <div ref={ref}>
      {inView ? (
        <PdfPage {...props} />
      ) : (
        <div
          style={{ width: pw, height: ph }}
          className="bg-gray-100"
        />
      )}
    </div>
  )
})
