import { useCallback, useEffect, useRef, useState, memo } from 'react'
import { PdfPage } from './PdfPage'
import { useInViewport } from '../../hooks/useInViewport'
import { PDF_RENDER_SCALE } from '../../utils/constants'
import type { ViewerDoc, DocKind } from '../../types/viewerDoc'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'
import type { AppMode } from '../../types/viewModes'

// US Letter dimensions in PDF points × render scale — used as a placeholder
// size before the real page viewport is known.
const PLACEHOLDER_W = 612 * PDF_RENDER_SCALE
const PLACEHOLDER_H = 792 * PDF_RENDER_SCALE

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
  pendingStamp: { src: string; presetId?: string } | null
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
  const isRotated90 = props.rotation === 90 || props.rotation === 270

  // Swap placeholder dimensions when rotated 90/270
  let pw = isRotated90 ? PLACEHOLDER_H * props.zoom : PLACEHOLDER_W * props.zoom
  let ph = isRotated90 ? PLACEHOLDER_W * props.zoom : PLACEHOLDER_H * props.zoom
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
