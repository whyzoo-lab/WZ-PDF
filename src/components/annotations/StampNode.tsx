// Intentionally separate from SignatureNode to allow per-type divergence
import React, { useEffect, useState, forwardRef } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { StampAnnotation } from '../../types/annotation'

interface StampNodeProps {
  annotation: StampAnnotation
  effectiveZoom: number
  onSelect: () => void
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void
}

export const StampNode = forwardRef<Konva.Node, StampNodeProps>(
  ({ annotation, effectiveZoom, onSelect, onDragEnd, onTransformEnd }, ref) => {
    const [image, setImage] = useState<HTMLImageElement | null>(null)

    useEffect(() => {
      const img = new window.Image()
      img.src = annotation.src
      img.onload = () => setImage(img)
      img.onerror = () => console.error(`Failed to load annotation image`)
    }, [annotation.src])

    if (!image) return null

    return (
      <KonvaImage
        ref={ref as React.Ref<Konva.Image>}
        image={image}
        x={annotation.x * effectiveZoom}
        y={annotation.y * effectiveZoom}
        width={annotation.width * effectiveZoom}
        height={annotation.height * effectiveZoom}
        rotation={annotation.rotation}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
      />
    )
  },
)
StampNode.displayName = 'StampNode'
