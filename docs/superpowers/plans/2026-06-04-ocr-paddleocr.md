# OCR (PaddleOCR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users run PaddleOCR on scanned/image-only PDF pages to produce a transparent, positioned, selectable + Ctrl+F-searchable text layer.

**Architecture:** A thin SDK boundary (`ocrEngine`) wraps `@paddleocr/paddleocr-js`; a hook (`useOcr`) owns per-page results and converts canvas-pixel boxes to PDF points; an `OcrTextLayer` renders the words as transparent spans mirroring the existing `PdfTextLayer`; `useSearch` gains an OCR text source so Ctrl+F also searches OCR text. Models are bundled under `public/ocr/` for offline use.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + React Testing Library, pdfjs-dist, `@paddleocr/paddleocr-js` (onnxruntime-web + OpenCV.js).

**Spec:** `docs/superpowers/specs/2026-06-04-ocr-paddleocr-design.md`

**Release version:** This feature ships as **1.2.0** (minor bump — new user-facing capability). The version bump happens in Task 8.

---

## Key existing code this plan builds on

- `src/hooks/usePdfPage.ts` → `getOrRenderPage(pdfDoc, pageNumber): Promise<PageData>` where `PageData = { canvas: HTMLCanvasElement; width: number; height: number }`, rendered at `PDF_RENDER_SCALE` (`src/utils/constants.ts`, value `1.5`). **This cached canvas is the OCR input.** Do not destroy it — it is shared.
- `src/components/viewer/PdfTextLayer.tsx` → exports `interface TextLayerHighlight { itemStart: number; itemEnd: number; active: boolean }`. Renders one `<span>` per text item, in order; highlight indices map to span indices. `OcrTextLayer` mirrors this contract.
- `src/hooks/useSearch.ts` → builds `PageText { items: string[]; concat: string; offsets: number[] }` from pdfjs `getTextContent()`; produces `SearchMatch { page, itemStart, itemEnd }`. We make it OCR-aware.
- `src/components/viewer/PdfPage.tsx:325-349` → renders `<PdfTextLayer … highlights={searchHighlights} />`. `OcrTextLayer` mounts right after it.
- `src/components/viewer/PdfViewer.tsx:59-68` → `highlightsByPage` map; `:169-174` passes `searchHighlights` into `LazyPdfPage`.
- `src/components/viewer/LazyPdfPage.tsx:28` → forwards `searchHighlights` prop to `PdfPage`.
- `src/components/toolbar/ActionBar.tsx` → `ActionBarProps` (line 157), reset button pattern at lines 470-477, print button at 585-589.
- `src/App.tsx:78` `const search = useSearch(pdfDoc, numPages)`; `:479-514` `actionBarProps`; `:627` passes `search` into `PdfViewer`.

---

## File structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/types/ocr.ts` | `OcrWord`, `OcrPageResult`, `RawOcrLine` types | Create |
| `src/utils/ocrCoords.ts` | pure: 4-point px box → axis-aligned `OcrWord` in PDF points | Create |
| `src/utils/ocrCoords.test.ts` | unit tests for the transform | Create |
| `src/services/ocrEngine.ts` | SDK singleton wrapper: `initOcr()`, `predict(canvas)` → `RawOcrLine[]` | Create |
| `src/services/ocrEngine.test.ts` | unit tests (mocked SDK) | Create |
| `src/hooks/useOcr.ts` | per-page result cache, progress, cancel, error isolation | Create |
| `src/hooks/useOcr.test.ts` | hook tests | Create |
| `src/components/viewer/OcrTextLayer.tsx` | transparent positioned spans + highlights | Create |
| `src/components/viewer/OcrTextLayer.test.tsx` | RTL render tests | Create |
| `src/components/viewer/PdfPage.tsx` | mount `OcrTextLayer`; accept `ocrResult` prop | Modify |
| `src/components/viewer/LazyPdfPage.tsx` | forward `ocrResult` prop | Modify |
| `src/components/viewer/PdfViewer.tsx` | thread `ocrResults` + OCR-aware highlights | Modify |
| `src/components/toolbar/ActionBar.tsx` | OCR button (current / whole-doc) + progress/cancel | Modify |
| `src/components/toolbar/ActionBar.test.tsx` | button RTL test | Create or Modify |
| `src/hooks/useSearch.ts` | optional OCR text provider | Modify |
| `src/App.tsx` | wire `useOcr`, pass to ActionBar + PdfViewer + useSearch | Modify |
| `src/i18n/en.ts`, `src/i18n/ko.ts` | `ocr.*` keys | Modify |
| `vite.config.ts` | `paddleocr` manual chunk | Modify |
| `public/ocr/**` | bundled models + wasm + opencv | Create (assets) |
| `THIRD-PARTY-NOTICES.md` | Apache/CC-BY attributions | Create |

---

## Task 0: PoC spike + dependency & asset setup (exploratory — NOT TDD)

**Purpose:** Confirm the real `predict()` return shape, that bundled models load offline, and that the worker runs. The exact field names from the SDK are normalized in `ocrEngine` (Task 2), so this task de-risks that one mapping.

**Files:**
- Modify: `package.json` (dependency)
- Create: `public/ocr/models/PP-OCRv5_mobile_det.tar`, `public/ocr/models/korean_PP-OCRv5_mobile_rec.tar`, `public/ocr/wasm/**`, `public/ocr/opencv/**`
- Create (scratch, delete after): `src/services/__ocr_poc.ts`

- [ ] **Step 1: Install the SDK**

Run:
```bash
npm install @paddleocr/paddleocr-js
```
Expected: package added to `dependencies`; `npm install` exits 0.

- [ ] **Step 2: Obtain and place the bundled assets**

Download the PP-OCRv5 detection model and the Korean recognition model as uncompressed ustar `.tar` archives (each containing `inference.onnx` + `inference.yml`) from the PaddleOCR model registry, plus the onnxruntime-web `.wasm` files and `opencv.js` the SDK depends on. Place them:
```
public/ocr/models/PP-OCRv5_mobile_det.tar
public/ocr/models/korean_PP-OCRv5_mobile_rec.tar
public/ocr/wasm/        (ort-wasm-*.wasm / *.jsep.wasm as required by the installed onnxruntime-web)
public/ocr/opencv/opencv.js
```
Verify the tars are uncompressed ustar (not gzip):
```bash
file public/ocr/models/*.tar
```
Expected: each reported as `POSIX tar archive` (not `gzip compressed`).

- [ ] **Step 3: Write a throwaway PoC and confirm the result shape**

Create `src/services/__ocr_poc.ts`:
```typescript
import { PaddleOCR } from '@paddleocr/paddleocr-js'

// Run from a temporary button/console in dev. Logs the raw predict() shape so we
// can lock the normalization mapping in ocrEngine.ts. DELETE after Task 0.
export async function ocrPoc(canvas: HTMLCanvasElement) {
  const ocr = await PaddleOCR.create({
    ocrVersion: 'PP-OCRv5',
    ortOptions: { backend: 'auto', wasmPaths: '/ocr/wasm/' },
    worker: true,
    textDetectionModelName: 'PP-OCRv5_mobile_det',
    textDetectionModelAsset: { url: '/ocr/models/PP-OCRv5_mobile_det.tar' },
    textRecognitionModelName: 'korean_PP-OCRv5_mobile_rec',
    textRecognitionModelAsset: { url: '/ocr/models/korean_PP-OCRv5_mobile_rec.tar' },
  })
  const [result] = await ocr.predict(canvas)
  console.log('[ocrPoc] raw result:', JSON.stringify(result, null, 2))
  return result
}
```

- [ ] **Step 4: Run it against a Korean scanned page in `npm run dev`**

Temporarily call `ocrPoc(<a rendered page canvas>)` from the browser console (grab a canvas via `document.querySelector('canvas')`). Record, in a comment at the top of `ocrEngine.ts` (Task 2), the **exact** field names for: the per-line box (array of 4 `[x,y]` points, in canvas pixels), the recognized text, and the confidence score. Note whether boxes are top-left origin and whether `worker: true` succeeded.

- [ ] **Step 5: Delete the PoC scratch file**

Run:
```bash
rm src/services/__ocr_poc.ts
```

- [ ] **Step 6: Commit assets + dependency**

```bash
git add package.json package-lock.json public/ocr
git commit -m "chore: add PaddleOCR.js dep and bundled offline OCR assets"
```

> If `predict()`'s real field names differ from the assumptions below, the ONLY place that changes is the normalization in `ocrEngine.ts` Step 3. Everything downstream consumes the normalized `RawOcrLine`.

---

## Task 1: OCR types + coordinate transform (TDD)

**Files:**
- Create: `src/types/ocr.ts`
- Create: `src/utils/ocrCoords.ts`
- Test: `src/utils/ocrCoords.test.ts`

- [ ] **Step 1: Define the types**

Create `src/types/ocr.ts`:
```typescript
/** One recognized text box in PDF points (page-local, top-left origin) —
 *  the same coordinate space as annotations (multiply by effectiveZoom for screen). */
export interface OcrWord {
  text: string
  score: number
  x: number
  y: number
  width: number
  height: number
  rotation: number // box angle; v1 always 0 (axis-aligned bbox)
}

export interface OcrPageResult {
  page: number
  words: OcrWord[]
  status: 'done' | 'error'
  durationMs: number
}

/** Normalized single line from the SDK: box = 4 [x,y] points in CANVAS pixels. */
export interface RawOcrLine {
  box: [number, number][]
  text: string
  score: number
}
```

- [ ] **Step 2: Write the failing test**

Create `src/utils/ocrCoords.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { lineToWord } from './ocrCoords'
import type { RawOcrLine } from '../types/ocr'

describe('lineToWord', () => {
  it('converts an axis-aligned px box to PDF points by dividing by renderScale', () => {
    const line: RawOcrLine = {
      box: [[15, 30], [75, 30], [75, 60], [15, 60]], // px
      text: 'hello',
      score: 0.9,
    }
    const w = lineToWord(line, 1.5)
    expect(w).toEqual({
      text: 'hello', score: 0.9,
      x: 10, y: 20, width: 40, height: 20, rotation: 0,
    })
  })

  it('takes the bounding box of a skewed quad (min/max of all 4 points)', () => {
    const line: RawOcrLine = {
      box: [[30, 30], [90, 36], [90, 66], [30, 60]],
      text: 'x', score: 0.5,
    }
    const w = lineToWord(line, 1.5)
    // minX=30,minY=30,maxX=90,maxY=66 → /1.5
    expect(w.x).toBe(20)
    expect(w.y).toBe(20)
    expect(w.width).toBe(40)
    expect(w.height).toBe(24)
  })

  it('trims empty text to empty string and keeps score', () => {
    const line: RawOcrLine = { box: [[0,0],[3,0],[3,3],[0,3]], text: '  ', score: 0.1 }
    expect(lineToWord(line, 1).text).toBe('')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/utils/ocrCoords.test.ts`
Expected: FAIL — `lineToWord` is not exported / module missing.

- [ ] **Step 4: Implement**

Create `src/utils/ocrCoords.ts`:
```typescript
import type { RawOcrLine, OcrWord } from '../types/ocr'

/**
 * Convert one SDK line (4-point box in canvas pixels, rendered at `renderScale`)
 * to an axis-aligned OcrWord in PDF points. v1 ignores box rotation and stores
 * the bounding box, matching the annotation coordinate convention.
 */
export function lineToWord(line: RawOcrLine, renderScale: number): OcrWord {
  const xs = line.box.map(p => p[0])
  const ys = line.box.map(p => p[1])
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)
  return {
    text: line.text.trim(),
    score: line.score,
    x: minX / renderScale,
    y: minY / renderScale,
    width: (maxX - minX) / renderScale,
    height: (maxY - minY) / renderScale,
    rotation: 0,
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/utils/ocrCoords.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/ocr.ts src/utils/ocrCoords.ts src/utils/ocrCoords.test.ts
git commit -m "feat: OCR types and px-box→PDF-point coordinate transform"
```

---

## Task 2: ocrEngine SDK boundary (TDD, mocked SDK)

**Files:**
- Create: `src/services/ocrEngine.ts`
- Test: `src/services/ocrEngine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/ocrEngine.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()
const predictMock = vi.fn()

vi.mock('@paddleocr/paddleocr-js', () => ({
  PaddleOCR: { create: (...a: unknown[]) => createMock(...a) },
}))

import { initOcr, predict, __resetOcrForTests } from './ocrEngine'

beforeEach(() => {
  createMock.mockReset()
  predictMock.mockReset()
  __resetOcrForTests()
  createMock.mockResolvedValue({ predict: predictMock })
})

describe('ocrEngine', () => {
  it('initializes the SDK only once across concurrent calls', async () => {
    await Promise.all([initOcr(), initOcr(), initOcr()])
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('predict normalizes SDK output to RawOcrLine[]', async () => {
    // Real SDK shape (confirmed from @paddleocr/paddleocr-js types):
    //   predict() -> OcrResult[]; OcrResult.items[] = { poly: [number,number][], text, score }
    predictMock.mockResolvedValue([{
      image: { width: 100, height: 100 },
      items: [{ poly: [[1,2],[3,2],[3,4],[1,4]], text: 'hi', score: 0.8 }],
      metrics: {}, runtime: {},
    }])
    const canvas = document.createElement('canvas')
    const lines = await predict(canvas)
    expect(lines).toEqual([{ box: [[1,2],[3,2],[3,4],[1,4]], text: 'hi', score: 0.8 }])
  })

  it('throws a clear error if SDK init fails', async () => {
    createMock.mockRejectedValue(new Error('wasm 404'))
    await expect(initOcr()).rejects.toThrow(/OCR engine failed to load/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/ocrEngine.test.ts`
Expected: FAIL — `./ocrEngine` missing.

- [ ] **Step 3: Implement**

Create `src/services/ocrEngine.ts` (shape confirmed from the SDK's own TypeScript types):
```typescript
// SDK result shape (from @paddleocr/paddleocr-js types):
//   create(opts) -> PaddleOCR; predict(canvas) -> OcrResult[]
//   OcrResult = { image:{width,height}, items: OcrResultItem[], metrics, runtime }
//   OcrResultItem = { poly: [number,number][], text: string, score: number }
import { PaddleOCR } from '@paddleocr/paddleocr-js'
import type { OcrResult } from '@paddleocr/paddleocr-js'
import type { RawOcrLine } from '../types/ocr'

type OcrInstance = { predict: (img: HTMLCanvasElement) => Promise<OcrResult[]> }

let instance: OcrInstance | null = null
let initPromise: Promise<OcrInstance> | null = null

export function __resetOcrForTests() { instance = null; initPromise = null }

export function initOcr(): Promise<OcrInstance> {
  if (instance) return Promise.resolve(instance)
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const ocr = await PaddleOCR.create({
        ocrVersion: 'PP-OCRv5',
        ortOptions: { backend: 'auto', wasmPaths: '/ocr/wasm/' },
        worker: true,
        textDetectionModelName: 'PP-OCRv5_mobile_det',
        textDetectionModelAsset: { url: '/ocr/models/PP-OCRv5_mobile_det.tar' },
        textRecognitionModelName: 'korean_PP-OCRv5_mobile_rec',
        textRecognitionModelAsset: { url: '/ocr/models/korean_PP-OCRv5_mobile_rec.tar' },
      }) as OcrInstance
      instance = ocr
      return ocr
    } catch (err) {
      initPromise = null
      throw new Error(`OCR engine failed to load: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
  return initPromise
}

/** Normalize the SDK's per-image result into RawOcrLine[]. */
function normalize(result: OcrResult): RawOcrLine[] {
  return result.items.map(it => ({
    box: it.poly.map(p => [p[0], p[1]] as [number, number]),
    text: it.text,
    score: it.score,
  }))
}

export async function predict(canvas: HTMLCanvasElement): Promise<RawOcrLine[]> {
  const ocr = await initOcr()
  const out = await ocr.predict(canvas) // OcrResult[] — one per input image
  const first = out[0]
  if (!first) return []
  return normalize(first)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/ocrEngine.test.ts`
Expected: PASS (3 tests). If the normalization test fails because Task 0 found different field names, update `normalize()` and the test's `predictMock` value together.

- [ ] **Step 5: Commit**

```bash
git add src/services/ocrEngine.ts src/services/ocrEngine.test.ts
git commit -m "feat: ocrEngine SDK boundary (lazy singleton + result normalization)"
```

---

## Task 3: useOcr hook (TDD)

**Files:**
- Create: `src/hooks/useOcr.ts`
- Test: `src/hooks/useOcr.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useOcr.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const predictMock = vi.fn()
vi.mock('../services/ocrEngine', () => ({ predict: (...a: unknown[]) => predictMock(...a) }))

const getOrRenderPageMock = vi.fn()
vi.mock('./usePdfPage', () => ({ getOrRenderPage: (...a: unknown[]) => getOrRenderPageMock(...a) }))

import { useOcr } from './useOcr'

const fakeDoc = {} as import('pdfjs-dist').PDFDocumentProxy
const fakeCanvas = () => ({ canvas: document.createElement('canvas'), width: 15, height: 15 })

beforeEach(() => {
  predictMock.mockReset()
  getOrRenderPageMock.mockReset()
  getOrRenderPageMock.mockResolvedValue(fakeCanvas())
})

describe('useOcr', () => {
  it('runs a page, stores words in PDF points, and caches (no second predict)', async () => {
    predictMock.mockResolvedValue([{ box: [[0,0],[15,0],[15,15],[0,15]], text: 'hi', score: 0.9 }])
    const { result } = renderHook(() => useOcr(fakeDoc, 3))

    await act(async () => { await result.current.runPage(1) })
    const r = result.current.ocrResults.get(1)
    expect(r?.status).toBe('done')
    expect(r?.words[0]).toMatchObject({ text: 'hi', x: 0, y: 0, width: 10, height: 10 }) // /1.5

    await act(async () => { await result.current.runPage(1) }) // cache hit
    expect(predictMock).toHaveBeenCalledTimes(1)
  })

  it('isolates a per-page failure during whole-doc run', async () => {
    predictMock
      .mockResolvedValueOnce([{ box: [[0,0],[3,0],[3,3],[0,3]], text: 'a', score: 1 }])
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([{ box: [[0,0],[3,0],[3,3],[0,3]], text: 'c', score: 1 }])
    const { result } = renderHook(() => useOcr(fakeDoc, 3))

    await act(async () => { await result.current.runAll() })
    expect(result.current.ocrResults.get(1)?.status).toBe('done')
    expect(result.current.ocrResults.get(2)?.status).toBe('error')
    expect(result.current.ocrResults.get(3)?.status).toBe('done')
  })

  it('sets ocrError when the engine fails to load on the first page', async () => {
    getOrRenderPageMock.mockResolvedValue(fakeCanvas())
    predictMock.mockRejectedValue(new Error('OCR engine failed to load: wasm 404'))
    const { result } = renderHook(() => useOcr(fakeDoc, 1))
    await act(async () => { await result.current.runPage(1) })
    await waitFor(() => expect(result.current.ocrError).toMatch(/failed to load/))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useOcr.test.ts`
Expected: FAIL — `./useOcr` missing.

- [ ] **Step 3: Implement**

Create `src/hooks/useOcr.ts`:
```typescript
import { useState, useRef, useCallback } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getOrRenderPage } from './usePdfPage'
import { predict } from '../services/ocrEngine'
import { lineToWord } from '../utils/ocrCoords'
import { PDF_RENDER_SCALE } from '../utils/constants'
import type { OcrPageResult } from '../types/ocr'

export interface UseOcrReturn {
  ocrResults: Map<number, OcrPageResult>
  ocrProgress: { done: number; total: number } | null
  isOcrRunning: boolean
  ocrError: string | null
  runPage: (page: number) => Promise<void>
  runAll: () => Promise<void>
  cancel: () => void
  clear: () => void
}

export function useOcr(pdfDoc: PDFDocumentProxy | null, numPages: number): UseOcrReturn {
  const [ocrResults, setOcrResults] = useState<Map<number, OcrPageResult>>(new Map())
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null)
  const [isOcrRunning, setIsOcrRunning] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const resultsRef = useRef(ocrResults)
  resultsRef.current = ocrResults
  const abortRef = useRef(false)

  const ocrOnePage = useCallback(async (page: number): Promise<OcrPageResult> => {
    const cached = resultsRef.current.get(page)
    if (cached && cached.status === 'done') return cached
    if (!pdfDoc) return { page, words: [], status: 'error', durationMs: 0 }
    const started = performance.now()
    try {
      const { canvas } = await getOrRenderPage(pdfDoc, page)
      const lines = await predict(canvas)
      const words = lines.map(l => lineToWord(l, PDF_RENDER_SCALE)).filter(w => w.text.length > 0)
      return { page, words, status: 'done', durationMs: performance.now() - started }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : String(err))
      return { page, words: [], status: 'error', durationMs: performance.now() - started }
    }
  }, [pdfDoc])

  const store = useCallback((res: OcrPageResult) => {
    setOcrResults(prev => { const next = new Map(prev); next.set(res.page, res); return next })
  }, [])

  const runPage = useCallback(async (page: number) => {
    setIsOcrRunning(true)
    setOcrError(null)
    try { store(await ocrOnePage(page)) }
    finally { setIsOcrRunning(false) }
  }, [ocrOnePage, store])

  const runAll = useCallback(async () => {
    abortRef.current = false
    setIsOcrRunning(true)
    setOcrError(null)
    setOcrProgress({ done: 0, total: numPages })
    try {
      for (let p = 1; p <= numPages; p++) {
        if (abortRef.current) break
        store(await ocrOnePage(p))
        setOcrProgress({ done: p, total: numPages })
      }
    } finally {
      setIsOcrRunning(false)
      setOcrProgress(null)
    }
  }, [numPages, ocrOnePage, store])

  const cancel = useCallback(() => { abortRef.current = true }, [])
  const clear = useCallback(() => { setOcrResults(new Map()); setOcrError(null) }, [])

  return { ocrResults, ocrProgress, isOcrRunning, ocrError, runPage, runAll, cancel, clear }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useOcr.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOcr.ts src/hooks/useOcr.test.ts
git commit -m "feat: useOcr hook (per-page cache, whole-doc progress, cancel, error isolation)"
```

---

## Task 4: OcrTextLayer (TDD, RTL)

**Files:**
- Create: `src/components/viewer/OcrTextLayer.tsx`
- Test: `src/components/viewer/OcrTextLayer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/viewer/OcrTextLayer.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { OcrTextLayer } from './OcrTextLayer'
import type { OcrWord } from '../../types/ocr'

const words: OcrWord[] = [
  { text: 'alpha', score: 1, x: 10, y: 20, width: 40, height: 12, rotation: 0 },
  { text: 'beta',  score: 1, x: 10, y: 40, width: 30, height: 12, rotation: 0 },
]

describe('OcrTextLayer', () => {
  it('renders one span per word in order, positioned at x*scale', () => {
    const { container } = render(
      <OcrTextLayer words={words} scale={2} width={200} height={200} />,
    )
    const spans = container.querySelectorAll(':scope > div > span')
    expect(spans).toHaveLength(2)
    expect(spans[0].textContent).toBe('alpha')
    expect((spans[0] as HTMLElement).style.left).toBe('20px') // 10 * 2
    expect((spans[0] as HTMLElement).style.top).toBe('40px')  // 20 * 2
  })

  it('applies highlight classes by item index', () => {
    const { container } = render(
      <OcrTextLayer words={words} scale={1} width={200} height={200}
        highlights={[{ itemStart: 1, itemEnd: 1, active: true }]} />,
    )
    const spans = container.querySelectorAll<HTMLElement>(':scope > div > span')
    expect(spans[0].className).not.toMatch(/wz-search-hl/)
    expect(spans[1].className).toMatch(/wz-search-hl-active/)
  })

  it('renders nothing for an empty word list', () => {
    const { container } = render(<OcrTextLayer words={[]} scale={1} width={10} height={10} />)
    expect(container.querySelectorAll('span')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/viewer/OcrTextLayer.test.tsx`
Expected: FAIL — `./OcrTextLayer` missing.

- [ ] **Step 3: Implement**

Create `src/components/viewer/OcrTextLayer.tsx`:
```typescript
import type { OcrWord } from '../../types/ocr'
import type { TextLayerHighlight } from './PdfTextLayer'

interface OcrTextLayerProps {
  words: OcrWord[]
  /** Effective display scale (PDF_RENDER_SCALE * zoom). */
  scale: number
  width: number
  height: number
  highlights?: TextLayerHighlight[]
}

/**
 * Transparent, positioned text overlay built from OCR words. Mirrors
 * PdfTextLayer's contract: one <span> per item, in order, so highlight item
 * indices map to span indices. Spans are selectable/copyable; text is
 * transparent so only the painted canvas underneath is visible.
 */
export function OcrTextLayer({ words, scale, width, height, highlights }: OcrTextLayerProps) {
  const activeSet = new Set<number>()
  const hlSet = new Set<number>()
  for (const h of highlights ?? []) {
    for (let i = h.itemStart; i <= h.itemEnd; i++) {
      hlSet.add(i)
      if (h.active) activeSet.add(i)
    }
  }

  return (
    <div
      className="pdf-text-layer no-print"
      style={{ position: 'absolute', top: 0, left: 0, width, height, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {words.map((w, i) => {
        const cls = ['wz-ocr-span']
        if (hlSet.has(i)) cls.push('wz-search-hl')
        if (activeSet.has(i)) cls.push('wz-search-hl-active')
        return (
          <span
            key={i}
            className={cls.join(' ')}
            style={{
              position: 'absolute',
              left: w.x * scale,
              top: w.y * scale,
              width: w.width * scale,
              height: w.height * scale,
              fontSize: w.height * scale,
              lineHeight: 1,
              color: 'transparent',
              whiteSpace: 'pre',
              cursor: 'text',
              pointerEvents: 'auto',
              userSelect: 'text',
            }}
          >
            {w.text}
          </span>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/viewer/OcrTextLayer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/viewer/OcrTextLayer.tsx src/components/viewer/OcrTextLayer.test.tsx
git commit -m "feat: OcrTextLayer (transparent positioned spans mirroring PdfTextLayer)"
```

---

## Task 5: Thread OCR results through the viewer (Modify)

**Files:**
- Modify: `src/components/viewer/PdfPage.tsx`
- Modify: `src/components/viewer/LazyPdfPage.tsx`
- Modify: `src/components/viewer/PdfViewer.tsx`

- [ ] **Step 1: Add `ocrResult` prop to PdfPage and mount OcrTextLayer**

In `src/components/viewer/PdfPage.tsx`:

Add imports near the top (after the `PdfTextLayer` import at line 7-8):
```typescript
import { OcrTextLayer } from './OcrTextLayer'
import type { OcrPageResult } from '../../types/ocr'
```

Add to the props interface (next to `searchHighlights?` at line 37):
```typescript
  ocrResult?: OcrPageResult
```

Destructure it (next to `searchHighlights,` at line 54):
```typescript
  ocrResult,
```

Immediately AFTER the closing `/>` of `<PdfTextLayer … />` (currently ends at line 349), add:
```typescript
      {ocrResult && ocrResult.words.length > 0 && (
        <OcrTextLayer
          words={ocrResult.words}
          scale={effectiveZoom}
          width={stageWidth}
          height={stageHeight}
          highlights={searchHighlights}
        />
      )}
```

- [ ] **Step 2: Forward `ocrResult` in LazyPdfPage**

In `src/components/viewer/LazyPdfPage.tsx`, add to `LazyPdfPageProps` (after line 28 `searchHighlights?`):
```typescript
  ocrResult?: import('../../types/ocr').OcrPageResult
```
No other change needed — `<PdfPage {...props} />` (line 48) already spreads it through.

- [ ] **Step 3: Thread `ocrResults` from PdfViewer**

In `src/components/viewer/PdfViewer.tsx`:

Add import:
```typescript
import type { OcrPageResult } from '../../types/ocr'
```

Add to `PdfViewerProps` (after `search?` at line 34):
```typescript
  /** Per-page OCR results (single-view text layer + search). */
  ocrResults?: Map<number, OcrPageResult>
```

Destructure `ocrResults` in the function params (after `search,` at line 56).

In the single-mode `LazyPdfPage` render (lines 169-174), add the prop:
```typescript
          <LazyPdfPage
            {...sharedAnnotationProps}
            pageNumber={pageNum}
            searchHighlights={highlightsByPage.get(pageNum)}
            ocrResult={ocrResults?.get(pageNum)}
          />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full suite (nothing should break)**

Run: `npm run test:run`
Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/viewer/PdfPage.tsx src/components/viewer/LazyPdfPage.tsx src/components/viewer/PdfViewer.tsx
git commit -m "feat: thread OCR results into single-view text layer"
```

---

## Task 6: ActionBar OCR control + App wiring (TDD for ActionBar, manual wiring for App)

**Files:**
- Modify: `src/components/toolbar/ActionBar.tsx`
- Create/Modify: `src/components/toolbar/ActionBar.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing ActionBar test**

Create (or add a block to) `src/components/toolbar/ActionBar.test.tsx`. Render `ActionBar` with the minimum props it requires plus the new OCR props, then assert the button calls the handlers. Use this focused test (adapt the existing required-props object if a test file already exists — reuse its helper):
```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionBar, type ActionBarProps } from './ActionBar'

// Minimal props builder — fill every required ActionBarProps field with no-ops.
function baseProps(over: Partial<ActionBarProps>): ActionBarProps {
  const noop = () => {}
  return {
    appMode: 'editor', viewMode: 'single', zoom: 1, rotation: 0, activeMode: null,
    selectedId: null, isExporting: false, numPages: 3, currentPage: 1, isPanelOpen: false,
    onTogglePanel: noop, onUpload: noop, onOpenUrl: noop, onExportPdf: noop, onExportHtml: noop,
    onExportImages: noop, onExportExe: noop, onPrint: noop, onAppModeChange: noop,
    onViewModeChange: noop, onZoomIn: noop, onZoomOut: noop, onZoomReset: noop, onRotate: noop,
    onModeChange: noop, onStampSelect: noop, onSignatureClick: noop, onWatermarkClick: noop,
    onDeleteSelected: noop, onResetMarkups: noop, hasMarkups: false,
    onRunOcr: noop, onRunOcrAll: noop, isOcrRunning: false, ocrProgress: null,
    ...over,
  } as ActionBarProps
}

describe('ActionBar OCR control', () => {
  it('fires onRunOcr for the current page', () => {
    const onRunOcr = vi.fn()
    render(<ActionBar {...baseProps({ onRunOcr })} />)
    fireEvent.click(screen.getByRole('button', { name: /OCR \(current page\)|OCR \(현재 페이지\)/i }))
    expect(onRunOcr).toHaveBeenCalledTimes(1)
  })

  it('disables the OCR control while running', () => {
    render(<ActionBar {...baseProps({ isOcrRunning: true })} />)
    expect(screen.getByRole('button', { name: /OCR \(current page\)|OCR \(현재 페이지\)/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/toolbar/ActionBar.test.tsx`
Expected: FAIL — `onRunOcr` not in props / button not found.

- [ ] **Step 3: Add OCR props + button to ActionBar**

In `src/components/toolbar/ActionBar.tsx`:

Add to `ActionBarProps` (after `hasMarkups: boolean` at line 189):
```typescript
  onRunOcr: () => void
  onRunOcrAll: () => void
  isOcrRunning: boolean
  ocrProgress: { done: number; total: number } | null
```

Destructure them in the component params (after `hasMarkups,` at line 226):
```typescript
  onRunOcr,
  onRunOcrAll,
  isOcrRunning,
  ocrProgress,
```

Add an icon near the other icon components (e.g. after `IconPrint` at line 117-125):
```typescript
const IconOcr = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 8h6M7 12h10M7 16h8" />
  </svg>
)
```

Add the button group next to the Print button (after the print `<button>` ending at line 589). Use `useTranslation`'s `t` (already in scope in this component — it is used for other labels):
```typescript
            <div className="relative inline-flex">
              <button
                type="button"
                onClick={onRunOcr}
                disabled={isOcrRunning || numPages === 0}
                aria-label={t('ocr.runCurrent')}
                title={t('ocr.runCurrent')}
                className="p-2 rounded hover:bg-gray-700 disabled:opacity-40 text-gray-200"
              ><IconOcr /></button>
              <button
                type="button"
                onClick={onRunOcrAll}
                disabled={isOcrRunning || numPages === 0}
                aria-label={t('ocr.runAll')}
                title={t('ocr.runAll')}
                className="px-1 text-[10px] rounded hover:bg-gray-700 disabled:opacity-40 text-gray-300"
              >ALL</button>
              {ocrProgress && (
                <span className="ml-1 self-center text-[10px] text-gray-400 tabular-nums">
                  {ocrProgress.done}/{ocrProgress.total}
                </span>
              )}
            </div>
```

> i18n keys `ocr.runCurrent` / `ocr.runAll` are added in Task 8. To keep this task's test green before Task 8, also add the keys now in `src/i18n/en.ts` and `src/i18n/ko.ts` (Task 8 adds the rest). Minimum to add now:
> - en: `ocr: { runCurrent: 'OCR (current page)', runAll: 'OCR (whole document)' }`
> - ko: `ocr: { runCurrent: 'OCR (현재 페이지)', runAll: 'OCR (전체 문서)' }`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/toolbar/ActionBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `useOcr` into App.tsx**

In `src/App.tsx`:

Add import near the other hook imports (around line 11):
```typescript
import { useOcr } from './hooks/useOcr'
```

Add the hook call near `const search = useSearch(pdfDoc, numPages)` (line 78):
```typescript
  const ocr = useOcr(pdfDoc, numPages)
```

Add to the `actionBarProps` object (after `hasMarkups: …` at line 513):
```typescript
    onRunOcr: () => ocr.runPage(currentPage),
    onRunOcrAll: ocr.runAll,
    isOcrRunning: ocr.isOcrRunning,
    ocrProgress: ocr.ocrProgress,
```

Pass results into `PdfViewer` (the `<PdfViewer … />` that already receives `search={…}` at line 627) by adding:
```typescript
                ocrResults={ocr.ocrResults}
```

Surface the engine error as a Toast — after the hook call add an effect (place near other effects):
```typescript
  useEffect(() => {
    if (ocr.ocrError) showToast(ocr.ocrError)
  }, [ocr.ocrError])
```
(`showToast` is the existing toast helper in App.tsx. If its identity isn't stable, add an eslint-disable for exhaustive-deps consistent with the file's existing pattern.)

- [ ] **Step 6: Typecheck + full suite**

Run: `npx tsc -b --noEmit && npm run test:run`
Expected: no type errors; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/toolbar/ActionBar.tsx src/components/toolbar/ActionBar.test.tsx src/App.tsx src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat: ActionBar OCR control wired to useOcr (current page / whole doc)"
```

---

## Task 7: Search integration — Ctrl+F finds OCR text (TDD)

**Files:**
- Modify: `src/hooks/useSearch.ts`
- Test: `src/hooks/useSearch.test.ts` (create or extend)
- Modify: `src/App.tsx`

The rule: a page's pdfjs text takes priority; only when pdfjs yields **no** items do we use OCR words (`items = words.map(w => w.text)`). Because `OcrTextLayer` renders one span per word in order, `itemStart/itemEnd` map to OCR spans the same way they map to pdfjs spans.

- [ ] **Step 1: Write the failing test**

Create/extend `src/hooks/useSearch.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSearch } from './useSearch'

// pdfjs doc whose pages have NO text items (scanned) — forces OCR fallback.
function emptyTextDoc(numPages: number) {
  return {
    getPage: vi.fn(async () => ({ getTextContent: async () => ({ items: [] }) })),
  } as unknown as import('pdfjs-dist').PDFDocumentProxy
}

describe('useSearch with OCR provider', () => {
  it('searches OCR words when the page has no pdfjs text', async () => {
    const doc = emptyTextDoc(1)
    const ocrProvider = (page: number) => (page === 1 ? ['hello', 'world'] : undefined)
    const { result } = renderHook(() => useSearch(doc, 1, ocrProvider))

    await act(async () => { await result.current.run('world') })
    expect(result.current.matches).toHaveLength(1)
    expect(result.current.matches[0]).toMatchObject({ page: 1, itemStart: 1, itemEnd: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useSearch.test.ts`
Expected: FAIL — `useSearch` takes 2 args / OCR not used.

- [ ] **Step 3: Implement the OCR fallback**

In `src/hooks/useSearch.ts`:

Change the signature (line 38) to accept an optional provider:
```typescript
export function useSearch(
  pdfDoc: PDFDocumentProxy | null,
  numPages: number,
  ocrProvider?: (page: number) => string[] | undefined,
): UseSearchReturn {
```

In `getPageText` (lines 52-71), after extracting pdfjs `items`, fall back to OCR when empty. Replace the body from the `const items = …` line through the `const result` assignment with:
```typescript
    const pg = await doc.getPage(page)
    const content = await pg.getTextContent()
    let items = content.items.map(it => ('str' in it ? it.str : ''))
    // Scanned page (no pdfjs text) → use OCR words if available.
    if (items.join('').trim().length === 0) {
      const ocrItems = ocrProvider?.(page)
      if (ocrItems && ocrItems.length > 0) items = ocrItems
    }
    const offsets: number[] = []
    let concat = ''
    for (const s of items) {
      offsets.push(concat.length)
      concat += s
    }
    const result: PageText = { items, concat: concat.toLowerCase(), offsets }
```

Add `ocrProvider` to the `getPageText` `useCallback` dependency array (line 71): `}, [ocrProvider])`.

> Note: the page-text cache keys on the document. Because OCR results can arrive *after* a page was first cached as empty, clear the search cache when OCR results change — handled by App passing a provider whose identity changes (Step 5) — but to be safe, also invalidate: in `getPageText`, if `ocrProvider` is supplied and the cached entry has empty `concat`, recompute. Implement by changing the cache-hit guard:
```typescript
    const hit = cacheRef.current.pages.get(page)
    if (hit && !(hit.concat.length === 0 && ocrProvider?.(page)?.length)) return hit
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useSearch.test.ts`
Expected: PASS.

- [ ] **Step 5: Pass the OCR provider from App**

In `src/App.tsx`, change the search hook call (line 78) to supply a provider backed by OCR results:
```typescript
  const ocr = useOcr(pdfDoc, numPages)
  const search = useSearch(pdfDoc, numPages, (page) => {
    const r = ocr.ocrResults.get(page)
    return r && r.status === 'done' ? r.words.map(w => w.text) : undefined
  })
```
(Ensure `ocr` is declared before `search`; move the `useOcr` line above `useSearch` if Task 6 placed it after.)

- [ ] **Step 6: Full suite**

Run: `npm run test:run`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useSearch.ts src/hooks/useSearch.test.ts src/App.tsx
git commit -m "feat: Ctrl+F searches OCR text on scanned pages"
```

---

## Task 8: Bundle chunk, i18n, attribution, manual verification (Modify)

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Create: `THIRD-PARTY-NOTICES.md`

- [ ] **Step 1: Add the `paddleocr` manual chunk**

In `vite.config.ts`, inside `manualChunks` (after the konva block, lines 36-38), add:
```typescript
          if (id.includes('node_modules/@paddleocr') || id.includes('onnxruntime-web')) {
            return 'vendor-paddleocr'
          }
```

- [ ] **Step 2: Make the OCR engine import lazy (keep it out of the initial chunk)**

In `src/hooks/useOcr.ts`, replace the top-level `import { predict } from '../services/ocrEngine'` with a lazy dynamic import inside `ocrOnePage`:
```typescript
      const { predict } = await import('../services/ocrEngine')
      const { canvas } = await getOrRenderPage(pdfDoc, page)
      const lines = await predict(canvas)
```
Remove the now-unused static import. Update `src/hooks/useOcr.test.ts`'s mock to match a dynamic import (the existing `vi.mock('../services/ocrEngine', …)` already intercepts dynamic imports — no test change needed). Re-run `npx vitest run src/hooks/useOcr.test.ts` → expected PASS.

- [ ] **Step 3: Complete the i18n keys**

In `src/i18n/en.ts`, under the `ocr` object started in Task 6, ensure all keys exist:
```typescript
  ocr: {
    runCurrent: 'OCR (current page)',
    runAll: 'OCR (whole document)',
    progress: 'OCR {done}/{total}',
    noText: 'No text recognized',
    engineError: 'OCR engine failed to load',
    cancel: 'Cancel OCR',
  },
```
In `src/i18n/ko.ts`:
```typescript
  ocr: {
    runCurrent: 'OCR (현재 페이지)',
    runAll: 'OCR (전체 문서)',
    progress: 'OCR {done}/{total}',
    noText: '인식된 텍스트가 없습니다',
    engineError: 'OCR 엔진 로드 실패',
    cancel: 'OCR 취소',
  },
```
(Match the existing nesting/format of these i18n files; if they are flat `'ocr.runCurrent'` keys, follow that style instead.)

- [ ] **Step 4: Add THIRD-PARTY-NOTICES.md**

Create `THIRD-PARTY-NOTICES.md`:
```markdown
# Third-Party Notices

WZ PDF bundles the following third-party components.

## PaddleOCR — Apache License 2.0
- PaddleOCR toolkit, PP-OCRv5 detection model, korean_PP-OCRv5 recognition model
- @paddleocr/paddleocr-js
- https://github.com/PaddlePaddle/PaddleOCR — Copyright PaddlePaddle Authors

## ONNX Runtime Web — MIT License
- https://github.com/microsoft/onnxruntime — Copyright Microsoft Corporation

## OpenCV (opencv.js) — Apache License 2.0
- https://github.com/opencv/opencv — Copyright OpenCV team

Full Apache-2.0 and MIT license texts are included with this distribution.
```

- [ ] **Step 5: Production build smoke test**

Run: `npm run build`
Expected: build succeeds; output shows a separate `vendor-paddleocr` chunk; the OCR engine is not in the entry chunk.

- [ ] **Step 6: Manual verification checklist (dev)**

Run `npm run dev`, open a **Korean scanned PDF**, then verify:
- Clicking the OCR (current page) button populates a selectable text layer you can drag-select and copy.
- Clicking ALL shows `done/total` progress and processes every page.
- Ctrl+F finds a word that only exists in the scanned image.
- Zooming keeps the OCR text aligned with the glyphs.
- A page with native pdfjs text is unaffected (no duplicate OCR overlay).
- Forcing an engine-load failure (temporarily rename `public/ocr/wasm/`) shows a Toast and does not crash the app.

- [ ] **Step 7: Bump version to 1.2.0**

In `package.json`, change `"version"` to `"1.2.0"` (minor bump — new user-facing OCR capability). The ActionBar version pill (`v{__APP_VERSION__}`) then reflects it automatically.

Run: `npm run test:run`
Expected: all PASS (pill shows `v1.2.0` in dev).

- [ ] **Step 8: Commit**

```bash
git add vite.config.ts src/hooks/useOcr.ts src/i18n/en.ts src/i18n/ko.ts THIRD-PARTY-NOTICES.md package.json
git commit -m "feat: lazy-load OCR chunk, i18n keys, third-party notices; release 1.2.0"
```

---

## Out of scope (tracked for later)
- Searchable-PDF export of OCR text (v2).
- Explicit per-page "re-run OCR".
- Languages beyond Korean + English.
- Remapping `ocrResults` after page CRUD (insert/delete/reorder) — if shipped before this lands, invalidate affected pages via `ocr.clear()` after a page operation.

## Self-review notes
- **Spec coverage:** engine choice (Task 0,2) · bundled offline models (Task 0) · ocrEngine/useOcr/OcrTextLayer modules (Tasks 2,3,4) · coordinate invariant ÷PDF_RENDER_SCALE (Task 1,3) · pdfjs-priority rule (Task 7) · error isolation + engine-error Toast (Task 3,6) · whole-doc progress + cancel (Task 3,6) · search integration (Task 7) · lazy chunk (Task 8) · i18n + notices (Task 8) · testing per module (every task). v1 export-exclusion is satisfied by doing nothing in the exporters.
- **Type consistency:** `OcrWord`/`OcrPageResult`/`RawOcrLine` defined once in `src/types/ocr.ts` and imported everywhere; `lineToWord`, `initOcr`, `predict`, `useOcr` return shape, and `OcrTextLayer` props all consistent across tasks.
- **Cancel semantics:** `runAll` checks `abortRef` between pages; `cancel()` sets it. Single-page `runPage` is not cancelable by design (fast).
