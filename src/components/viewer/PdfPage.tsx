import React, { useEffect, useState } from 'react'
import { Stage, Layer, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfPage } from '../../hooks/usePdfPage'
import { AnnotationLayer } from '../annotations/AnnotationLayer'
import type { Annotation, ActiveMode } from '../../types/annotation'
import { toStoredCoords } from '../../utils/coordinates'
import { PDF_RENDER_SCALE } from '../../utils/constants'

interface PdfPageProps {
  pdfDoc: PDFDocumentProxy
  pageNumber: number
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

export function PdfPage({
  pdfDoc,
  pageNumber,
  zoom,
  annotations,
  selectedId,
  activeMode,
  pendingStamp,
  pendingSignature,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
}: PdfPageProps) {
  const { pageData, isLoading } = usePdfPage(pdfDoc, pageNumber)
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!pageData) return
    const img = new window.Image()
    img.src = pageData.imageUrl
    img.onload = () => setBgImage(img)
    img.onerror = () => console.error(`PdfPage: failed to load image for page ${pageNumber}`)
  }, [pageData])

  if (isLoading || !pageData) {
    return (
      <div
        style={{ width: 600 * zoom, height: 800 * zoom }}
        className="bg-gray-100 animate-pulse flex items-center justify-center"
      >
        <span className="text-gray-400 text-sm">Loading page {pageNumber}…</span>
      </div>
    )
  }

  const stageWidth = pageData.width * zoom
  const stageHeight = pageData.height * zoom
  const effectiveZoom = PDF_RENDER_SCALE * zoom

  const pageAnnotations = annotations.filter(a => {
    if (a.type === 'watermark') return a.allPages || a.page === pageNumber
    return a.page === pageNumber
  })

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | Event>) => {
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()

    if (pos && activeMode === 'stamp' && pendingStamp) {
      const stored = toStoredCoords(pos.x, pos.y, effectiveZoom)
      onAnnotationAdd({
        type: 'stamp',
        page: pageNumber,
        x: stored.x - 50,
        y: stored.y - 20,
        width: 100,
        height: 40,
        rotation: 0,
        src: pendingStamp.src,
        presetId: pendingStamp.presetId,
      })
      return
    }

    if (pos && activeMode === 'signature' && pendingSignature) {
      const stored = toStoredCoords(pos.x, pos.y, effectiveZoom)
      onAnnotationAdd({
        type: 'signature',
        page: pageNumber,
        x: stored.x - 75,
        y: stored.y - 25,
        width: 150,
        height: 50,
        rotation: 0,
        src: pendingSignature,
      })
      return
    }

    if (e.target === stage) {
      onAnnotationSelect(null)
    }
  }

  const cursor =
    (activeMode === 'stamp' && pendingStamp) ||
    (activeMode === 'signature' && pendingSignature)
      ? 'crosshair'
      : 'default'

  return (
    <Stage
      width={stageWidth}
      height={stageHeight}
      onClick={handleStageClick}
      onTap={handleStageClick}
      style={{ cursor }}
    >
      <Layer>
        {bgImage && (
          <KonvaImage image={bgImage} x={0} y={0} width={stageWidth} height={stageHeight} />
        )}
      </Layer>
      <AnnotationLayer
        annotations={pageAnnotations}
        selectedId={selectedId}
        effectiveZoom={effectiveZoom}
        stageWidth={stageWidth}
        stageHeight={stageHeight}
        onSelect={onAnnotationSelect}
        onUpdate={onAnnotationUpdate}
      />
    </Stage>
  )
}
