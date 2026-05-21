// src/components/annotations/SignatureNode.tsx — STUB (will be replaced in Task 8)
import React from 'react'
import { Group } from 'react-konva'
import type { SignatureAnnotation } from '../../types/annotation'

interface SignatureNodeProps {
  annotation: SignatureAnnotation
  isSelected: boolean
  effectiveZoom: number
  onSelect: (id: string) => void
  onUpdate: (id: string, updates: Partial<SignatureAnnotation>) => void
}

export function SignatureNode(_props: SignatureNodeProps) {
  return <Group />
}
