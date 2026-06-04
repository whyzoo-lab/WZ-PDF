import { useRef } from 'react'
import { PdfPage } from './PdfPage'
import { useInViewport } from '../../hooks/useInViewport'
import { PDF_RENDER_SCALE } from '../../utils/constants'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Annotation, ActiveMode, OmitId } from '../../types/annotation'
import type { AppMode } from '../../types/viewModes'

// US Letter dimensions in PDF points × render scale — used as a placeholder
// size before the real page viewport is known.
const PLACEHOLDER_W = 612 * PDF_RENDER_SCALE
const PLACEHOLDER_H = 792 * PDF_RENDER_SCALE

interface LazyPdfPageProps {
  pdfDoc: PDFDocumentProxy
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
}

/**
 * Wraps PdfPage with IntersectionObserver gating. Only mounts the heavy
 * Konva Stage when the container is near the viewport. Once mounted, stays
 * mounted — `usePdfPage`'s module-level cache handles re-mount fast-path.
 */
export function LazyPdfPage(props: LazyPdfPageProps) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInViewport(ref)
  const isRotated90 = props.rotation === 90 || props.rotation === 270

  // Swap placeholder dimensions when rotated 90/270
  const pw = isRotated90 ? PLACEHOLDER_H * props.zoom : PLACEHOLDER_W * props.zoom
  const ph = isRotated90 ? PLACEHOLDER_W * props.zoom : PLACEHOLDER_H * props.zoom

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
}
