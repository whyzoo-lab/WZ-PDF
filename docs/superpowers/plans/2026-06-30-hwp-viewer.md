# HWP / HWPX Viewer Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open `.hwp`/`.hwpx` files in WZ PDF exactly like PDFs — rendered to canvas via rhwp `@rhwp/core` (WASM) and fed through the existing viewer / annotation / OCR / print / export pipeline unchanged.

**Architecture:** Wrap rhwp's `HwpDocument` in a **pdfjs-shaped adapter** that satisfies a shared `ViewerDoc` interface (the subset of `PDFDocumentProxy` the app actually uses). `usePdfDocument` detects the file type and returns either a real pdfjs doc or the HWP adapter; everything downstream consumes `ViewerDoc` and stays source-agnostic.

**Tech Stack:** React 19, Vite (rolldown), TypeScript, Konva, pdfjs-dist, pdf-lib, **`@rhwp/core@0.7.17`** (Rust→WASM, MIT), Vitest, Electron.

**Spec:** `docs/superpowers/specs/2026-06-30-hwp-viewer-design.md`

## Global Constraints

- Package: pin **`@rhwp/core@0.7.17`** exactly (pre-1.0, API may drift). Import surface: `import init, { HwpDocument } from '@rhwp/core'`.
- rhwp WASM (`rhwp_bg.wasm`) and `@rhwp/core` MUST stay in a **dynamically-imported lazy chunk** — never hoisted into the entry static graph (the OCR blank-screen lesson: emscripten/WASM `new Function` under the packaged CSP). Verify after build.
- Reuse the existing **non-blocking** error path (toast + inline). Never `alert()` (freezes embedded iframes).
- Do NOT change the PDF code path's behavior — all 138 existing tests must stay green.
- Lint must not gain new errors (7 pre-existing OCR lint errors are out of scope).
- Editing scope = existing annotation overlays only. No rhwp-native editing / `.hwp` write-back.

## File Structure

| File | Responsibility |
|---|---|
| `src/types/viewerDoc.ts` (create) | `ViewerDoc` / `ViewerPage` / `ViewerViewport` interfaces + `DocKind` |
| `src/utils/detectDocType.ts` (create) | Pure `detectDocType(name, bytes) → DocKind` (ext + magic bytes) |
| `src/services/hwpEngine.ts` (create) | Lazy `@rhwp/core` WASM boundary: `loadHwp(bytes) → HwpDocument` |
| `src/services/hwpDocAdapter.ts` (create) | `HwpDocument → ViewerDoc` adapter |
| `src/hooks/usePdfDocument.ts` (modify) | Detect type, branch PDF/HWP, return `{ doc: ViewerDoc, kind }` |
| `src/hooks/usePdfPage.ts` (modify) | Type `pdfDoc` as `ViewerDoc` (no logic change) |
| `src/components/viewer/PdfViewer.tsx`, `PdfPage.tsx`, `LazyPdfPage.tsx`, `SpreadView.tsx`, `GridView.tsx`, `FullscreenView.tsx` (modify) | Retype `pdfDoc`/prop to `ViewerDoc`; pass `kind` to gate the text layer |
| `src/hooks/useOcr.ts`, `usePrint.ts`, `useFitZoom.ts`, `useThumbnails.ts` (modify) | Retype `pdfDoc` to `ViewerDoc` |
| `src/services/pdfExporter.ts` (modify) | HWP branch: composite rendered canvases + annotations into a fresh PDF |
| `src/components/toolbar/ActionBar.tsx` (modify) | `accept`/drag accept `.hwp,.hwpx` |
| `src/App.tsx` (modify) | Pass `kind`; accept hwp in open/url paths |
| `electron/main.ts` (modify) | Serve `rhwp_bg.wasm` over `app://`; CSP already allows wasm |
| `src/i18n/ko.ts`, `en.ts` (modify) | `hwp.engineError`, `hwp.badge` strings |

---

## Task 1: Shared `ViewerDoc` interface

**Files:**
- Create: `src/types/viewerDoc.ts`
- Test: `src/types/viewerDoc.test.ts`

**Interfaces:**
- Produces: `DocKind = 'pdf' | 'hwp'`; `ViewerViewport = { width: number; height: number }`; `ViewerPage = { getViewport(p: { scale: number }): ViewerViewport; render(p: { canvas: HTMLCanvasElement; viewport: ViewerViewport & { scale: number } }): { promise: Promise<void> }; getTextContent(): Promise<{ items: unknown[] }> }`; `ViewerDoc = { numPages: number; getPage(n: number): Promise<ViewerPage>; destroy(): void }`.

The `pdfjs` `PDFDocumentProxy` structurally satisfies `ViewerDoc` (covariant returns: `PDFPageProxy.getViewport` returns a `PageViewport` that is assignable to `ViewerViewport`), so no cast is needed for the PDF path.

- [ ] **Step 1: Write the failing test** — proves a pdfjs-shaped object is assignable to `ViewerDoc`.

```ts
// src/types/viewerDoc.test.ts
import { describe, it, expect } from 'vitest'
import type { ViewerDoc } from './viewerDoc'

describe('ViewerDoc', () => {
  it('accepts a pdfjs-shaped object structurally', () => {
    const fake: ViewerDoc = {
      numPages: 2,
      getPage: async () => ({
        getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({ items: [] }),
      }),
      destroy: () => {},
    }
    expect(fake.numPages).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types/viewerDoc.test.ts`
Expected: FAIL — `Cannot find module './viewerDoc'`.

- [ ] **Step 3: Create the interface**

```ts
// src/types/viewerDoc.ts
/** Which engine produced the document. */
export type DocKind = 'pdf' | 'hwp'

export interface ViewerViewport { width: number; height: number }

export interface ViewerPage {
  getViewport(params: { scale: number }): ViewerViewport
  render(params: { canvas: HTMLCanvasElement; viewport: ViewerViewport & { scale: number } }): { promise: Promise<void> }
  /** Selectable text geometry. PDF returns real items; HWP returns `{ items: [] }`. */
  getTextContent(): Promise<{ items: unknown[] }>
}

/**
 * The subset of pdfjs's `PDFDocumentProxy` the app actually uses. Both the real
 * pdfjs document and the HWP adapter satisfy this, so all downstream code is
 * source-agnostic.
 */
export interface ViewerDoc {
  numPages: number
  getPage(pageNumber: number): Promise<ViewerPage>
  destroy(): void
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/types/viewerDoc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/viewerDoc.ts src/types/viewerDoc.test.ts
git commit -m "feat(hwp): shared ViewerDoc interface (pdfjs/HWP common surface)"
```

---

## Task 2: File-type detection

**Files:**
- Create: `src/utils/detectDocType.ts`
- Test: `src/utils/detectDocType.test.ts`

**Interfaces:**
- Consumes: `DocKind` from `src/types/viewerDoc.ts` — but detection also reports unknown, so it returns its own `DetectedKind = DocKind | 'hwp' | 'unknown'` collapsed to `'pdf' | 'hwp' | 'unknown'` (HWP and HWPX both map to `'hwp'`; the adapter handles either binary).
- Produces: `detectDocType(name: string, bytes: ArrayBuffer): 'pdf' | 'hwp' | 'unknown'`.

Magic bytes: PDF = `25 50 44 46` (`%PDF`); HWP binary = OLE2 `D0 CF 11 E0 A1 B1 1A E1`; HWPX = ZIP `50 4B 03 04` (`PK\x03\x04`). Extension is the tiebreaker for ZIP (only `.hwpx` zips count as HWP; other `.zip` → unknown).

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/detectDocType.test.ts
import { describe, it, expect } from 'vitest'
import { detectDocType } from './detectDocType'

const buf = (...b: number[]) => new Uint8Array(b).buffer

describe('detectDocType', () => {
  it('detects PDF by %PDF magic', () => {
    expect(detectDocType('a.pdf', buf(0x25,0x50,0x44,0x46,0x2d))).toBe('pdf')
  })
  it('detects HWP binary by OLE2 magic', () => {
    expect(detectDocType('a.hwp', buf(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1))).toBe('hwp')
  })
  it('detects HWPX by zip magic + .hwpx extension', () => {
    expect(detectDocType('a.hwpx', buf(0x50,0x4B,0x03,0x04))).toBe('hwp')
  })
  it('does not treat a plain .zip as hwp', () => {
    expect(detectDocType('a.zip', buf(0x50,0x4B,0x03,0x04))).toBe('unknown')
  })
  it('falls back to extension when bytes are short', () => {
    expect(detectDocType('a.hwp', buf(0x00))).toBe('hwp')
  })
  it('returns unknown for unrelated content', () => {
    expect(detectDocType('a.txt', buf(0x68,0x69))).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/detectDocType.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/detectDocType.ts
const OLE2 = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
const PDF  = [0x25, 0x50, 0x44, 0x46]            // %PDF
const ZIP  = [0x50, 0x4B, 0x03, 0x04]            // PK\x03\x04

function startsWith(bytes: Uint8Array, sig: number[]): boolean {
  if (bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

/** Identify a document by magic bytes, with the file extension as tiebreaker. */
export function detectDocType(name: string, bytes: ArrayBuffer): 'pdf' | 'hwp' | 'unknown' {
  const head = new Uint8Array(bytes.slice(0, 8))
  const ext = name.toLowerCase().split('.').pop() ?? ''

  if (startsWith(head, PDF) || ext === 'pdf') return 'pdf'
  if (startsWith(head, OLE2)) return 'hwp'                 // .hwp binary (OLE2)
  if (startsWith(head, ZIP) && ext === 'hwpx') return 'hwp' // .hwpx (zip)
  // Bytes too short / unreadable: trust the extension.
  if (head.length < 4 && (ext === 'hwp' || ext === 'hwpx')) return 'hwp'
  return 'unknown'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/detectDocType.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/detectDocType.ts src/utils/detectDocType.test.ts
git commit -m "feat(hwp): magic-byte document type detection"
```

---

## Task 3: rhwp WASM engine boundary

**Files:**
- Create: `src/services/hwpEngine.ts`
- Test: `src/services/hwpEngine.test.ts`
- Modify: `package.json` (add `@rhwp/core@0.7.17`)

**Interfaces:**
- Produces: `loadHwp(bytes: ArrayBuffer): Promise<HwpDocument>` where `HwpDocument` is `@rhwp/core`'s class; `__resetHwpForTests()`.
- Consumes: nothing from earlier tasks.

Mirror `src/services/ocrEngine.ts`: a module-level lazy init promise, asset URL resolved against `document.baseURI`, dev-vs-prod wasm path. The `@rhwp/core` default export is the WASM bootstrap (`init(module_or_path)`); `HwpDocument` is the parser/renderer.

- [ ] **Step 1: Install the dependency**

```bash
npm install @rhwp/core@0.7.17 --save-exact
```

Expected: `package.json` shows `"@rhwp/core": "0.7.17"`.

- [ ] **Step 2: Write the failing test** (mock `@rhwp/core`)

```ts
// src/services/hwpEngine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const initMock = vi.fn().mockResolvedValue(undefined)
class FakeHwpDocument { constructor(public data: Uint8Array) {} pageCount() { return 3 } free() {} }
vi.mock('@rhwp/core', () => ({ default: (...a: unknown[]) => initMock(...a), HwpDocument: FakeHwpDocument }))

import { loadHwp, __resetHwpForTests } from './hwpEngine'

beforeEach(() => { initMock.mockClear(); __resetHwpForTests() })

describe('hwpEngine', () => {
  it('inits the WASM once and constructs HwpDocument from bytes', async () => {
    const a = await loadHwp(new Uint8Array([1, 2, 3]).buffer)
    const b = await loadHwp(new Uint8Array([4]).buffer)
    expect(initMock).toHaveBeenCalledTimes(1)         // init runs once, reused
    expect((a as unknown as FakeHwpDocument).pageCount()).toBe(3)
    expect((b as unknown as FakeHwpDocument).data[0]).toBe(4)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/services/hwpEngine.test.ts`
Expected: FAIL — module `./hwpEngine` not found.

- [ ] **Step 4: Implement**

```ts
// src/services/hwpEngine.ts
import init, { HwpDocument } from '@rhwp/core'

let initPromise: Promise<void> | null = null

export function __resetHwpForTests() { initPromise = null }

/** Resolve the rhwp wasm URL. Prod: bundled next to the app (offline, app://);
 *  dev: Vite serves the package file from node_modules. Resolved against the
 *  document so it works under Electron file://-style app:// loads too. */
function wasmUrl(): string {
  const base = new URL('./', document.baseURI).href
  return import.meta.env.DEV
    ? new URL('@rhwp/core/rhwp_bg.wasm', import.meta.url).href
    : `${base}hwp/rhwp_bg.wasm`
}

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init(wasmUrl()).then(() => undefined).catch(err => {
      initPromise = null
      throw new Error(`HWP engine failed to load: ${err instanceof Error ? err.message : String(err)}`)
    })
  }
  return initPromise
}

/** Parse HWP/HWPX bytes into a renderable document. */
export async function loadHwp(bytes: ArrayBuffer): Promise<HwpDocument> {
  await ensureInit()
  return new HwpDocument(new Uint8Array(bytes))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/hwpEngine.test.ts`
Expected: PASS.

- [ ] **Step 6: Confirm the wasm bundling (manual)** — production must copy `rhwp_bg.wasm` to `dist/hwp/`. Add a build step in `package.json` `predev`/`build` OR a Vite plugin/`?url` import. Simplest: a tiny copy script mirroring `setup:ocr`. Decide and wire:

```bash
# scripts/copy-hwp-wasm.cjs — copies node_modules/@rhwp/core/rhwp_bg.wasm to public/hwp/
node -e "const fs=require('fs');fs.mkdirSync('public/hwp',{recursive:true});fs.copyFileSync('node_modules/@rhwp/core/rhwp_bg.wasm','public/hwp/rhwp_bg.wasm');console.log('copied rhwp wasm')"
```

Add to `package.json` scripts: `"setup:hwp": "node scripts/copy-hwp-wasm.cjs"`, and prepend it to `build` and `build:exe` (like `setup:ocr` is in CI). Gitignore `public/hwp/` (binary, regenerated). Run `npm run setup:hwp` and confirm `public/hwp/rhwp_bg.wasm` exists.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json scripts/copy-hwp-wasm.cjs src/services/hwpEngine.ts src/services/hwpEngine.test.ts .gitignore
git commit -m "feat(hwp): lazy @rhwp/core WASM engine boundary + wasm asset copy"
```

---

## Task 4: HwpDocument → ViewerDoc adapter

**Files:**
- Create: `src/services/hwpDocAdapter.ts`
- Test: `src/services/hwpDocAdapter.test.ts`

**Interfaces:**
- Consumes: `ViewerDoc`, `ViewerPage` from `src/types/viewerDoc.ts`; `HwpDocument` from `@rhwp/core`.
- Produces: `createHwpViewerDoc(doc: HwpDocument): ViewerDoc`.

Page natural size: `renderPageToCanvas(n, canvas, scale)` sizes the canvas to `page×scale`. To support `getViewport({scale})` (called before render), compute the **scale-1 natural size once per page** with a throwaway probe render at scale 1 and cache it. `render()` then calls `renderPageToCanvas(n, canvas, viewport.scale)` (which re-sizes the real canvas) and resolves synchronously.

- [ ] **Step 1: Write the failing test** (mock HwpDocument)

```ts
// src/services/hwpDocAdapter.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createHwpViewerDoc } from './hwpDocAdapter'

function fakeDoc() {
  return {
    pageCount: () => 2,
    free: vi.fn(),
    // sizes the canvas to 60x80 at scale 1 (so natural = 60x80)
    renderPageToCanvas: vi.fn((_n: number, canvas: HTMLCanvasElement, scale: number) => {
      canvas.width = 60 * scale; canvas.height = 80 * scale
    }),
  }
}

describe('hwpDocAdapter', () => {
  it('reports page count and frees the document', () => {
    const d = fakeDoc(); const v = createHwpViewerDoc(d as never)
    expect(v.numPages).toBe(2)
    v.destroy(); expect(d.free).toHaveBeenCalled()
  })

  it('getViewport returns natural size × scale', async () => {
    const d = fakeDoc(); const page = await createHwpViewerDoc(d as never).getPage(1)
    expect(page.getViewport({ scale: 1 })).toEqual({ width: 60, height: 80 })
    expect(page.getViewport({ scale: 2 })).toEqual({ width: 120, height: 160 })
  })

  it('render paints onto the given canvas at the viewport scale and resolves', async () => {
    const d = fakeDoc(); const page = await createHwpViewerDoc(d as never).getPage(1)
    const canvas = document.createElement('canvas')
    await page.render({ canvas, viewport: { width: 120, height: 160, scale: 2 } }).promise
    expect(canvas.width).toBe(120)   // 60 * 2
    // renderPageToCanvas called with page index 0 (0-based) at scale 2 for the real render
    expect(d.renderPageToCanvas).toHaveBeenLastCalledWith(0, canvas, 2)
  })

  it('getTextContent is empty (OCR provides text for HWP)', async () => {
    const page = await createHwpViewerDoc(fakeDoc() as never).getPage(1)
    expect(await page.getTextContent()).toEqual({ items: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/hwpDocAdapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/services/hwpDocAdapter.ts
import type { HwpDocument } from '@rhwp/core'
import type { ViewerDoc, ViewerPage, ViewerViewport } from '../types/viewerDoc'

/**
 * Adapt rhwp's HwpDocument to the pdfjs-shaped ViewerDoc the app consumes.
 * rhwp pages are 0-based; pdfjs/the app are 1-based — translate at the boundary.
 */
export function createHwpViewerDoc(doc: HwpDocument): ViewerDoc {
  const naturalCache = new Map<number, ViewerViewport>()

  /** Scale-1 page size, measured once via a throwaway probe render and cached. */
  function natural(idx0: number): ViewerViewport {
    const hit = naturalCache.get(idx0)
    if (hit) return hit
    const probe = document.createElement('canvas')
    doc.renderPageToCanvas(idx0, probe, 1)           // sizes probe to page×1
    const vp = { width: probe.width, height: probe.height }
    probe.width = 0; probe.height = 0                // release
    naturalCache.set(idx0, vp)
    return vp
  }

  return {
    numPages: doc.pageCount(),
    destroy: () => doc.free(),
    getPage: async (pageNumber: number): Promise<ViewerPage> => {
      const idx0 = pageNumber - 1
      return {
        getViewport: ({ scale }) => {
          const n = natural(idx0)
          return { width: n.width * scale, height: n.height * scale }
        },
        render: ({ canvas, viewport }) => {
          // renderPageToCanvas sizes the canvas to page×scale and paints (sync).
          doc.renderPageToCanvas(idx0, canvas, viewport.scale)
          return { promise: Promise.resolve() }
        },
        getTextContent: async () => ({ items: [] }),
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/hwpDocAdapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/hwpDocAdapter.ts src/services/hwpDocAdapter.test.ts
git commit -m "feat(hwp): HwpDocument → ViewerDoc adapter"
```

---

## Task 5: usePdfDocument — detect & branch

**Files:**
- Modify: `src/hooks/usePdfDocument.ts`
- Test: `src/hooks/usePdfDocument.test.ts`

**Interfaces:**
- Consumes: `detectDocType` (Task 2), `loadHwp` (Task 3), `createHwpViewerDoc` (Task 4), `ViewerDoc`/`DocKind` (Task 1).
- Produces: `usePdfDocument(file) → { pdfDoc: ViewerDoc | null; numPages: number; isLoading: boolean; error: string | null; kind: DocKind }`.

- [ ] **Step 1: Write the failing test** (mock pdfjs + hwp services)

```ts
// src/hooks/usePdfDocument.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('pdfjs-dist', () => ({
  getDocument: () => ({ promise: Promise.resolve({ numPages: 5, getPage: vi.fn(), destroy: vi.fn() }) }),
}))
const loadHwp = vi.fn().mockResolvedValue({ pageCount: () => 7, free: vi.fn(), renderPageToCanvas: vi.fn() })
vi.mock('../services/hwpEngine', () => ({ loadHwp: (...a: unknown[]) => loadHwp(...a) }))

import { usePdfDocument } from './usePdfDocument'

function file(name: string, bytes: number[]) {
  const f = new File([new Uint8Array(bytes)], name)
  // jsdom File.arrayBuffer is present; ensure it resolves our bytes
  return f
}

beforeEach(() => loadHwp.mockClear())

describe('usePdfDocument', () => {
  it('loads a PDF via pdfjs and reports kind=pdf', async () => {
    const { result } = renderHook(() => usePdfDocument(file('a.pdf', [0x25,0x50,0x44,0x46])))
    await waitFor(() => expect(result.current.numPages).toBe(5))
    expect(result.current.kind).toBe('pdf')
  })
  it('loads an HWP via the adapter and reports kind=hwp', async () => {
    const { result } = renderHook(() => usePdfDocument(file('a.hwp', [0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1])))
    await waitFor(() => expect(result.current.numPages).toBe(7))
    expect(result.current.kind).toBe('hwp')
    expect(loadHwp).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/usePdfDocument.test.ts`
Expected: FAIL — `kind` undefined / hwp branch missing.

- [ ] **Step 3: Implement** (replace the file)

```ts
// src/hooks/usePdfDocument.ts
import { useState, useEffect } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { ViewerDoc, DocKind } from '../types/viewerDoc'
import { detectDocType } from '../utils/detectDocType'

interface UsePdfDocumentReturn {
  pdfDoc: ViewerDoc | null
  numPages: number
  isLoading: boolean
  error: string | null
  kind: DocKind
}

export function usePdfDocument(file: File | null): UsePdfDocumentReturn {
  const [pdfDoc, setPdfDoc] = useState<ViewerDoc | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<DocKind>('pdf')

  useEffect(() => {
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPdfDoc(null); setNumPages(0); setError(null)
      return
    }
    let cancelled = false
    setIsLoading(true); setError(null)

    file.arrayBuffer().then(async (buffer): Promise<{ doc: ViewerDoc; kind: DocKind }> => {
      const type = detectDocType(file.name, buffer)
      if (type === 'hwp') {
        const { loadHwp } = await import('../services/hwpEngine')
        const { createHwpViewerDoc } = await import('../services/hwpDocAdapter')
        return { doc: createHwpViewerDoc(await loadHwp(buffer)), kind: 'hwp' }
      }
      // PDF (or unknown → try pdfjs, which errors clearly on non-PDF)
      const doc = await pdfjs.getDocument({ data: buffer, disableFontFace: true }).promise
      return { doc: doc as unknown as ViewerDoc, kind: 'pdf' }
    })
      .then(({ doc, kind }) => {
        if (cancelled) { doc.destroy(); return }
        setPdfDoc(doc); setNumPages(doc.numPages); setKind(kind); setIsLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load document')
        setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [file])

  return { pdfDoc, numPages, isLoading, error, kind }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/usePdfDocument.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePdfDocument.ts src/hooks/usePdfDocument.test.ts
git commit -m "feat(hwp): usePdfDocument detects type and branches PDF/HWP"
```

---

## Task 6: Thread `ViewerDoc` type + gate the text layer

**Files:**
- Modify: `src/hooks/usePdfPage.ts`, `useOcr.ts`, `usePrint.ts`, `useFitZoom.ts`, `useThumbnails.ts`, `src/components/viewer/PdfViewer.tsx`, `PdfPage.tsx`, `LazyPdfPage.tsx`, `SpreadView.tsx`, `GridView.tsx`, `FullscreenView.tsx`, `src/App.tsx`
- Test: existing suite (no new test; this is a type/wiring change verified by typecheck + green tests)

**Interfaces:**
- Consumes: `ViewerDoc`, `DocKind` (Task 1); `kind` from `usePdfDocument` (Task 5).
- Produces: a `kind` prop flowing to `PdfPage`; `PdfTextLayer` rendered only when `kind === 'pdf'`.

- [ ] **Step 1: Retype `pdfDoc`** — in each file above, replace the import/type `PDFDocumentProxy` with `ViewerDoc` from `../types/viewerDoc` (adjust relative path). These usages only call `.numPages` and `.getPage(n).getViewport/render/getTextContent`, all in `ViewerDoc`.

Example (`src/hooks/usePdfPage.ts`):

```ts
// before: import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ViewerDoc } from '../types/viewerDoc'
// replace every `PDFDocumentProxy` with `ViewerDoc` (cache WeakMap key type included)
```

- [ ] **Step 2: Thread `kind` to gate the text layer** — `App.tsx` passes `kind` from `usePdfDocument` down through `PdfViewer` → `PdfPage`. In `PdfPage.tsx`, render `<PdfTextLayer>` only for PDF:

```tsx
// PdfPage.tsx — the text-overlay block becomes:
{kind === 'pdf' && (activeMode === null || activeMode === 'select' || (searchHighlights && searchHighlights.length > 0)) && (
  <PdfTextLayer pdfDoc={pdfDoc} pageNumber={pageNumber} scale={effectiveZoom} rotation={rotation}
    width={stageWidth} height={stageHeight} highlights={searchHighlights}
    onEditCommit={appMode === 'editor' ? commitTextEdit : undefined} />
)}
```

Add `kind: DocKind` to `PdfPageProps`, `PdfViewerProps`, and the lazy/spread/grid/fullscreen page wrappers, defaulting nothing (always passed from App).

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npx tsc -b --noEmit && npm run test:run`
Expected: typecheck clean; all existing tests PASS (behavior unchanged for PDF). `PdfTextLayer` still imports pdfjs to read text — that is fine; it only renders for `kind==='pdf'`, and its own `pdfDoc` use can keep a local pdfjs cast since it is PDF-only (annotate with `pdfDoc as unknown as PDFDocumentProxy` inside `PdfTextLayer`, or keep its prop typed `ViewerDoc` and cast at the `getTextContent` call site).

- [ ] **Step 4: Commit**

```bash
git add src/hooks src/components/viewer src/App.tsx
git commit -m "feat(hwp): thread ViewerDoc type through viewer; gate text layer to PDF"
```

---

## Task 7: PDF export for HWP (composite canvases)

**Files:**
- Modify: `src/services/pdfExporter.ts`
- Test: `src/services/pdfExporter.hwp.test.ts`

**Interfaces:**
- Consumes: `ViewerDoc` (Task 1); the existing per-page canvas render helper `getOrRenderPage` (from `usePdfPage`); `pdf-lib`.
- Produces: the existing exporter's entry gains a `kind` param; for `kind==='hwp'` it builds the PDF from rendered page canvases + annotations instead of editing original bytes.

The current PDF export edits the *original PDF bytes* with pdf-lib. HWP bytes are not a PDF, so for HWP build a fresh pdf-lib document: for each page, render the page canvas (via `getOrRenderPage`) + composite annotations (reuse the print pipeline's `renderPageWithAnnotations` logic), embed the JPEG into a pdf-lib page sized to the canvas. This is also the HWP→PDF converter.

- [ ] **Step 1: Write the failing test** (mock pdf-lib + a 1-page ViewerDoc)

```ts
// src/services/pdfExporter.hwp.test.ts
import { describe, it, expect, vi } from 'vitest'

const addPage = vi.fn(() => ({ drawImage: vi.fn() }))
const embedJpg = vi.fn(async () => ({ width: 100, height: 200 }))
vi.mock('pdf-lib', () => ({
  PDFDocument: { create: async () => ({ addPage, embedJpg, save: async () => new Uint8Array([1]) }) },
}))
vi.mock('../hooks/usePdfPage', () => ({
  getOrRenderPage: async () => ({
    canvas: Object.assign(document.createElement('canvas'), { width: 100, height: 200, toDataURL: () => 'data:image/jpeg;base64,AA' }),
    renderScale: 1,
  }),
}))

import { exportHwpToPdf } from './pdfExporter'

describe('exportHwpToPdf', () => {
  it('builds a pdf-lib page per HWP page from rendered canvases', async () => {
    const doc = { numPages: 2, getPage: vi.fn(), destroy: vi.fn() }
    const bytes = await exportHwpToPdf(doc as never, [])
    expect(addPage).toHaveBeenCalledTimes(2)
    expect(bytes).toBeInstanceOf(Uint8Array)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/pdfExporter.hwp.test.ts`
Expected: FAIL — `exportHwpToPdf` not exported.

- [ ] **Step 3: Implement** — add `exportHwpToPdf(doc: ViewerDoc, annotations: Annotation[]): Promise<Uint8Array>` to `pdfExporter.ts` that loops pages, renders+composites each (reuse the annotation-drawing already used by the print path — extract a shared `compositePageCanvas` if needed), embeds JPEG into a sized pdf-lib page, returns `save()`. Then route the exporter entry: when the caller passes `kind==='hwp'`, use `exportHwpToPdf`; else the existing path. (Wire the `kind` through `useExporters`/App where `handleExportPdf` is called.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/pdfExporter.hwp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/pdfExporter.ts src/services/pdfExporter.hwp.test.ts src/hooks/useExporters.ts src/App.tsx
git commit -m "feat(hwp): export HWP to PDF by compositing rendered pages + annotations"
```

---

## Task 8: UI accept + i18n + Electron wasm serving

**Files:**
- Modify: `src/components/toolbar/ActionBar.tsx` (file `accept`, drag-drop filter), `src/App.tsx` (loadPdfFile accepts hwp; error string), `src/i18n/ko.ts`, `src/i18n/en.ts`, `electron/main.ts`
- Test: existing suite

**Interfaces:**
- Consumes: `kind` (Task 5); `detectDocType` (Task 2) if needed for drag-drop.
- Produces: user-facing acceptance of `.hwp`/`.hwpx`.

- [ ] **Step 1: Accept the extensions** — in `ActionBar.tsx` change the hidden input `accept="application/pdf,.pdf"` → `accept="application/pdf,.pdf,.hwp,.hwpx"`, and the drag-drop `handleDrop` filter (currently `file?.type === 'application/pdf'`) to also accept names ending in `.hwp`/`.hwpx` (HWP files often have empty `file.type`). Update the empty-state copy `empty.desktop`/`empty.mobile` wording to "PDF · HWP".

- [ ] **Step 2: i18n strings** — add to `ko.ts` and `en.ts`:

```ts
// ko.ts
'hwp.engineError': 'HWP 엔진 로드 실패',
'hwp.badge': 'HWP',
// en.ts
'hwp.engineError': 'HWP engine failed to load',
'hwp.badge': 'HWP',
```

- [ ] **Step 3: Electron — serve the wasm** — `electron/main.ts` `serveAppProtocol` already serves `dist/` over `app://`; `dist/hwp/rhwp_bg.wasm` is included by Task 3's copy step, so it serves automatically. Verify the production CSP `script-src`/`connect-src` already cover wasm (the OCR work added `wasm-unsafe-eval`, `blob:`, `data:`); no change expected. If `@rhwp/core` fetches the wasm via `connect-src`, confirm `'self'` covers `app://`.

- [ ] **Step 4: Verify lazy chunking** — `npm run build`, then confirm `@rhwp/core` is in a lazy chunk, NOT the entry:

```bash
npm run build && grep -l "rhwp" dist/assets/*.js | head && echo "check: entry (index-*/app-*.js) must NOT statically import rhwp"
```

Expected: rhwp appears only in a dynamically-imported chunk (loaded via `import('../services/hwpEngine')` in Task 5). If it leaked into the entry, add it to a manual lazy boundary (do NOT add to `manualChunks` — see vite.config note).

- [ ] **Step 5: Run full suite + build**

Run: `npm run test:run && npx tsc -b --noEmit && npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/components/toolbar/ActionBar.tsx src/App.tsx src/i18n electron/main.ts
git commit -m "feat(hwp): accept .hwp/.hwpx in UI; i18n; verify wasm serving + lazy chunk"
```

---

## Task 9: Integration verification + docs

**Files:**
- Modify: `CLAUDE.md` (document the HWP pipeline), `README.md` (mention HWP support)
- Test: manual with real files

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Manual integration** — obtain a representative `.hwp` and `.hwpx` (e.g., the kicox `제안요청서_*.hwpx`). Run `npm run dev`, open each, and verify: pages render, scroll/zoom/rotate, fullscreen present, add a stamp/signature/pen, run OCR (text recognized), Ctrl+F search on OCR text, print preview, **Export → PDF** produces a valid PDF. Record any rhwp render-fidelity gaps (v0.7.x).

- [ ] **Step 2: Document** — add an "HWP/HWPX viewing" subsection to `CLAUDE.md` (Architecture): rhwp `@rhwp/core` WASM → `hwpDocAdapter` → `ViewerDoc` → existing pipeline; text via OCR; PDF export composites canvases; wasm copied to `public/hwp/` (gitignored) via `setup:hwp`; lazy-loaded. Add one line to `README.md` feature list.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs(hwp): document HWP/HWPX viewer pipeline"
```

- [ ] **Step 4: Final gate** — `npm run lint && npm run test:run && npm run build` all green; lint shows no NEW errors beyond the 7 pre-existing.

---

## Self-Review Notes

- **Spec coverage:** engine boundary (T3), adapter (T4), detection (T2), loader branch (T5), text-layer-via-OCR (T6), PDF export path (T7), UI/Electron/wasm (T8), risks→manual fidelity check (T9). All spec sections mapped.
- **Open item resolution:** page-dimensions uncertainty resolved via the scale-1 probe in T4 (no reliance on undocumented `getPageInfo` fields). wasm bundling resolved via the `setup:hwp` copy step in T3. Lazy-chunk safety verified in T8.
- **Type consistency:** `ViewerDoc`/`ViewerPage`/`ViewerViewport` (T1) used identically in T4/T5/T6; `DocKind` from T1 used in T5/T6/T8; `createHwpViewerDoc` (T4) consumed in T5; `loadHwp` (T3) consumed in T5; `detectDocType` (T2) consumed in T5/T8; `exportHwpToPdf` (T7) consumed in App/useExporters.
