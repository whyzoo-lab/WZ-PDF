import type { PresentColor, PresentToolKind, PresentToolState } from '../types/present'

export const PRESENT_COLORS: PresentColor[] = ['#ef4444', '#22c55e', '#3b82f6', '#eab308', '#f97316']
const COLOR_BY_KEY: Record<string, PresentColor> = {
  '1': '#ef4444', '2': '#22c55e', '3': '#3b82f6', '4': '#eab308', '5': '#f97316',
}
const TOOL_BY_KEY: Record<string, PresentToolKind> = {
  p: 'pen', h: 'highlighter', r: 'rect', a: 'arrow', l: 'laser', z: 'zoom',
}

export const MIN_PEN_WIDTH = 2
export const MAX_PEN_WIDTH = 24
const WIDTH_STEP = 2

export const MIN_ZOOM_SPOT = 1.5
export const MAX_ZOOM_SPOT = 5

export const DEFAULT_TOOL_STATE: PresentToolState = { kind: null, color: '#ef4444', width: 4 }

/** True for tools that draw committed strokes (pen/highlighter/rect/arrow). */
export function isDrawingTool(kind: PresentToolKind | null): boolean {
  return kind === 'pen' || kind === 'highlighter' || kind === 'rect' || kind === 'arrow'
}

/**
 * Apply a key press to the tool state. Returns the new state, or null when the
 * key isn't a presenter shortcut (so the caller can let it fall through to nav).
 */
export function reducePresentTool(state: PresentToolState, key: string): PresentToolState | null {
  const lower = key.toLowerCase()
  if (lower in TOOL_BY_KEY) {
    const tool = TOOL_BY_KEY[lower]
    return { ...state, kind: state.kind === tool ? null : tool } // re-press toggles off
  }
  if (key in COLOR_BY_KEY) return { ...state, color: COLOR_BY_KEY[key] }
  if (key === '[') return { ...state, width: Math.max(MIN_PEN_WIDTH, state.width - WIDTH_STEP) }
  if (key === ']') return { ...state, width: Math.min(MAX_PEN_WIDTH, state.width + WIDTH_STEP) }
  return null
}

/** Three points of the arrowhead triangle; tip first, then the two barbs. */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): [number, number][] {
  if (x1 === x2 && y1 === y2) return [[x2, y2], [x2, y2], [x2, y2]]
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const spread = Math.PI / 7
  const a1 = angle + Math.PI - spread
  const a2 = angle + Math.PI + spread
  return [
    [x2, y2],
    [x2 + size * Math.cos(a1), y2 + size * Math.sin(a1)],
    [x2 + size * Math.cos(a2), y2 + size * Math.sin(a2)],
  ]
}

/** CSS for the spotlight zoom: scale the page anchored at the cursor. */
export function spotZoomStyle(scale: number, focalX: number, focalY: number): { transform: string; transformOrigin: string } {
  return { transform: `scale(${scale})`, transformOrigin: `${focalX}px ${focalY}px` }
}
