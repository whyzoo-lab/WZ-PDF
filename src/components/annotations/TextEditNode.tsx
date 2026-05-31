import React, { forwardRef } from 'react'
import { Group, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import type { TextEditAnnotation } from '../../types/annotation'

interface TextEditNodeProps {
  annotation: TextEditAnnotation
  effectiveZoom: number
  onSelect: () => void
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void
}

/**
 * Editor text patch: paints a solid background rectangle over the original
 * PDF text and renders the edited text on top in the same font size.
 *
 * Coordinates are stored in PDF points; we multiply by `effectiveZoom`
 * (= PDF_RENDER_SCALE * zoom) to get screen pixels.
 */
export const TextEditNode = forwardRef<Konva.Node, TextEditNodeProps>(
  ({ annotation, effectiveZoom, onSelect, onDragEnd, onTransformEnd }, ref) => {
    const x = annotation.x * effectiveZoom
    const y = annotation.y * effectiveZoom
    const w = annotation.width * effectiveZoom
    const h = annotation.height * effectiveZoom
    const fs = annotation.fontSize * effectiveZoom

    return (
      <Group
        ref={ref as React.Ref<Konva.Group>}
        x={x}
        y={y}
        width={w}
        height={h}
        rotation={annotation.rotation}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
      >
        <Rect
          width={w}
          height={h}
          fill={annotation.background}
        />
        <Text
          width={w}
          height={h}
          text={annotation.text}
          fontSize={fs}
          fontFamily="sans-serif"
          fill={annotation.color}
          align="left"
          verticalAlign="middle"
          padding={2}
          listening={false}
        />
      </Group>
    )
  },
)
TextEditNode.displayName = 'TextEditNode'
