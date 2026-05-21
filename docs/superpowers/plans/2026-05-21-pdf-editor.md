# PDF Viewer + Annotation Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser-only PDF viewer with stamp, signature, and watermark annotation support and pdf-lib-powered export.

**Architecture:** PDF.js renders each page to an offscreen canvas, which is converted to a base64 image and placed as the background of a Konva Stage. Annotations (stamps, signatures, watermarks) are rendered as Konva nodes on a separate layer above the PDF background. Coordinates are stored in rendered-pixel space (at PDF_RENDER_SCALE=1.5) and divided by that scale on export to get PDF points.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS v4, pdfjs-dist, react-konva/konva, pdf-lib, Vitest + React Testing Library.

---

## File Map

| File | Responsibility |
|---|---|
| `src/utils/constants.ts` | Shared numeric constants (PDF_RENDER_SCALE, zoom limits) |
| `src/types/annotation.ts` | All annotation TypeScript interfaces |
| `src/utils/coordinates.ts` | Zoom/scale conversion math |
| `src/utils/stampPresets.ts` | Built-in SVG stamp presets + SVG→PNG helper |
| `src/hooks/useAnnotations.ts` | Annotation CRUD state (useState) |
| `src/hooks/usePdfDocument.ts` | PDF.js document load |
| `src/hooks/usePdfPage.ts` | Per-page canvas render → base64 image |
| `src/components/viewer/ZoomControls.tsx` | Zoom +/− buttons |
| `src/components/viewer/PdfPage.tsx` | Konva Stage per page, click-to-place logic |
| `src/components/viewer/PdfViewer.tsx` | Scrollable page list |
| `src/components/annotations/AnnotationLayer.tsx` | Konva Layer + Transformer management |
| `src/components/annotations/StampNode.tsx` | Konva Image node for stamps |
| `src/components/annotations/SignatureNode.tsx` | Konva Image node for signatures |
| `src/components/annotations/WatermarkNode.tsx` | Centered, non-draggable Konva Text node |
| `src/components/toolbar/ActionBar.tsx` | Top bar: Upload + Export buttons |
| `src/components/toolbar/Toolbar.tsx` | Left sidebar: mode buttons + stamp panel |
| `src/components/modals/SignaturePad.tsx` | Canvas drawing modal |
| `src/components/modals/WatermarkConfig.tsx` | Watermark settings form modal |
| `src/services/pdfExporter.ts` | pdf-lib export engine |
| `src/App.tsx` | Root: wires all state + layout |
| `src/main.tsx` | Entry point + pdfjs worker config |
| `src/index.css` | Tailwind import |
| `src/test-setup.ts` | Vitest global setup |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `vite.config.ts`
- Create: `src/index.css`
- Create: `src/test-setup.ts`
- Create: `src/main.tsx`

- [ ] **Step 1: Scaffold Vite project**

Run in `D:/Workspace/PdfEditor`:
```bash
npm create vite@latest . -- --template react-ts
```
When prompted "Current directory is not empty. Remove existing files and continue?" → choose **Yes** (only the docs/ folder exists).

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install pdfjs-dist react-konva konva pdf-lib
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D tailwindcss @tailwindcss/vite vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
```

- [ ] **Step 4: Write vite.config.ts**

Replace the generated file entirely:
```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

- [ ] **Step 5: Write src/index.css**

```css
@import "tailwindcss";
```

- [ ] **Step 6: Write src/test-setup.ts**

```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 7: Write src/main.tsx**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as pdfjs from 'pdfjs-dist'
import './index.css'
import App from './App'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 8: Verify dev server starts**

```bash
npm run dev
```
Expected: Vite dev server starts at `http://localhost:5173` with no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite+React+TS project with deps"
```

---

## Task 2: Type Definitions & Constants

**Files:**
- Create: `src/utils/constants.ts`
- Create: `src/types/annotation.ts`

- [ ] **Step 1: Write src/utils/constants.ts**

```typescript
export const PDF_RENDER_SCALE = 1.5
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 3
export const ZOOM_STEP = 0.25
```

- [ ] **Step 2: Write src/types/annotation.ts**

```typescript
export type AnnotationType = 'stamp' | 'signature' | 'watermark'

export interface BaseAnnotation {
  id: string
  page: number        // 1-based page number
  type: AnnotationType
  x: number          // pixel coords at PDF_RENDER_SCALE, zoom=1
  y: number
  width: number
  height: number
  rotation: number   // degrees
}

export interface StampAnnotation extends BaseAnnotation {
  type: 'stamp'
  src: string        // base64 PNG
  presetId?: string  // 'approved' | 'rejected' | 'confidential' | 'draft' | undefined
}

export interface SignatureAnnotation extends BaseAnnotation {
  type: 'signature'
  src: string        // base64 PNG from handwriting canvas
}

export interface WatermarkAnnotation extends BaseAnnotation {
  type: 'watermark'
  text: string
  opacity: number    // 0–1
  fontSize: number   // in PDF points (applied at renderScale in display)
  color: string      // hex color e.g. '#888888'
  allPages: boolean  // when true, page field is ignored
}

export type Annotation = StampAnnotation | SignatureAnnotation | WatermarkAnnotation

export type ActiveMode = 'select' | 'stamp' | 'signature' | 'watermark' | null
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/constants.ts src/types/annotation.ts
git commit -m "feat: add type definitions and constants"
```

---

## Task 3: Coordinate Utilities & Tests

**Files:**
- Create: `src/utils/coordinates.ts`
- Create: `src/utils/__tests__/coordinates.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/utils/__tests__/coordinates.test.ts
import { describe, it, expect } from 'vitest'
import {
  toScreenCoords,
  toStoredCoords,
  toScreenSize,
  toPdfLibY,
  hexToRgb,
} from '../coordinates'

describe('toScreenCoords', () => {
  it('scales stored coords by zoom', () => {
    expect(toScreenCoords(100, 150, 2)).toEqual({ x: 200, y: 300 })
  })
  it('returns same value at zoom=1', () => {
    expect(toScreenCoords(100, 150, 1)).toEqual({ x: 100, y: 150 })
  })
})

describe('toStoredCoords', () => {
  it('divides screen coords by zoom', () => {
    expect(toStoredCoords(200, 300, 2)).toEqual({ x: 100, y: 150 })
  })
})

describe('toScreenSize', () => {
  it('scales dimensions by zoom', () => {
    expect(toScreenSize(50, 30, 2)).toEqual({ width: 100, height: 60 })
  })
})

describe('toPdfLibY', () => {
  it('converts top-left origin to bottom-left origin', () => {
    // pageHeight=800, pdfJsY=100, pdfHeight=50 → 800-100-50=650
    expect(toPdfLibY(100, 50, 800)).toBe(650)
  })
  it('handles top-aligned element', () => {
    expect(toPdfLibY(0, 50, 800)).toBe(750)
  })
})

describe('hexToRgb', () => {
  it('converts red', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0])
  })
  it('converts black', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
  })
  it('converts white', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1])
  })
  it('converts mid-gray', () => {
    const [r] = hexToRgb('#888888')
    expect(r).toBeCloseTo(0.533, 2)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- coordinates
```
Expected: FAIL — `Cannot find module '../coordinates'`

- [ ] **Step 3: Write src/utils/coordinates.ts**

```typescript
export function toScreenCoords(
  storedX: number,
  storedY: number,
  zoom: number,
): { x: number; y: number } {
  return { x: storedX * zoom, y: storedY * zoom }
}

export function toStoredCoords(
  screenX: number,
  screenY: number,
  zoom: number,
): { x: number; y: number } {
  return { x: screenX / zoom, y: screenY / zoom }
}

export function toScreenSize(
  storedWidth: number,
  storedHeight: number,
  zoom: number,
): { width: number; height: number } {
  return { width: storedWidth * zoom, height: storedHeight * zoom }
}

/** PDF.js top-left origin → pdf-lib bottom-left origin (all values in same unit) */
export function toPdfLibY(
  pdfJsY: number,
  elementHeight: number,
  pageHeight: number,
): number {
  return pageHeight - pdfJsY - elementHeight
}

/** Converts #rrggbb hex to [r, g, b] in 0–1 range */
export function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b]
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- coordinates
```
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/coordinates.ts src/utils/__tests__/coordinates.test.ts
git commit -m "feat: add coordinate utilities with tests"
```

---

## Task 4: Stamp Presets

**Files:**
- Create: `src/utils/stampPresets.ts`

- [ ] **Step 1: Write src/utils/stampPresets.ts**

```typescript
export interface StampPreset {
  id: string
  label: string
  svg: string
}

function makeSvg(text: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">
  <rect x="4" y="4" width="192" height="72" rx="8" ry="8"
    fill="none" stroke="${color}" stroke-width="4"/>
  <text x="100" y="52" font-family="Arial, sans-serif" font-size="26"
    font-weight="bold" fill="${color}" text-anchor="middle">${text}</text>
</svg>`
}

export const STAMP_PRESETS: StampPreset[] = [
  { id: 'approved',     label: 'APPROVED',     svg: makeSvg('APPROVED',     '#16a34a') },
  { id: 'rejected',     label: 'REJECTED',     svg: makeSvg('REJECTED',     '#dc2626') },
  { id: 'confidential', label: 'CONFIDENTIAL', svg: makeSvg('CONFIDENTIAL', '#2563eb') },
  { id: 'draft',        label: 'DRAFT',        svg: makeSvg('DRAFT',        '#6b7280') },
]

/** Converts an SVG string to a base64 PNG data URL via an offscreen canvas */
export function svgToPng(svg: string, width = 200, height = 80): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image(width, height)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG load failed')) }
    img.src = url
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/stampPresets.ts
git commit -m "feat: add stamp presets and SVG-to-PNG converter"
```

---

## Task 5: Annotation State Hook & Tests

**Files:**
- Create: `src/hooks/useAnnotations.ts`
- Create: `src/hooks/__tests__/useAnnotations.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/hooks/__tests__/useAnnotations.test.ts
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAnnotations } from '../useAnnotations'
import type { StampAnnotation } from '../../types/annotation'

const makeStamp = (page = 1): Omit<StampAnnotation, 'id'> => ({
  type: 'stamp',
  page,
  x: 10,
  y: 10,
  width: 100,
  height: 40,
  rotation: 0,
  src: 'data:image/png;base64,abc',
})

describe('useAnnotations', () => {
  it('initialises with empty state', () => {
    const { result } = renderHook(() => useAnnotations())
    expect(result.current.annotations).toHaveLength(0)
    expect(result.current.selectedId).toBeNull()
    expect(result.current.activeMode).toBeNull()
  })

  it('addAnnotation adds annotation and selects it', () => {
    const { result } = renderHook(() => useAnnotations())
    let id!: string
    act(() => { id = result.current.addAnnotation(makeStamp()) })
    expect(result.current.annotations).toHaveLength(1)
    expect(result.current.annotations[0].id).toBe(id)
    expect(result.current.selectedId).toBe(id)
    expect(result.current.activeMode).toBe('select')
  })

  it('removeAnnotation removes the annotation', () => {
    const { result } = renderHook(() => useAnnotations())
    let id!: string
    act(() => { id = result.current.addAnnotation(makeStamp()) })
    act(() => { result.current.removeAnnotation(id) })
    expect(result.current.annotations).toHaveLength(0)
    expect(result.current.selectedId).toBeNull()
  })

  it('updateAnnotation updates matching annotation only', () => {
    const { result } = renderHook(() => useAnnotations())
    let id!: string
    act(() => { id = result.current.addAnnotation(makeStamp()) })
    act(() => { result.current.updateAnnotation(id, { x: 99 }) })
    expect(result.current.annotations[0].x).toBe(99)
  })

  it('setActiveMode clears selectedId', () => {
    const { result } = renderHook(() => useAnnotations())
    let id!: string
    act(() => { id = result.current.addAnnotation(makeStamp()) })
    expect(result.current.selectedId).toBe(id)
    act(() => { result.current.setActiveMode('stamp') })
    expect(result.current.selectedId).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- useAnnotations
```
Expected: FAIL — `Cannot find module '../useAnnotations'`

- [ ] **Step 3: Write src/hooks/useAnnotations.ts**

```typescript
import { useState, useCallback } from 'react'
import type { Annotation, ActiveMode } from '../types/annotation'

interface AnnotationState {
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
}

export interface UseAnnotationsReturn extends AnnotationState {
  addAnnotation: (annotation: Omit<Annotation, 'id'>) => string
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void
  removeAnnotation: (id: string) => void
  selectAnnotation: (id: string | null) => void
  setActiveMode: (mode: ActiveMode) => void
}

export function useAnnotations(): UseAnnotationsReturn {
  const [state, setState] = useState<AnnotationState>({
    annotations: [],
    selectedId: null,
    activeMode: null,
  })

  const addAnnotation = useCallback((annotation: Omit<Annotation, 'id'>): string => {
    const id = crypto.randomUUID()
    setState(prev => ({
      ...prev,
      annotations: [...prev.annotations, { ...annotation, id } as Annotation],
      selectedId: id,
      activeMode: 'select',
    }))
    return id
  }, [])

  const updateAnnotation = useCallback((id: string, updates: Partial<Annotation>) => {
    setState(prev => ({
      ...prev,
      annotations: prev.annotations.map(a => (a.id === id ? { ...a, ...updates } : a)),
    }))
  }, [])

  const removeAnnotation = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      annotations: prev.annotations.filter(a => a.id !== id),
      selectedId: prev.selectedId === id ? null : prev.selectedId,
    }))
  }, [])

  const selectAnnotation = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, selectedId: id }))
  }, [])

  const setActiveMode = useCallback((mode: ActiveMode) => {
    setState(prev => ({ ...prev, activeMode: mode, selectedId: null }))
  }, [])

  return { ...state, addAnnotation, updateAnnotation, removeAnnotation, selectAnnotation, setActiveMode }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- useAnnotations
```
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAnnotations.ts src/hooks/__tests__/useAnnotations.test.ts
git commit -m "feat: add useAnnotations hook with tests"
```

---

## Task 6: PDF.js Hooks

**Files:**
- Create: `src/hooks/usePdfDocument.ts`
- Create: `src/hooks/usePdfPage.ts`

- [ ] **Step 1: Write src/hooks/usePdfDocument.ts**

```typescript
import { useState, useEffect } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

interface UsePdfDocumentReturn {
  pdfDoc: PDFDocumentProxy | null
  numPages: number
  isLoading: boolean
  error: string | null
}

export function usePdfDocument(file: File | null): UsePdfDocumentReturn {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setPdfDoc(null)
      setNumPages(0)
      setError(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    file.arrayBuffer()
      .then(buffer => pdfjs.getDocument({ data: buffer }).promise)
      .then(doc => {
        if (cancelled) return
        setPdfDoc(doc)
        setNumPages(doc.numPages)
        setIsLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load PDF')
        setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [file])

  return { pdfDoc, numPages, isLoading, error }
}
```

- [ ] **Step 2: Write src/hooks/usePdfPage.ts**

```typescript
import { useState, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PDF_RENDER_SCALE } from '../utils/constants'

export interface PageData {
  imageUrl: string
  width: number   // rendered pixel width  (= PDF points * PDF_RENDER_SCALE)
  height: number  // rendered pixel height
}

interface UsePdfPageReturn {
  pageData: PageData | null
  isLoading: boolean
}

export function usePdfPage(
  pdfDoc: PDFDocumentProxy | null,
  pageNumber: number,
): UsePdfPageReturn {
  const [pageData, setPageData] = useState<PageData | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!pdfDoc) { setPageData(null); return }

    let cancelled = false
    setIsLoading(true)

    pdfDoc.getPage(pageNumber).then(page => {
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!
      return page.render({ canvasContext: ctx, viewport }).promise.then(() => {
        if (cancelled) return
        setPageData({
          imageUrl: canvas.toDataURL('image/png'),
          width: viewport.width,
          height: viewport.height,
        })
        setIsLoading(false)
      })
    })

    return () => { cancelled = true }
  }, [pdfDoc, pageNumber])

  return { pageData, isLoading }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePdfDocument.ts src/hooks/usePdfPage.ts
git commit -m "feat: add PDF.js document and page hooks"
```

---

## Task 7: PdfPage Component

**Files:**
- Create: `src/components/viewer/PdfPage.tsx`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p src/components/viewer src/components/annotations src/components/toolbar src/components/modals src/services
```

- [ ] **Step 2: Write src/components/viewer/PdfPage.tsx**

```typescript
import React, { useEffect, useState } from 'react'
import { Stage, Layer, Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { usePdfPage } from '../../hooks/usePdfPage'
import { AnnotationLayer } from '../annotations/AnnotationLayer'
import type { Annotation, ActiveMode } from '../../types/annotation'
import { toStoredCoords } from '../../utils/coordinates'
import { PDF_RENDER_SCALE } from '../../utils/constants'

interface PdfPageProps {
  pdfDoc: PDFDocumentProxy
  pageNumber: number
  zoom: number
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  pendingStamp: { src: string; presetId?: string } | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: Omit<Annotation, 'id'>) => void
}

export function PdfPage({
  pdfDoc,
  pageNumber,
  zoom,
  annotations,
  selectedId,
  activeMode,
  pendingStamp,
  pendingSignature,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
}: PdfPageProps) {
  const { pageData, isLoading } = usePdfPage(pdfDoc, pageNumber)
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (!pageData) return
    const img = new window.Image()
    img.src = pageData.imageUrl
    img.onload = () => setBgImage(img)
  }, [pageData])

  if (isLoading || !pageData) {
    return (
      <div
        style={{ width: 600 * zoom, height: 800 * zoom }}
        className="bg-gray-100 animate-pulse flex items-center justify-center"
      >
        <span className="text-gray-400 text-sm">Loading page {pageNumber}…</span>
      </div>
    )
  }

  const stageWidth = pageData.width * zoom
  const stageHeight = pageData.height * zoom
  const effectiveZoom = PDF_RENDER_SCALE * zoom

  const pageAnnotations = annotations.filter(a =>
    a.type === 'watermark'
      ? (a as any).allPages || a.page === pageNumber
      : a.page === pageNumber,
  )

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent | Event>) => {
    const stage = e.target.getStage()
    const pos = stage?.getPointerPosition()

    if (pos && activeMode === 'stamp' && pendingStamp) {
      const stored = toStoredCoords(pos.x, pos.y, effectiveZoom)
      onAnnotationAdd({
        type: 'stamp',
        page: pageNumber,
        x: stored.x - 50,
        y: stored.y - 20,
        width: 100,
        height: 40,
        rotation: 0,
        src: pendingStamp.src,
        presetId: pendingStamp.presetId,
      })
      return
    }

    if (pos && activeMode === 'signature' && pendingSignature) {
      const stored = toStoredCoords(pos.x, pos.y, effectiveZoom)
      onAnnotationAdd({
        type: 'signature',
        page: pageNumber,
        x: stored.x - 75,
        y: stored.y - 25,
        width: 150,
        height: 50,
        rotation: 0,
        src: pendingSignature,
      })
      return
    }

    if (e.target === stage) {
      onAnnotationSelect(null)
    }
  }

  return (
    <Stage
      width={stageWidth}
      height={stageHeight}
      onClick={handleStageClick}
      onTap={handleStageClick}
      style={{ cursor: (activeMode === 'stamp' && pendingStamp) || (activeMode === 'signature' && pendingSignature) ? 'crosshair' : 'default' }}
    >
      <Layer>
        {bgImage && (
          <KonvaImage image={bgImage} x={0} y={0} width={stageWidth} height={stageHeight} />
        )}
      </Layer>
      <AnnotationLayer
        annotations={pageAnnotations}
        selectedId={selectedId}
        effectiveZoom={effectiveZoom}
        stageWidth={stageWidth}
        stageHeight={stageHeight}
        onSelect={onAnnotationSelect}
        onUpdate={onAnnotationUpdate}
      />
    </Stage>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/viewer/PdfPage.tsx
git commit -m "feat: add PdfPage component with Konva Stage and click-to-place"
```

---

## Task 8: Annotation Layer & Nodes

**Files:**
- Create: `src/components/annotations/AnnotationLayer.tsx`
- Create: `src/components/annotations/StampNode.tsx`
- Create: `src/components/annotations/SignatureNode.tsx`
- Create: `src/components/annotations/WatermarkNode.tsx`

- [ ] **Step 1: Write src/components/annotations/StampNode.tsx**

```typescript
import React, { useEffect, useState, forwardRef } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { StampAnnotation } from '../../types/annotation'

interface StampNodeProps {
  annotation: StampAnnotation
  effectiveZoom: number
  onSelect: () => void
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void
}

export const StampNode = forwardRef<Konva.Node, StampNodeProps>(
  ({ annotation, effectiveZoom, onSelect, onDragEnd, onTransformEnd }, ref) => {
    const [image, setImage] = useState<HTMLImageElement | null>(null)

    useEffect(() => {
      const img = new window.Image()
      img.src = annotation.src
      img.onload = () => setImage(img)
    }, [annotation.src])

    if (!image) return null

    return (
      <KonvaImage
        ref={ref as React.Ref<Konva.Image>}
        image={image}
        x={annotation.x * effectiveZoom}
        y={annotation.y * effectiveZoom}
        width={annotation.width * effectiveZoom}
        height={annotation.height * effectiveZoom}
        rotation={annotation.rotation}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
      />
    )
  },
)
StampNode.displayName = 'StampNode'
```

- [ ] **Step 2: Write src/components/annotations/SignatureNode.tsx**

```typescript
import React, { useEffect, useState, forwardRef } from 'react'
import { Image as KonvaImage } from 'react-konva'
import type Konva from 'konva'
import type { SignatureAnnotation } from '../../types/annotation'

interface SignatureNodeProps {
  annotation: SignatureAnnotation
  effectiveZoom: number
  onSelect: () => void
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void
}

export const SignatureNode = forwardRef<Konva.Node, SignatureNodeProps>(
  ({ annotation, effectiveZoom, onSelect, onDragEnd, onTransformEnd }, ref) => {
    const [image, setImage] = useState<HTMLImageElement | null>(null)

    useEffect(() => {
      const img = new window.Image()
      img.src = annotation.src
      img.onload = () => setImage(img)
    }, [annotation.src])

    if (!image) return null

    return (
      <KonvaImage
        ref={ref as React.Ref<Konva.Image>}
        image={image}
        x={annotation.x * effectiveZoom}
        y={annotation.y * effectiveZoom}
        width={annotation.width * effectiveZoom}
        height={annotation.height * effectiveZoom}
        rotation={annotation.rotation}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
      />
    )
  },
)
SignatureNode.displayName = 'SignatureNode'
```

- [ ] **Step 3: Write src/components/annotations/WatermarkNode.tsx**

Watermarks are centered, non-draggable. x/y stored values are ignored for display.

```typescript
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
```

- [ ] **Step 4: Write src/components/annotations/AnnotationLayer.tsx**

```typescript
import React, { useRef, useEffect } from 'react'
import { Layer, Transformer } from 'react-konva'
import type Konva from 'konva'
import { StampNode } from './StampNode'
import { SignatureNode } from './SignatureNode'
import { WatermarkNode } from './WatermarkNode'
import type { Annotation } from '../../types/annotation'
import { toStoredCoords } from '../../utils/coordinates'

interface AnnotationLayerProps {
  annotations: Annotation[]
  selectedId: string | null
  effectiveZoom: number
  stageWidth: number
  stageHeight: number
  onSelect: (id: string | null) => void
  onUpdate: (id: string, updates: Partial<Annotation>) => void
}

export function AnnotationLayer({
  annotations,
  selectedId,
  effectiveZoom,
  stageWidth,
  stageHeight,
  onSelect,
  onUpdate,
}: AnnotationLayerProps) {
  const trRef = useRef<Konva.Transformer>(null)
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map())

  useEffect(() => {
    if (!trRef.current) return
    const node = selectedId ? nodeRefs.current.get(selectedId) : null
    trRef.current.nodes(node ? [node] : [])
    trRef.current.getLayer()?.batchDraw()
  }, [selectedId])

  const handleDragEnd = (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
    const stored = toStoredCoords(e.target.x(), e.target.y(), effectiveZoom)
    onUpdate(id, { x: stored.x, y: stored.y })
  }

  const handleTransformEnd = (id: string, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    const stored = toStoredCoords(node.x(), node.y(), effectiveZoom)
    onUpdate(id, {
      x: stored.x,
      y: stored.y,
      width: (node.width() * scaleX) / effectiveZoom,
      height: (node.height() * scaleY) / effectiveZoom,
      rotation: node.rotation(),
    })
  }

  const setRef = (id: string) => (node: Konva.Node | null) => {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }

  return (
    <Layer>
      {annotations.map(annotation => {
        if (annotation.type === 'watermark') {
          return (
            <WatermarkNode
              key={annotation.id}
              annotation={annotation}
              effectiveZoom={effectiveZoom}
              stageWidth={stageWidth}
              stageHeight={stageHeight}
            />
          )
        }

        const sharedProps = {
          effectiveZoom,
          onSelect: () => onSelect(annotation.id),
          onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => handleDragEnd(annotation.id, e),
          onTransformEnd: (e: Konva.KonvaEventObject<Event>) => handleTransformEnd(annotation.id, e),
          ref: setRef(annotation.id),
        }

        if (annotation.type === 'stamp') {
          return <StampNode key={annotation.id} annotation={annotation} {...sharedProps} />
        }
        if (annotation.type === 'signature') {
          return <SignatureNode key={annotation.id} annotation={annotation} {...sharedProps} />
        }
        return null
      })}
      <Transformer
        ref={trRef}
        rotateEnabled
        boundBoxFunc={(oldBox, newBox) =>
          newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
        }
      />
    </Layer>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/annotations/
git commit -m "feat: add annotation layer and stamp/signature/watermark nodes"
```

---

## Task 9: PDF Viewer & Zoom Controls

**Files:**
- Create: `src/components/viewer/ZoomControls.tsx`
- Create: `src/components/viewer/PdfViewer.tsx`

- [ ] **Step 1: Write src/components/viewer/ZoomControls.tsx**

```typescript
import React from 'react'

interface ZoomControlsProps {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onZoomReset }: ZoomControlsProps) {
  return (
    <div className="flex flex-col items-center gap-1 mt-auto pb-4">
      <button
        onClick={onZoomIn}
        className="w-8 h-8 bg-gray-600 hover:bg-gray-500 text-white rounded text-xl leading-none"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        onClick={onZoomReset}
        className="text-xs text-gray-300 hover:text-white min-w-[2rem] text-center"
        aria-label="Reset zoom"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={onZoomOut}
        className="w-8 h-8 bg-gray-600 hover:bg-gray-500 text-white rounded text-xl leading-none"
        aria-label="Zoom out"
      >
        −
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Write src/components/viewer/PdfViewer.tsx**

```typescript
import React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './PdfPage'
import type { Annotation, ActiveMode } from '../../types/annotation'

interface PdfViewerProps {
  pdfDoc: PDFDocumentProxy
  numPages: number
  zoom: number
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
  pendingStamp: { src: string; presetId?: string } | null
  pendingSignature: string | null
  onAnnotationSelect: (id: string | null) => void
  onAnnotationUpdate: (id: string, updates: Partial<Annotation>) => void
  onAnnotationAdd: (annotation: Omit<Annotation, 'id'>) => void
}

export function PdfViewer({
  pdfDoc,
  numPages,
  zoom,
  annotations,
  selectedId,
  activeMode,
  pendingStamp,
  pendingSignature,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
}: PdfViewerProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4 overflow-auto h-full bg-gray-300">
      {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => (
        <div key={pageNum} className="shadow-xl">
          <PdfPage
            pdfDoc={pdfDoc}
            pageNumber={pageNum}
            zoom={zoom}
            annotations={annotations}
            selectedId={selectedId}
            activeMode={activeMode}
            pendingStamp={pendingStamp}
            pendingSignature={pendingSignature}
            onAnnotationSelect={onAnnotationSelect}
            onAnnotationUpdate={onAnnotationUpdate}
            onAnnotationAdd={onAnnotationAdd}
          />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/viewer/ZoomControls.tsx src/components/viewer/PdfViewer.tsx
git commit -m "feat: add PdfViewer and ZoomControls components"
```

---

## Task 10: Toolbar & ActionBar

**Files:**
- Create: `src/components/toolbar/ActionBar.tsx`
- Create: `src/components/toolbar/Toolbar.tsx`

- [ ] **Step 1: Write src/components/toolbar/ActionBar.tsx**

```typescript
import React, { useRef } from 'react'

interface ActionBarProps {
  hasPdf: boolean
  onUpload: (file: File) => void
  onExport: () => void
  isExporting: boolean
}

export function ActionBar({ hasPdf, onUpload, onExport, isExporting }: ActionBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type === 'application/pdf') onUpload(file)
  }

  return (
    <header
      className="flex items-center justify-between px-4 py-2 bg-gray-900 text-white shadow-md z-10 shrink-0"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      <span className="font-semibold text-sm tracking-wide">PDF Editor</span>
      <div className="flex gap-2">
        <button
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded transition-colors"
        >
          <span className="hidden sm:inline">Upload PDF</span>
          <span className="sm:hidden">Upload</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
        {hasPdf && (
          <button
            onClick={onExport}
            disabled={isExporting}
            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 rounded transition-colors disabled:opacity-50"
          >
            {isExporting ? 'Exporting…' : 'Export PDF'}
          </button>
        )}
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Write src/components/toolbar/Toolbar.tsx**

```typescript
import React, { useState } from 'react'
import type { ActiveMode } from '../../types/annotation'
import { STAMP_PRESETS, svgToPng } from '../../utils/stampPresets'
import { ZoomControls } from '../viewer/ZoomControls'

interface ToolbarProps {
  activeMode: ActiveMode
  selectedId: string | null
  zoom: number
  hasPdf: boolean
  onModeChange: (mode: ActiveMode) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onDeleteSelected: () => void
  onStampSelect: (src: string, presetId?: string) => void
  onSignatureClick: () => void
  onWatermarkClick: () => void
}

export function Toolbar({
  activeMode,
  selectedId,
  zoom,
  hasPdf,
  onModeChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onDeleteSelected,
  onStampSelect,
  onSignatureClick,
  onWatermarkClick,
}: ToolbarProps) {
  const [stampPanelOpen, setStampPanelOpen] = useState(false)

  const handlePresetClick = async (presetId: string, svg: string) => {
    const pngDataUrl = await svgToPng(svg)
    onStampSelect(pngDataUrl, presetId)
    setStampPanelOpen(false)
    onModeChange('stamp')
  }

  const handleCustomUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const src = ev.target?.result as string
      onStampSelect(src)
      setStampPanelOpen(false)
      onModeChange('stamp')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const btn = (mode: ActiveMode | 'stamp-toggle') =>
    `w-full py-2 px-2 text-xs sm:text-sm rounded text-left transition-colors ${
      activeMode === mode
        ? 'bg-blue-600 text-white'
        : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
    }`

  return (
    <aside className="flex flex-col w-12 sm:w-36 bg-gray-800 text-white py-3 px-1 sm:px-2 gap-1 shrink-0">
      {hasPdf && (
        <>
          <button className={btn('select')} onClick={() => { onModeChange('select'); setStampPanelOpen(false) }}>
            <span className="sm:hidden">↖</span>
            <span className="hidden sm:inline">Select</span>
          </button>

          <button
            className={`${btn('stamp')} ${activeMode === 'stamp' ? 'bg-blue-600' : ''}`}
            onClick={() => setStampPanelOpen(v => !v)}
          >
            <span className="sm:hidden">🔖</span>
            <span className="hidden sm:inline">Stamp</span>
          </button>

          {stampPanelOpen && (
            <div className="bg-gray-700 rounded p-1 flex flex-col gap-0.5">
              {STAMP_PRESETS.map(p => (
                <button
                  key={p.id}
                  onClick={() => handlePresetClick(p.id, p.svg)}
                  className="text-xs text-left px-2 py-1.5 hover:bg-gray-600 rounded"
                >
                  {p.label}
                </button>
              ))}
              <label className="text-xs text-left px-2 py-1.5 hover:bg-gray-600 rounded cursor-pointer">
                Upload PNG…
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handleCustomUpload}
                />
              </label>
            </div>
          )}

          <button
            className={btn('signature')}
            onClick={() => { onModeChange('signature'); onSignatureClick(); setStampPanelOpen(false) }}
          >
            <span className="sm:hidden">✍</span>
            <span className="hidden sm:inline">Signature</span>
          </button>

          <button
            className={btn('watermark')}
            onClick={() => { onModeChange('watermark'); onWatermarkClick(); setStampPanelOpen(false) }}
          >
            <span className="sm:hidden">💧</span>
            <span className="hidden sm:inline">Watermark</span>
          </button>

          {selectedId && (
            <button
              onClick={onDeleteSelected}
              className="w-full py-2 px-2 text-xs sm:text-sm rounded text-left bg-red-700 hover:bg-red-600 text-white mt-2 transition-colors"
            >
              <span className="sm:hidden">🗑</span>
              <span className="hidden sm:inline">Delete</span>
            </button>
          )}
        </>
      )}

      <ZoomControls zoom={zoom} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onZoomReset={onZoomReset} />
    </aside>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/toolbar/
git commit -m "feat: add ActionBar and Toolbar components"
```

---

## Task 11: Signature & Watermark Modals

**Files:**
- Create: `src/components/modals/SignaturePad.tsx`
- Create: `src/components/modals/WatermarkConfig.tsx`

- [ ] **Step 1: Write src/components/modals/SignaturePad.tsx**

```typescript
import React, { useRef, useEffect, useState } from 'react'

interface SignaturePadProps {
  onConfirm: (dataUrl: string) => void
  onCancel: () => void
}

export function SignaturePad({ onConfirm, onCancel }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const [hasContent, setHasContent] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    isDrawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = getPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    if (!isDrawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = getPos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasContent(true)
  }

  const endDraw = () => { isDrawing.current = false }

  const clear = () => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasContent(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 shadow-2xl w-full max-w-md">
        <h2 className="text-lg font-semibold mb-3 text-gray-800">Draw Signature</h2>
        <canvas
          ref={canvasRef}
          width={400}
          height={200}
          className="border-2 border-gray-200 rounded-lg w-full touch-none cursor-crosshair bg-white"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        <div className="flex justify-between mt-4">
          <button onClick={clear} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700">
            Clear
          </button>
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700">
              Cancel
            </button>
            <button
              onClick={() => onConfirm(canvasRef.current!.toDataURL('image/png'))}
              disabled={!hasContent}
              className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-40 transition-colors"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write src/components/modals/WatermarkConfig.tsx**

```typescript
import React, { useState } from 'react'

export interface WatermarkSettings {
  text: string
  opacity: number
  fontSize: number
  color: string
  rotation: number
}

interface WatermarkConfigProps {
  onConfirm: (settings: WatermarkSettings) => void
  onCancel: () => void
}

export function WatermarkConfig({ onConfirm, onCancel }: WatermarkConfigProps) {
  const [settings, setSettings] = useState<WatermarkSettings>({
    text: 'CONFIDENTIAL',
    opacity: 0.3,
    fontSize: 48,
    color: '#888888',
    rotation: -45,
  })

  const set =
    (key: keyof WatermarkSettings) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value =
        e.target.type === 'range' || e.target.type === 'number'
          ? parseFloat(e.target.value)
          : e.target.value
      setSettings(prev => ({ ...prev, [key]: value }))
    }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-5 shadow-2xl w-full max-w-sm">
        <h2 className="text-lg font-semibold mb-4 text-gray-800">Watermark Settings</h2>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Text
            <input
              type="text"
              value={settings.text}
              onChange={set('text')}
              className="border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Opacity ({Math.round(settings.opacity * 100)}%)
            <input type="range" min={0.05} max={1} step={0.05} value={settings.opacity} onChange={set('opacity')} className="accent-blue-500" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Font Size ({settings.fontSize}pt)
            <input type="range" min={12} max={120} step={4} value={settings.fontSize} onChange={set('fontSize')} className="accent-blue-500" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Color
            <input type="color" value={settings.color} onChange={set('color')} className="h-9 w-full rounded border border-gray-300 cursor-pointer" />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Rotation ({settings.rotation}°)
            <input type="range" min={-90} max={90} step={5} value={settings.rotation} onChange={set('rotation')} className="accent-blue-500" />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(settings)}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/modals/
git commit -m "feat: add SignaturePad and WatermarkConfig modals"
```

---

## Task 12: PDF Export Service & Tests

**Files:**
- Create: `src/services/pdfExporter.ts`
- Create: `src/services/__tests__/pdfExporter.test.ts`

- [ ] **Step 1: Write failing tests for helper utilities**

```typescript
// src/services/__tests__/pdfExporter.test.ts
import { describe, it, expect } from 'vitest'
import { base64ToUint8Array } from '../pdfExporter'

describe('base64ToUint8Array', () => {
  it('converts a base64 data URL to Uint8Array', () => {
    // "hello" in base64 is "aGVsbG8="
    const dataUrl = 'data:text/plain;base64,aGVsbG8='
    const result = base64ToUint8Array(dataUrl)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(5)
    expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]) // "hello"
  })
  it('handles PNG data URL prefix correctly', () => {
    const dataUrl = 'data:image/png;base64,aGVsbG8='
    const result = base64ToUint8Array(dataUrl)
    expect(result.length).toBe(5)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- pdfExporter
```
Expected: FAIL — `Cannot find module '../pdfExporter'`

- [ ] **Step 3: Write src/services/pdfExporter.ts**

```typescript
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib'
import type { Annotation, WatermarkAnnotation } from '../types/annotation'
import { toPdfLibY, hexToRgb } from '../utils/coordinates'
import { PDF_RENDER_SCALE } from '../utils/constants'

/** Exported for unit testing */
export function base64ToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1]
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function exportPdf(
  originalBytes: ArrayBuffer,
  annotations: Annotation[],
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(originalBytes)
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]
    const pageNum = pageIdx + 1
    const { width: pdfPageWidth, height: pdfPageHeight } = page.getSize()

    const pageAnnotations = annotations.filter(a =>
      a.type === 'watermark'
        ? (a as WatermarkAnnotation).allPages || a.page === pageNum
        : a.page === pageNum,
    )

    for (const annotation of pageAnnotations) {
      if (annotation.type === 'stamp' || annotation.type === 'signature') {
        // Stored coords are in rendered pixel space → divide by PDF_RENDER_SCALE to get PDF points
        const pdfX = annotation.x / PDF_RENDER_SCALE
        const pdfYTop = annotation.y / PDF_RENDER_SCALE
        const pdfW = annotation.width / PDF_RENDER_SCALE
        const pdfH = annotation.height / PDF_RENDER_SCALE
        const pdfLibY = toPdfLibY(pdfYTop, pdfH, pdfPageHeight)

        const bytes = base64ToUint8Array((annotation as any).src)
        const image = await pdfDoc.embedPng(bytes)
        page.drawImage(image, {
          x: pdfX,
          y: pdfLibY,
          width: pdfW,
          height: pdfH,
          rotate: degrees(annotation.rotation),
        })
      }

      if (annotation.type === 'watermark') {
        const wm = annotation as WatermarkAnnotation
        const [r, g, b] = hexToRgb(wm.color)
        const textWidth = helvetica.widthOfTextAtSize(wm.text, wm.fontSize)
        page.drawText(wm.text, {
          x: (pdfPageWidth - textWidth) / 2,
          y: pdfPageHeight / 2 - wm.fontSize / 2,
          size: wm.fontSize,
          font: helvetica,
          color: rgb(r, g, b),
          opacity: wm.opacity,
          rotate: degrees(wm.rotation),
        })
      }
    }
  }

  const pdfBytes = await pdfDoc.save()
  return new Blob([pdfBytes], { type: 'application/pdf' })
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- pdfExporter
```
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/pdfExporter.ts src/services/__tests__/pdfExporter.test.ts
git commit -m "feat: add PDF export service with tests"
```

---

## Task 13: App Integration & README

**Files:**
- Modify: `src/App.tsx`
- Create: `README.md`

- [ ] **Step 1: Write src/App.tsx**

```typescript
import React, { useState, useCallback, useEffect } from 'react'
import { ActionBar } from './components/toolbar/ActionBar'
import { Toolbar } from './components/toolbar/Toolbar'
import { PdfViewer } from './components/viewer/PdfViewer'
import { SignaturePad } from './components/modals/SignaturePad'
import { WatermarkConfig } from './components/modals/WatermarkConfig'
import type { WatermarkSettings } from './components/modals/WatermarkConfig'
import { usePdfDocument } from './hooks/usePdfDocument'
import { useAnnotations } from './hooks/useAnnotations'
import { exportPdf } from './services/pdfExporter'
import type { Annotation } from './types/annotation'
import { MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from './utils/constants'

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showSignaturePad, setShowSignaturePad] = useState(false)
  const [showWatermarkConfig, setShowWatermarkConfig] = useState(false)
  const [pendingStamp, setPendingStamp] = useState<{ src: string; presetId?: string } | null>(null)
  const [pendingSignature, setPendingSignature] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  const { pdfDoc, numPages, isLoading, error } = usePdfDocument(file)
  const {
    annotations,
    selectedId,
    activeMode,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    selectAnnotation,
    setActiveMode,
  } = useAnnotations()

  // Cache raw bytes for export
  useEffect(() => {
    if (file) file.arrayBuffer().then(setFileBytes)
    else setFileBytes(null)
  }, [file])

  // Delete key removes selected annotation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        removeAnnotation(selectedId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, removeAnnotation])

  const handleUpload = useCallback((f: File) => {
    setFile(f)
    setActiveMode(null)
    setPendingStamp(null)
    setPendingSignature(null)
  }, [setActiveMode])

  const handleStampSelect = useCallback((src: string, presetId?: string) => {
    setPendingStamp({ src, presetId })
    setActiveMode('stamp')
  }, [setActiveMode])

  // After placement, clear pending state and switch back to select
  const handleAnnotationAdd = useCallback((annotation: Omit<Annotation, 'id'>) => {
    addAnnotation(annotation)
    setPendingStamp(null)
    setPendingSignature(null)
    setActiveMode('select')
  }, [addAnnotation, setActiveMode])

  const handleWatermarkConfirm = useCallback((settings: WatermarkSettings) => {
    addAnnotation({
      type: 'watermark',
      page: 1,        // ignored when allPages=true
      x: 0,           // ignored — WatermarkNode centers itself
      y: 0,
      width: 0,
      height: 0,
      rotation: settings.rotation,
      text: settings.text,
      opacity: settings.opacity,
      fontSize: settings.fontSize,
      color: settings.color,
      allPages: true,
    })
    setShowWatermarkConfig(false)
    setActiveMode('select')
  }, [addAnnotation, setActiveMode])

  const handleExport = useCallback(async () => {
    if (!fileBytes) return
    setIsExporting(true)
    try {
      const blob = await exportPdf(fileBytes, annotations)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const baseName = file ? file.name.replace(/\.pdf$/i, '') : 'document'
      a.download = `${baseName}_annotated.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }, [fileBytes, annotations, file])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-900">
      <ActionBar
        hasPdf={!!pdfDoc}
        onUpload={handleUpload}
        onExport={handleExport}
        isExporting={isExporting}
      />

      <div className="flex flex-1 overflow-hidden">
        <Toolbar
          activeMode={activeMode}
          selectedId={selectedId}
          zoom={zoom}
          hasPdf={!!pdfDoc}
          onModeChange={setActiveMode}
          onZoomIn={() => setZoom(z => Math.min(+(z + ZOOM_STEP).toFixed(2), MAX_ZOOM))}
          onZoomOut={() => setZoom(z => Math.max(+(z - ZOOM_STEP).toFixed(2), MIN_ZOOM))}
          onZoomReset={() => setZoom(1)}
          onDeleteSelected={() => selectedId && removeAnnotation(selectedId)}
          onStampSelect={handleStampSelect}
          onSignatureClick={() => setShowSignaturePad(true)}
          onWatermarkClick={() => setShowWatermarkConfig(true)}
        />

        <main className="flex-1 overflow-hidden">
          {error && (
            <div className="flex items-center justify-center h-full text-red-400 p-4">
              Failed to load PDF: {error}
            </div>
          )}
          {isLoading && (
            <div className="flex items-center justify-center h-full text-gray-400">
              Loading PDF…
            </div>
          )}
          {!pdfDoc && !isLoading && !error && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 select-none">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-16 h-16 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg">Drop a PDF here or click Upload PDF</p>
            </div>
          )}
          {pdfDoc && (
            <PdfViewer
              pdfDoc={pdfDoc}
              numPages={numPages}
              zoom={zoom}
              annotations={annotations}
              selectedId={selectedId}
              activeMode={activeMode}
              pendingStamp={pendingStamp}
              pendingSignature={pendingSignature}
              onAnnotationSelect={selectAnnotation}
              onAnnotationUpdate={updateAnnotation}
              onAnnotationAdd={handleAnnotationAdd}
            />
          )}
        </main>
      </div>

      {showSignaturePad && (
        <SignaturePad
          onConfirm={dataUrl => {
            setPendingSignature(dataUrl)
            setShowSignaturePad(false)
            setActiveMode('signature')
          }}
          onCancel={() => {
            setShowSignaturePad(false)
            setActiveMode('select')
          }}
        />
      )}

      {showWatermarkConfig && (
        <WatermarkConfig
          onConfirm={handleWatermarkConfirm}
          onCancel={() => {
            setShowWatermarkConfig(false)
            setActiveMode('select')
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write README.md**

```markdown
# PDF Editor MVP

Browser-only PDF viewer with stamp, signature, and watermark annotations. No backend required.

## Setup

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Features

- **Upload PDF** — drag & drop or click Upload PDF
- **Stamp** — choose a preset (APPROVED / REJECTED / CONFIDENTIAL / DRAFT) or upload a PNG, then click on the page to place
- **Signature** — draw your signature, click OK, then click on the page to place
- **Watermark** — configure text, opacity, rotation; applied to all pages
- **Select** — click any annotation to select it; drag to move, use handles to resize/rotate; press Delete to remove
- **Zoom** — use +/− buttons in the sidebar
- **Export** — generates a new PDF with all annotations burned in

## Tech Stack

- React 18 + TypeScript + Vite
- TailwindCSS v4
- PDF.js (rendering)
- react-konva / Konva.js (annotation layer)
- pdf-lib (export)

## Tests

```bash
npm test
```
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```
Expected: All tests pass (coordinates, useAnnotations, pdfExporter).

- [ ] **Step 4: Run dev server and manually verify**

```bash
npm run dev
```

Test the following flows:
1. Upload a PDF → pages render
2. Click Stamp → pick APPROVED → click on page → stamp appears
3. Click Signature → draw → Confirm → click on page → signature appears
4. Click Watermark → configure → Apply → watermark visible on all pages
5. Click an annotation → drag it → resize via handles
6. Select annotation → press Delete → removed
7. Click Export PDF → file downloads

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx README.md
git commit -m "feat: wire up App, complete PDF editor MVP"
```

---

## All Tests Passing Check

```bash
npm test
```

Expected output (all green):
```
✓ src/utils/__tests__/coordinates.test.ts (8 tests)
✓ src/hooks/__tests__/useAnnotations.test.ts (5 tests)
✓ src/services/__tests__/pdfExporter.test.ts (2 tests)
```
