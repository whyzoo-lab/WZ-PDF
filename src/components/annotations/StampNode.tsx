// src/components/annotations/StampNode.tsx — STUB (will be replaced in Task 8)
import React from 'react'
import { Group } from 'react-konva'
import type { StampAnnotation } from '../../types/annotation'

interface StampNodeProps {
  annotation: StampAnnotation
  isSelected: boolean
  effectiveZoom: number
  onSelect: (id: string) => void
  onUpdate: (id: string, updates: Partial<StampAnnotation>) => void
}

export function StampNode(_props: StampNodeProps) {
  return <Group />
}
