export type PresentColor = '#ef4444' | '#22c55e' | '#3b82f6' | '#eab308' | '#f97316'
export type PresentToolKind = 'pen' | 'highlighter' | 'rect' | 'arrow' | 'laser' | 'zoom'

export interface PresentToolState {
  kind: PresentToolKind | null
  color: PresentColor
  width: number
}

/** Transient presenter stroke in SCREEN pixels (never exported, cleared per slide). */
export type PresentStroke =
  | { id: string; kind: 'pen' | 'highlighter'; color: PresentColor; width: number; points: number[] }
  | { id: string; kind: 'rect' | 'arrow'; color: PresentColor; width: number; x1: number; y1: number; x2: number; y2: number }
