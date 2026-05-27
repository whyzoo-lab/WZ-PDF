import { Rect } from 'react-konva'
import type { RectangleAnnotation } from '../../types/annotation'
import { toScreenCoords, toScreenSize } from '../../utils/coordinates'

interface RectangleNodeProps {
  annotation: RectangleAnnotation
  effectiveZoom: number
}

/**
 * Volatile rectangle outline (red box). Non-interactive — drawn for display only.
 */
export function RectangleNode({ annotation, effectiveZoom }: RectangleNodeProps) {
  const { x, y } = toScreenCoords(annotation.x, annotation.y, effectiveZoom)
  const { width, height } = toScreenSize(annotation.width, annotation.height, effectiveZoom)
  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      stroke={annotation.color}
      strokeWidth={annotation.strokeWidth * effectiveZoom}
      fill="transparent"
      listening={false}
    />
  )
}
