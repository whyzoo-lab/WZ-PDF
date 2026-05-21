// src/components/annotations/AnnotationLayer.tsx — STUB (will be replaced in Task 8)
import React from 'react'
import { Layer } from 'react-konva'
import type { Annotation } from '../../types/annotation'

interface AnnotationLayerProps {
  annotations: Annotation[]
  selectedId: string | null
  effectiveZoom: number
  stageWidth: number
  stageHeight: number
  onSelect: (id: string | null) => void
  onUpdate: (id: string, updates: Partial<Annotation>) => void
}

export function AnnotationLayer(_props: AnnotationLayerProps) {
  return <Layer />
}
