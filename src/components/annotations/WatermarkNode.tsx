import React from 'react'
import { Text as KonvaText } from 'react-konva'
import type { WatermarkAnnotation } from '../../types/annotation'
import { PDF_RENDER_SCALE } from '../../utils/constants'

interface WatermarkNodeProps {
  annotation: WatermarkAnnotation
  effectiveZoom: number
  stageWidth: number
  stageHeight: number
}

export function WatermarkNode({ annotation, effectiveZoom, stageWidth, stageHeight }: WatermarkNodeProps) {
  const displayFontSize = annotation.fontSize * (effectiveZoom / PDF_RENDER_SCALE)

  return (
    <KonvaText
      text={annotation.text}
      x={0}
      y={stageHeight / 2 - displayFontSize / 2}
      width={stageWidth}
      align="center"
      fontSize={displayFontSize}
      fill={annotation.color}
      opacity={annotation.opacity}
      rotation={annotation.rotation}
      offsetX={0}
      listening={false}
    />
  )
}
