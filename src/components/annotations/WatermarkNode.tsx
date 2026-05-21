// src/components/annotations/WatermarkNode.tsx — STUB (will be replaced in Task 8)
import React from 'react'
import { Group } from 'react-konva'
import type { WatermarkAnnotation } from '../../types/annotation'

interface WatermarkNodeProps {
  annotation: WatermarkAnnotation
  isSelected: boolean
  effectiveZoom: number
  stageWidth: number
  stageHeight: number
  onSelect: (id: string) => void
  onUpdate: (id: string, updates: Partial<WatermarkAnnotation>) => void
}

export function WatermarkNode(_props: WatermarkNodeProps) {
  return <Group />
}
