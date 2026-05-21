import React, { useRef, useEffect } from 'react'
import { Layer, Transformer } from 'react-konva'
import type Konva from 'konva'
import { StampNode } from './StampNode'
import { SignatureNode } from './SignatureNode'
import { WatermarkNode } from './WatermarkNode'
import type { Annotation } from '../../types/annotation'
import { toStoredCoords } from '../../utils/coordinates'

interface AnnotationLayerProps {
  annotations: Annotation[]
  selectedId: string | null
  effectiveZoom: number
  stageWidth: number
  stageHeight: number
  onSelect: (id: string | null) => void
  onUpdate: (id: string, updates: Partial<Annotation>) => void
}

export function AnnotationLayer({
  annotations,
  selectedId,
  effectiveZoom,
  stageWidth,
  stageHeight,
  onSelect,
  onUpdate,
}: AnnotationLayerProps) {
  const trRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map())

  useEffect(() => {
    if (!trRef.current) return
    const node = selectedId ? nodeRefs.current.get(selectedId) : null
    trRef.current.nodes(node ? [node] : [])
    trRef.current.getLayer()?.batchDraw()
  }, [selectedId])

  const handleDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const stored = toStoredCoords(e.target.x(), e.target.y(), effectiveZoom)
    onUpdate(id, { x: stored.x, y: stored.y })
  }

  const handleTransformEnd = (id: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    const stored = toStoredCoords(node.x(), node.y(), effectiveZoom)
    onUpdate(id, {
      x: stored.x,
      y: stored.y,
      width: (node.width() * scaleX) / effectiveZoom,
      height: (node.height() * scaleY) / effectiveZoom,
      rotation: node.rotation(),
    })
  }

  const setRef = (id: string) => (node: Konva.Node | null) => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }

  return (
    <Layer>
      {annotations.map(annotation => {
        if (annotation.type === 'watermark') {
          return (
            <WatermarkNode
              key={annotation.id}
              annotation={annotation}
              effectiveZoom={effectiveZoom}
              stageWidth={stageWidth}
              stageHeight={stageHeight}
            />
          )
        }

        const sharedProps = {
          effectiveZoom,
          onSelect: () => onSelect(annotation.id),
          onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => handleDragEnd(annotation.id, e),
          onTransformEnd: (e: Konva.KonvaEventObject<Event>) => handleTransformEnd(annotation.id, e),
          ref: setRef(annotation.id),
        }

        if (annotation.type === 'stamp') {
          return <StampNode key={annotation.id} annotation={annotation} {...sharedProps} />
        }
        if (annotation.type === 'signature') {
          return <SignatureNode key={annotation.id} annotation={annotation} {...sharedProps} />
        }
        return null
      })}
      <Transformer
        ref={trRef}
        rotateEnabled
        boundBoxFunc={(oldBox, newBox) =>
          newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
        }
      />
    </Layer>
  )
}
