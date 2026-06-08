# Presentation Tools (ZoomIt-style) — Design

**Date:** 2026-06-08
**Status:** Approved (brainstorming complete)
**Scope:** Fullscreen presentation mode only. The normal-view markup (`1`=pen,
`2`=rectangle, via the annotation system) is unchanged.

## 1. Goal

Bring ZoomIt-style presenter tooling to WZ PDF's fullscreen mode: a laser
pointer, spotlight zoom, and richer transient drawing (pen, highlighter,
rectangle, arrow, color + width, undo). These are **presentation-only and
volatile** — they never touch the annotation/export system and clear on slide
change.

## 2. Approach (chosen)

**Self-contained `PresentationOverlay` inside `FullscreenView`.** All presenter
drawing happens on a screen-space SVG overlay whose state lives in
`FullscreenView`; laser and spotlight zoom are managed there too. The existing
annotation types, `AnnotationLayer`, `PdfPage` drawing, and exporters are **not
modified**. Rejected alternatives: extending the annotation system (large
blast radius, drawings leak into normal view) and a hybrid of both (two drawing
systems coexisting).

## 3. Architecture & components

```
FullscreenView (existing — extended)
├── presentTool: { kind: 'pen'|'highlighter'|'rect'|'arrow'|'laser'|'zoom'|null, color, width }
├── strokes: PresentStroke[]            (transient, screen px; cleared on page change)
├── spotZoom: { active, scale, focalX, focalY }
├── extended keydown handler (tools / colors / width / undo / clear)
│
├── <PdfPage …>                         (existing page render — uninvolved in presenter drawing)
└── <PresentationOverlay>               (NEW — covers the viewport)
      • renders committed `strokes` as SVG
      • pointer handlers build an in-progress draft → onAddStroke(stroke)
      • laser dot follows the cursor when tool === 'laser'
      • pointer-events:auto only while a drawing tool is active; otherwise none
```

| New file | Responsibility |
|---|---|
| `src/types/present.ts` | `PresentStroke`, `PresentColor`, `PresentToolKind`, `PresentToolState` |
| `src/utils/presentTools.ts` | Pure: key→tool reducer, arrowhead geometry, spot-zoom transform, color/width constants + clamps (tested) |
| `src/components/viewer/PresentationOverlay.tsx` | SVG render of strokes + pointer drawing + laser dot (controlled) |
| `src/components/viewer/PresentationOverlay.test.tsx` | RTL render + pointer-draw tests |
| `src/utils/presentTools.test.ts` | Pure-logic tests |

`FullscreenView.tsx` is extended (keymap, state, HUD, spot-zoom transform, mount the overlay). No other existing files change.

## 4. Tools, keymap & UX

| Key | Action |
|---|---|
| `P` | Pen (freehand, solid) |
| `H` | Highlighter (thick, semi-transparent, round cap) |
| `R` | Rectangle |
| `A` | Arrow |
| `L` | Laser pointer (red glow dot follows cursor; no drawing) |
| `Z` | Spotlight zoom toggle (magnify around cursor) |
| `1`–`5` | Color: red / green / blue / yellow / orange |
| `[` / `]` | Decrease / increase pen width (clamped) |
| `Ctrl+Z` | Undo last stroke |
| `E` | Erase all strokes |
| `Esc` | Two-step: 1st clears strokes + deactivates tool/zoom; 2nd exits fullscreen |
| nav keys | arrows / Space / Enter / PageUp / PageDown / Home / End — unchanged |

- A drawing tool stays active for multiple strokes. Re-pressing its key, or `Esc`, deactivates it.
- Laser does not block clicks — keyboard/click navigation still works while the laser is on.
- Spotlight zoom: toggle on → page scales (default 2×) centered on the cursor; mouse moves the focal point; wheel adjusts magnification (1.5×–5×); `Z`/`Esc` resets to fit. Zoom mode is view-only (drawing & page-nav suppressed while zoomed).
- Color (`1`–`5`) and width (`[` `]`) apply to the active drawing tool.
- A small bottom-left HUD chip shows the current tool, color, and width; hidden when no tool is active.

## 5. Coordinate & state model

```typescript
// src/types/present.ts
type PresentColor = '#ef4444' | '#22c55e' | '#3b82f6' | '#eab308' | '#f97316'
type PresentToolKind = 'pen' | 'highlighter' | 'rect' | 'arrow' | 'laser' | 'zoom'

interface PresentToolState { kind: PresentToolKind | null; color: PresentColor; width: number }

type PresentStroke =
  | { id: string; kind: 'pen' | 'highlighter'; color: PresentColor; width: number; points: number[] } // screen px [x,y,…]
  | { id: string; kind: 'rect' | 'arrow'; color: PresentColor; width: number; x1: number; y1: number; x2: number; y2: number }
```

- **All coordinates are screen pixels** (overlay covers the viewport). Strokes are transient — not page-relative, never exported.
- **State owner = `FullscreenView`.** `PresentationOverlay` is controlled: it receives `strokes` + `tool`, renders them, manages the in-progress draft locally, and calls `onAddStroke(stroke)` on pointer-up.
- **Strokes auto-clear when `currentPage` changes** (each slide starts fresh).
- Highlighter = pen with larger width + `opacity 0.35` + round cap. Arrow = line + a triangular head whose vertices come from a pure function of `(x1,y1)→(x2,y2)` and width.
- Spotlight zoom applies `transform: scale(s)` + `transform-origin: focalX focalY` to the page container (not a stroke).

## 6. Edge cases & interaction with existing fullscreen

| Case | Handling |
|---|---|
| Pointer capture | Drawing tool active → overlay `pointer-events:auto`. Laser/none → `none` (clicks pass through to page nav; cursor tracked via a window `mousemove`). |
| Click-to-advance (existing `FullscreenView` onClick) | Suppressed while a drawing or zoom tool is active (extends the current pen/rect suppression). |
| Wheel | Spotlight-zoom active → adjusts magnification. Otherwise existing behavior (page turn / Ctrl+wheel zoom). |
| Esc two-step | 1st: strokes present OR tool active OR zoom active → clear/deactivate all. 2nd (clean): exit fullscreen. Stays consistent with the existing capture-phase Esc handling. |
| Exit fullscreen | All presentation state reset. |
| Drawing during spotlight zoom | Mutually exclusive in v1 (zoom mode is view-only) — simpler and stable. |
| Laser + keyboard nav | Coexist (laser never blocks clicks). |

The new keys are letters/brackets only, so they do not collide with the existing fullscreen nav/zoom/Esc keys.

## 7. Testing

| Target | Type | Cases |
|---|---|---|
| `presentTools` key→tool reducer | unit (pure) | P/H/R/A/L/Z → tool; 1–5 → color; `[`/`]` → width clamp; same-key toggle off |
| arrowhead geometry | unit (pure) | head vertices per direction; zero-length guard |
| spot-zoom transform | unit (pure) | focal + scale → transform-origin / scale strings |
| `PresentationOverlay` | RTL | strokes array → SVG element count/kind; pointerdown/move/up → `onAddStroke` with expected stroke; laser dot renders |
| `FullscreenView` wiring | RTL (where feasible) | tool key → HUD; page change → strokes cleared |

## 8. Implementation phases

```
Phase 1  Types + pure logic (presentTools reducer, arrowhead, spot-zoom transform) — TDD
Phase 2  PresentationOverlay (SVG render + pointer drawing + laser) — TDD
Phase 3  FullscreenView wiring (keymap, tool state, HUD, spot-zoom transform, clear-on-page-change)
Phase 4  i18n (HUD labels / hints), polish, manual verification in fullscreen
```

## 9. Out of scope (this spec)

- Normal-view markup keymap (unchanged: `1`=pen, `2`=rectangle).
- Persisting/exporting presentation drawings (they are transient by design).
- Text annotation (`T`), whiteboard/blackboard, break timer, recording — these
  were Tier 2/3 in the review and are separate future increments.
- Drawing while spotlight-zoomed (deferred; zoom is view-only in v1).
