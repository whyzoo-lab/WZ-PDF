# Presentation Tools (ZoomIt-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fullscreen-only, volatile presenter toolkit — laser pointer, spotlight zoom, and transient drawing (pen, highlighter, rectangle, arrow, color/width, undo) — via a self-contained `PresentationOverlay`, without touching the annotation/export system.

**Architecture:** `FullscreenView` owns presenter state (`presentTool`, `strokes`, `spotZoom`) and a ZoomIt-style keymap; a controlled `PresentationOverlay` renders screen-space strokes as SVG and reports new strokes via a callback. Pure logic (key→tool reducer, arrowhead geometry, spot-zoom transform) lives in `src/utils/presentTools.ts`. In fullscreen, `App.tsx`'s capture-phase markup shortcuts (`1`/`2`/markup-Esc) are disabled so `FullscreenView` fully owns the keymap.

**Tech Stack:** React 19, TypeScript, Vitest + React Testing Library. SVG overlay (no new deps).

**Spec:** `docs/superpowers/specs/2026-06-08-presentation-tools-design.md`

---

## Key existing code this builds on

- `src/components/viewer/FullscreenView.tsx` — owns `zoom`, `currentPage`, a window `keydown` handler (nav/zoom/Esc), a `wheel` handler, and renders `<PdfPage>`. Its root `<div>` has an `onClick` that advances pages on non-canvas clicks (already suppressed while `activeMode` is `'pen'`/`'rectangle'`).
- `src/App.tsx:136-223` — a single **capture-phase** `window.keydown` listener. It handles `1`→pen / `2`→rectangle (annotation markup) and a markup-Esc two-step. Capture phase means it runs **before** `FullscreenView`'s listener. These must be gated to `viewMode !== 'fullscreen'` so the presenter keymap works.
- Coordinates here are **screen pixels** — unrelated to the PDF-point annotation coordinate system.

## File structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/types/present.ts` | `PresentColor`, `PresentToolKind`, `PresentToolState`, `PresentStroke` | Create |
| `src/utils/presentTools.ts` | Pure: color/width constants, `reducePresentTool`, `arrowHead`, `spotZoomStyle` | Create |
| `src/utils/presentTools.test.ts` | Unit tests for the pure logic | Create |
| `src/components/viewer/PresentationOverlay.tsx` | Controlled SVG overlay: render strokes + pointer drawing + laser | Create |
| `src/components/viewer/PresentationOverlay.test.tsx` | RTL render + pointer-draw tests | Create |
| `src/components/viewer/FullscreenView.tsx` | State, keymap, HUD, spot-zoom transform, clear-on-page, mount overlay | Modify |
| `src/App.tsx` | Gate markup `1`/`2`/Esc to non-fullscreen | Modify |
| `src/i18n/en.ts`, `src/i18n/ko.ts` | `present.*` HUD/hint keys | Modify |

---

## Task 1: Types + pure presenter logic (TDD)

**Files:**
- Create: `src/types/present.ts`
- Create: `src/utils/presentTools.ts`
- Test: `src/utils/presentTools.test.ts`

- [ ] **Step 1: Define the types** — create `src/types/present.ts`:
```typescript
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
```

- [ ] **Step 2: Write the failing test** — create `src/utils/presentTools.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { reducePresentTool, arrowHead, spotZoomStyle, DEFAULT_TOOL_STATE, MIN_PEN_WIDTH, MAX_PEN_WIDTH } from './presentTools'

describe('reducePresentTool', () => {
  it('maps tool letters to tool kinds (case-insensitive)', () => {
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'p')?.kind).toBe('pen')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'H')?.kind).toBe('highlighter')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'r')?.kind).toBe('rect')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'a')?.kind).toBe('arrow')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'l')?.kind).toBe('laser')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'z')?.kind).toBe('zoom')
  })

  it('toggles the active tool off when its key is pressed again', () => {
    const pen = reducePresentTool(DEFAULT_TOOL_STATE, 'p')!
    expect(reducePresentTool(pen, 'p')?.kind).toBeNull()
  })

  it('maps number keys 1-5 to colors', () => {
    expect(reducePresentTool(DEFAULT_TOOL_STATE, '2')?.color).toBe('#22c55e')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, '5')?.color).toBe('#f97316')
  })

  it('adjusts and clamps width with [ and ]', () => {
    const wide = reducePresentTool({ ...DEFAULT_TOOL_STATE, width: MAX_PEN_WIDTH }, ']')!
    expect(wide.width).toBe(MAX_PEN_WIDTH)
    const thin = reducePresentTool({ ...DEFAULT_TOOL_STATE, width: MIN_PEN_WIDTH }, '[')!
    expect(thin.width).toBe(MIN_PEN_WIDTH)
    expect(reducePresentTool({ ...DEFAULT_TOOL_STATE, width: 8 }, '[')!.width).toBe(6)
  })

  it('returns null for keys it does not handle', () => {
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'q')).toBeNull()
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'ArrowRight')).toBeNull()
  })
})

describe('arrowHead', () => {
  it('returns three points with the tip at (x2,y2)', () => {
    const pts = arrowHead(0, 0, 10, 0, 6)
    expect(pts).toHaveLength(3)
    expect(pts[0]).toEqual([10, 0]) // tip
    expect(pts[1][0]).toBeLessThan(10) // barbs are behind the tip
    expect(pts[2][0]).toBeLessThan(10)
  })

  it('degenerates safely for a zero-length arrow', () => {
    expect(arrowHead(5, 5, 5, 5, 6)).toEqual([[5, 5], [5, 5], [5, 5]])
  })
})

describe('spotZoomStyle', () => {
  it('builds a scale transform anchored at the focal point', () => {
    expect(spotZoomStyle(2, 100, 200)).toEqual({ transform: 'scale(2)', transformOrigin: '100px 200px' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/utils/presentTools.test.ts`
Expected: FAIL — `./presentTools` missing.

- [ ] **Step 4: Implement** — create `src/utils/presentTools.ts`:
```typescript
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/utils/presentTools.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/types/present.ts src/utils/presentTools.ts src/utils/presentTools.test.ts
git commit -m "feat(present): presenter tool types + pure key/arrow/zoom logic"
```

---

## Task 2: PresentationOverlay (TDD, RTL)

**Files:**
- Create: `src/components/viewer/PresentationOverlay.tsx`
- Test: `src/components/viewer/PresentationOverlay.test.tsx`

- [ ] **Step 1: Write the failing test** — create `src/components/viewer/PresentationOverlay.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { PresentationOverlay } from './PresentationOverlay'
import { DEFAULT_TOOL_STATE } from '../../utils/presentTools'
import type { PresentStroke } from '../../types/present'

const strokes: PresentStroke[] = [
  { id: 'a', kind: 'pen', color: '#ef4444', width: 4, points: [0, 0, 10, 10] },
  { id: 'b', kind: 'rect', color: '#3b82f6', width: 4, x1: 5, y1: 5, x2: 25, y2: 35 },
  { id: 'c', kind: 'arrow', color: '#22c55e', width: 4, x1: 0, y1: 0, x2: 40, y2: 0 },
]

describe('PresentationOverlay', () => {
  it('renders committed strokes (polyline + rect + arrow group)', () => {
    const { container } = render(
      <PresentationOverlay strokes={strokes} tool={DEFAULT_TOOL_STATE} onAddStroke={() => {}} />,
    )
    expect(container.querySelector('polyline')).not.toBeNull()
    expect(container.querySelector('rect')).not.toBeNull()
    // arrow = line + polygon head
    expect(container.querySelector('line')).not.toBeNull()
    expect(container.querySelector('polygon')).not.toBeNull()
  })

  it('does not capture pointer events when no drawing tool is active', () => {
    const { container } = render(
      <PresentationOverlay strokes={[]} tool={{ ...DEFAULT_TOOL_STATE, kind: null }} onAddStroke={() => {}} />,
    )
    const svg = container.querySelector('svg') as SVGElement
    expect(getComputedStyle(svg).pointerEvents).toBe('none')
  })

  it('commits a rectangle stroke on pointer down→move→up', () => {
    const onAddStroke = vi.fn()
    const { container } = render(
      <PresentationOverlay strokes={[]} tool={{ kind: 'rect', color: '#ef4444', width: 4 }} onAddStroke={onAddStroke} />,
    )
    const svg = container.querySelector('svg') as SVGElement
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(svg, { clientX: 30, clientY: 50 })
    fireEvent.pointerUp(svg, { clientX: 30, clientY: 50 })
    expect(onAddStroke).toHaveBeenCalledTimes(1)
    expect(onAddStroke.mock.calls[0][0]).toMatchObject({ kind: 'rect', x1: 10, y1: 10, x2: 30, y2: 50 })
  })

  it('shows a laser dot when the laser tool is active', () => {
    const { container } = render(
      <PresentationOverlay strokes={[]} tool={{ kind: 'laser', color: '#ef4444', width: 4 }} onAddStroke={() => {}} />,
    )
    fireEvent.pointerMove(window, { clientX: 100, clientY: 120 })
    expect(container.querySelector('.wz-laser-dot')).not.toBeNull()
  })
})
```

Note: the overlay reads pointer coordinates from `clientX/clientY` relative to the SVG's bounding box. In jsdom `getBoundingClientRect()` returns zeros, so `clientX` maps 1:1 to local coordinates — the assertions above assume that.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/viewer/PresentationOverlay.test.tsx`
Expected: FAIL — `./PresentationOverlay` missing.

- [ ] **Step 3: Implement** — create `src/components/viewer/PresentationOverlay.tsx`:
```typescript
import { useRef, useState, useEffect } from 'react'
import type { PresentStroke, PresentToolState } from '../../types/present'
import { arrowHead, isDrawingTool } from '../../utils/presentTools'

interface PresentationOverlayProps {
  strokes: PresentStroke[]
  tool: PresentToolState
  onAddStroke: (stroke: PresentStroke) => void
}

let strokeSeq = 0
const nextId = () => `s${++strokeSeq}`

/** Local coords from a pointer event relative to the SVG element. */
function localPoint(svg: SVGSVGElement | null, e: { clientX: number; clientY: number }) {
  const r = svg?.getBoundingClientRect()
  return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
}

function renderStroke(s: PresentStroke) {
  const opacity = s.kind === 'highlighter' ? 0.35 : 1
  if (s.kind === 'pen' || s.kind === 'highlighter') {
    return (
      <polyline key={s.id} points={pointsAttr(s.points)} fill="none"
        stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />
    )
  }
  if (s.kind === 'rect') {
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2)
    const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1)
    return <rect key={s.id} x={x} y={y} width={w} height={h} fill="none" stroke={s.color} strokeWidth={s.width} />
  }
  // arrow
  const head = arrowHead(s.x1, s.y1, s.x2, s.y2, Math.max(12, s.width * 3))
  return (
    <g key={s.id}>
      <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" />
      <polygon points={head.map(p => `${p[0]},${p[1]}`).join(' ')} fill={s.color} />
    </g>
  )
}

const pointsAttr = (pts: number[]) => {
  let out = ''
  for (let i = 0; i < pts.length; i += 2) out += `${pts[i]},${pts[i + 1]} `
  return out.trim()
}

export function PresentationOverlay({ strokes, tool, onAddStroke }: PresentationOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<PresentStroke | null>(null)
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null)
  const drawing = isDrawingTool(tool.kind)

  // Laser: track the cursor without capturing clicks (overlay stays click-through).
  useEffect(() => {
    if (tool.kind !== 'laser') { setLaser(null); return }
    const onMove = (e: MouseEvent) => setLaser(localPoint(svgRef.current, e))
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [tool.kind])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!drawing) return
    const p = localPoint(svgRef.current, e)
    if (tool.kind === 'pen' || tool.kind === 'highlighter') {
      setDraft({ id: nextId(), kind: tool.kind, color: tool.color, width: tool.width, points: [p.x, p.y] })
    } else {
      setDraft({ id: nextId(), kind: tool.kind as 'rect' | 'arrow', color: tool.color, width: tool.width, x1: p.x, y1: p.y, x2: p.x, y2: p.y })
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draft) return
    const p = localPoint(svgRef.current, e)
    setDraft(d => {
      if (!d) return d
      if (d.kind === 'pen' || d.kind === 'highlighter') return { ...d, points: [...d.points, p.x, p.y] }
      return { ...d, x2: p.x, y2: p.y }
    })
  }
  const onPointerUp = () => {
    if (draft) onAddStroke(draft)
    setDraft(null)
  }

  return (
    <svg
      ref={svgRef}
      className="wz-present-overlay no-print"
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 55, pointerEvents: drawing ? 'auto' : 'none', cursor: drawing ? 'crosshair' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {strokes.map(renderStroke)}
      {draft && renderStroke(draft)}
      {laser && (
        <circle className="wz-laser-dot" cx={laser.x} cy={laser.y} r={9} fill="rgba(239,68,68,0.85)"
          style={{ filter: 'drop-shadow(0 0 8px rgba(239,68,68,0.9))' }} />
      )}
    </svg>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/viewer/PresentationOverlay.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add src/components/viewer/PresentationOverlay.tsx src/components/viewer/PresentationOverlay.test.tsx
git commit -m "feat(present): PresentationOverlay (SVG strokes + pointer drawing + laser)"
```

---

## Task 3: Wire the toolkit into FullscreenView + gate App keymap (Modify)

**Files:**
- Modify: `src/components/viewer/FullscreenView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Gate App's markup shortcuts to non-fullscreen**

In `src/App.tsx`, the capture-phase keydown handler (around lines 197-217) handles markup-Esc and `1`/`2`. Wrap those three blocks so they only run when NOT in fullscreen — the presenter keymap owns fullscreen. Change the markup-Esc guard and the `1`/`2` blocks to bail in fullscreen by inserting this line immediately AFTER `if (!pdfDoc || inInput) return` (the existing line ~188):
```typescript
      // In fullscreen, FullscreenView owns the (ZoomIt-style) presenter keymap,
      // so skip the normal-view markup shortcuts (Esc two-step, 1=pen, 2=rect).
      const inPresentation = viewMode === 'fullscreen'
```
Then change `if (e.key === 'Escape') {` (the markup two-step, ~line 197) to:
```typescript
      if (e.key === 'Escape' && !inPresentation) {
```
and change `if (e.key === '1') {` to `if (e.key === '1' && !inPresentation) {`
and `if (e.key === '2') {` to `if (e.key === '2' && !inPresentation) {`.
(`viewMode` is already in the effect's dependency array, so no dep change is needed.)

- [ ] **Step 2: Add presenter state + imports to FullscreenView**

In `src/components/viewer/FullscreenView.tsx`, add imports near the top:
```typescript
import { PresentationOverlay } from './PresentationOverlay'
import { PresentationHud } from './PresentationHud'
import { reducePresentTool, spotZoomStyle, isDrawingTool, DEFAULT_TOOL_STATE, MIN_ZOOM_SPOT, MAX_ZOOM_SPOT } from '../../utils/presentTools'
import type { PresentStroke, PresentToolState } from '../../types/present'
```
Add these spot-zoom bounds to `src/utils/presentTools.ts` (append) — `export const MIN_ZOOM_SPOT = 1.5` and `export const MAX_ZOOM_SPOT = 5`.

Inside the component, after the existing `const [zoom, setZoom] = useState(1)`, add:
```typescript
  const [tool, setTool] = useState<PresentToolState>(DEFAULT_TOOL_STATE)
  const [strokes, setStrokes] = useState<PresentStroke[]>([])
  const [spot, setSpot] = useState<{ scale: number; x: number; y: number } | null>(null)
```

- [ ] **Step 3: Clear strokes when the slide changes**

Add an effect (near the other effects):
```typescript
  // Presenter strokes are per-slide and transient.
  useEffect(() => { setStrokes([]); setSpot(null) }, [currentPage])
```

- [ ] **Step 4: Extend the keydown handler**

In the existing `onKey` handler, BEFORE the navigation `if` blocks (right after the `Escape` block), insert presenter handling. The Escape block (lines ~120-128) must become two-step aware — replace it with:
```typescript
      if (e.key === 'Escape') {
        e.preventDefault()
        // 1st press: clear any presenter state. 2nd press (clean): exit.
        if (strokes.length > 0 || tool.kind !== null || spot) {
          setStrokes([]); setTool(DEFAULT_TOOL_STATE); setSpot(null)
          return
        }
        if (document.fullscreenElement) {
          document.exitFullscreen().then(safeExit).catch(safeExit)
        } else {
          safeExit()
        }
        return
      }

      // ── Presenter tools (ZoomIt-style) ──────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { // undo last stroke
        e.preventDefault(); setStrokes(s => s.slice(0, -1)); return
      }
      if (e.key.toLowerCase() === 'e') { e.preventDefault(); setStrokes([]); return } // erase all
      {
        const next = reducePresentTool(tool, e.key)
        if (next) {
          e.preventDefault()
          setTool(next)
          // Entering/leaving the zoom tool toggles the spotlight.
          if (next.kind === 'zoom') setSpot({ scale: 2, x: window.innerWidth / 2, y: window.innerHeight / 2 })
          else if (tool.kind === 'zoom') setSpot(null)
          return
        }
      }
```
Add `tool`, `strokes`, `spot` to this effect's dependency array (it currently is `[step, maxPage, safeExit]` → `[step, maxPage, safeExit, tool, strokes, spot]`).

- [ ] **Step 5: Spotlight-zoom follows the cursor + wheel adjusts magnification**

Add a `mousemove` effect:
```typescript
  useEffect(() => {
    if (!spot) return
    const onMove = (e: MouseEvent) => setSpot(s => (s ? { ...s, x: e.clientX, y: e.clientY } : s))
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [spot])
```
In the existing `onWheel` handler, add at the very top (before the Ctrl check) so the wheel zooms the spotlight when active:
```typescript
      if (spot) {
        e.preventDefault()
        const d = e.deltaY < 0 ? 0.25 : -0.25
        setSpot(s => (s ? { ...s, scale: Math.max(MIN_ZOOM_SPOT, Math.min(MAX_ZOOM_SPOT, s.scale + d)) } : s))
        return
      }
```
Add `spot` to the `onWheel` effect's dependency array.

- [ ] **Step 6: Apply the spotlight transform + suppress click-advance while presenting**

Wrap the page container so the spotlight transform applies. Replace the inner page `<div className="flex items-center justify-center gap-0">` with:
```typescript
      <div
        className="flex items-center justify-center gap-0"
        style={spot ? spotZoomStyle(spot.scale, spot.x, spot.y) : undefined}
      >
```
In the root `<div>`'s `onClick`, the current guard suppresses advance for `activeMode === 'pen' || 'rectangle'`. Extend it to also suppress while a presenter drawing tool or the spotlight is active — change that line to:
```typescript
        if (activeMode === 'pen' || activeMode === 'rectangle' || isDrawingTool(tool.kind) || spot) return
```

- [ ] **Step 7: Mount the overlay + HUD**

Inside the root `<div>`, after the page container `<div>…</div>` (and before the page-number overlay), add:
```typescript
      <PresentationOverlay
        strokes={strokes}
        tool={tool}
        onAddStroke={(s) => setStrokes(prev => [...prev, s])}
      />
      <PresentationHud tool={tool} />
```

- [ ] **Step 8: Typecheck + full suite**

Run: `npx tsc -b --noEmit && npm run test:run`
Expected: no type errors; all existing tests still PASS. (`PresentationHud` is created in Task 4 — if running this task standalone, temporarily stub it; the next task implements it. To avoid a broken intermediate, do Task 4 immediately after, or create the stub now.)

- [ ] **Step 9: Commit**
```bash
git add src/components/viewer/FullscreenView.tsx src/App.tsx src/utils/presentTools.ts
git commit -m "feat(present): wire presenter toolkit + spotlight zoom into FullscreenView"
```

---

## Task 4: HUD + i18n + manual verification (Modify/Create)

**Files:**
- Create: `src/components/viewer/PresentationHud.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

- [ ] **Step 1: Create the HUD** — `src/components/viewer/PresentationHud.tsx`:
```typescript
import type { PresentToolState } from '../../types/present'
import { isDrawingTool } from '../../utils/presentTools'
import { t } from '../../i18n'

const TOOL_LABEL: Record<string, string> = {
  pen: 'present.pen', highlighter: 'present.highlighter', rect: 'present.rect',
  arrow: 'present.arrow', laser: 'present.laser', zoom: 'present.zoom',
}

/** Bottom-left chip showing the active presenter tool / color / width. */
export function PresentationHud({ tool }: { tool: PresentToolState }) {
  if (!tool.kind) return null
  const label = t(TOOL_LABEL[tool.kind])
  const showColorWidth = isDrawingTool(tool.kind)
  return (
    <div className="fixed bottom-8 left-8 z-[58] flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white pointer-events-none">
      <span className="font-semibold">{label}</span>
      {showColorWidth && (
        <>
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: tool.color }} />
          <span className="tabular-nums text-gray-300">{tool.width}px</span>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add i18n keys** — in `src/i18n/en.ts` (match the file's flat dotted-key style):
```
'present.pen': 'Pen',
'present.highlighter': 'Highlighter',
'present.rect': 'Rectangle',
'present.arrow': 'Arrow',
'present.laser': 'Laser',
'present.zoom': 'Spotlight zoom',
```
In `src/i18n/ko.ts`:
```
'present.pen': '펜',
'present.highlighter': '형광펜',
'present.rect': '사각형',
'present.arrow': '화살표',
'present.laser': '레이저',
'present.zoom': '스팟 줌',
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc -b --noEmit && npm run test:run`
Expected: no type errors; all tests PASS.

- [ ] **Step 4: Manual verification (dev)**

Run `npm run dev`, open a multi-page PDF, press **F5** for fullscreen, then verify:
- `P` then drag → red pen stroke; `2` → green; `]` a few times → thicker; `Ctrl+Z` removes the last stroke; `E` clears all.
- `H` → highlighter is thick + translucent. `R` → rectangle. `A` → arrow with a head pointing where you released.
- `L` → a red dot follows the cursor and clicking still advances the page.
- `Z` → page magnifies around the cursor; moving the mouse pans; wheel changes magnification; `Z`/`Esc` resets.
- Bottom-left HUD shows the active tool/color/width.
- Navigating to the next slide clears the strokes.
- `Esc` once clears presenter state; `Esc` again exits fullscreen. Arrow/Space/PageDown navigation still works.
- Normal view (not fullscreen) still uses `1`=pen / `2`=rectangle unchanged.

- [ ] **Step 5: Commit**
```bash
git add src/components/viewer/PresentationHud.tsx src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(present): tool HUD + i18n; presenter toolkit complete"
```

---

## Self-review notes
- **Spec coverage:** laser (Task 2 + keymap Task 3) · spotlight zoom (Task 3 steps 4-6) · pen/highlighter/rect/arrow (Task 2) · colors 1-5 + width `[ ]` (Task 1 reducer, Task 3 keymap) · undo Ctrl+Z + erase E (Task 3 step 4) · Esc two-step (Task 3 step 4) · clear-on-page (Task 3 step 3) · HUD (Task 4) · fullscreen-only via App gate (Task 3 step 1) · pointer-events/click-advance suppression (Task 2 + Task 3 step 6) · transient screen-space strokes (types Task 1, overlay Task 2). Out-of-scope items (text, whiteboard, timer, draw-while-zoomed) are intentionally absent.
- **Type consistency:** `PresentStroke`, `PresentToolState`, `reducePresentTool`, `arrowHead`, `spotZoomStyle`, `isDrawingTool`, `DEFAULT_TOOL_STATE`, `MIN/MAX_PEN_WIDTH`, `MIN/MAX_ZOOM_SPOT` are defined once and used consistently across tasks.
- **Ordering caveat:** Task 3 references `PresentationHud` (built in Task 4). Build Task 4's HUD file right after Task 3, or stub it, to keep the tree compiling — called out in Task 3 Step 8.
