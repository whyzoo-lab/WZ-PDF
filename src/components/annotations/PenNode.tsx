import { Line } from 'react-konva'
import type { PenAnnotation } from '../../types/annotation'

interface PenNodeProps {
  annotation: PenAnnotation
  effectiveZoom: number
}

/**
 * Volatile freehand stroke. Renders a Konva.Line with the stored points
 * scaled by `effectiveZoom` (stored values are in PDF points).
 */
export function PenNode({ annotation, effectiveZoom }: PenNodeProps) {
  // Scale every point from PDF points → screen pixels.
  const screenPoints = annotation.points.map(p => p * effectiveZoom)
  return (
    <Line
      points={screenPoints}
      stroke={annotation.color}
      strokeWidth={annotation.strokeWidth * effectiveZoom}
      opacity={annotation.opacity}
      lineCap="round"
      lineJoin="round"
      tension={0.3}
      listening={false}
    />
  )
}
