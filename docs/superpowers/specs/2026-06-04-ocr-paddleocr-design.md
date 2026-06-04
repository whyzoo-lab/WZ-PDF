# OCR (PaddleOCR) — Design

**Date:** 2026-06-04
**Status:** Approved (brainstorming complete)
**Scope:** OCR only. Translation is explicitly out of scope and will be provided separately.

## 1. Goal

Add optical character recognition so that **scanned / image-only PDFs become
selectable and searchable**. When pdfjs yields no text layer for a page (because
the page is a raster image), the user can run PaddleOCR to produce a transparent,
positioned text layer that supports drag-selection, copy, and Ctrl+F search.

### Phasing of the user-facing result
- **v1 (this spec):** on-screen selectable + searchable text layer.
- **v2 (future, separate spec):** export a *searchable PDF* (invisible OCR text
  layer baked into the file via pdf-lib).

## 2. Engine choice

**`@paddleocr/paddleocr-js`** — the official PaddleOCR browser SDK.

- Runs the full **det → cls → rec** pipeline (we don't implement post-processing).
- Built on onnxruntime-web (WASM/WebGPU) + OpenCV.js.
- `predict()` accepts an `HTMLCanvasElement` directly — we feed the page render canvas.
- `worker: true` offloads inference to a dedicated thread (UI stays responsive).
- Works in the Electron renderer (Chromium) and the web build with the same code.
- Returns `{ boxes (4-point px coords), text, score, timing }`.

### Models (bundled, offline)
- Detection: `PP-OCRv5_mobile_det` (Korean/English shared)
- Recognition: `korean_PP-OCRv5_mobile_rec` (Korean + English; dict inside `inference.yml`)
- Packaged as uncompressed ustar `.tar` (each contains `inference.onnx` + `inference.yml`).
- Bundled under `public/ocr/` so OCR works offline with no download.

### Licensing (verified)
| Component | License | Commercial bundle |
|---|---|---|
| PaddleOCR toolkit, PP-OCRv5 det/rec, `@paddleocr/paddleocr-js` | Apache 2.0 | OK |
| OpenCV.js (4.5+), Transformers.js | Apache 2.0 | OK |
| onnxruntime-web | MIT | OK |

Obligation: ship `LICENSE` + `NOTICE` (Apache) and a `THIRD-PARTY-NOTICES.md`
aggregating attributions. No copyleft, no source-disclosure requirement.

## 3. Architecture & module boundaries

```
public/ocr/
├── models/
│   ├── PP-OCRv5_mobile_det.tar
│   └── korean_PP-OCRv5_mobile_rec.tar
├── wasm/        (onnxruntime-web .wasm)
└── opencv/      (opencv.js)

src/services/ocrEngine.ts          PaddleOCR singleton wrapper (lazy init,
                                   worker:true). Encapsulates create()/predict().
                                   Knows nothing about PDF or coordinates.
src/hooks/useOcr.ts                Owns OCR state (Map<page, OcrPageResult>),
                                   does coordinate conversion (canvas px -> PDF pt),
                                   progress, cancel, error isolation.
src/components/viewer/OcrTextLayer.tsx  Renders OCR words as transparent,
                                   absolutely-positioned spans (same contract as
                                   PdfTextLayer). Selection/copy capable.
```

**Responsibility split**

| Module | Does | Depends on | Tested by |
|---|---|---|---|
| `ocrEngine.ts` | SDK init once, `predict(canvas)` -> raw boxes. Pure I/O boundary. | `@paddleocr/paddleocr-js` | mocked SDK: init/predict, worker fallback, load failure |
| `useOcr.ts` | per-page cache, progress, coordinate transform | `ocrEngine`, page render canvas | pure transform unit tests + hook tests |
| `OcrTextLayer` | render boxes as spans | `useOcr` results | RTL render test |
| `useSearch` (existing) | include OCR text in search | `useOcr` results | existing + OCR-source case |

**Key principle:** `ocrEngine` is the only module that imports the SDK. Coordinate
conversion lives in `useOcr`. Swapping the OCR engine later touches only `ocrEngine`.

## 4. Data flow & state

```
User clicks 'OCR' -> choose [current page] or [whole document]
  -> useOcr.runPage(n)
     -> get page canvas from usePdfPage cache (render at PDF_RENDER_SCALE if absent)
     -> ocrEngine.predict(canvas)   (PaddleOCR.js, worker)
     -> raw: [{ box:[4 px points], text, score }]
     -> useOcr: convert px / PDF_RENDER_SCALE -> PDF points; cache per page
     -> ocrResults: Map<page, OcrPageResult>
        ├─ OcrTextLayer renders transparent spans (select/copy)
        └─ useSearch includes OCR text (Ctrl+F)
```

### Types
```typescript
interface OcrWord {
  text: string
  score: number
  // PDF points (multiply by effectiveZoom for screen) — unified with annotation coords
  x: number; y: number; width: number; height: number
  rotation: number   // box angle from det (usually 0)
}

interface OcrPageResult {
  page: number
  words: OcrWord[]
  status: 'done' | 'error'
  durationMs: number
}
```

### State (owned by `useOcr`)
| State | Meaning |
|---|---|
| `ocrResults: Map<number, OcrPageResult>` | per-page result cache (prevents re-inference) |
| `ocrProgress: { done; total } \| null` | whole-document progress (UI gating) |
| `isOcrReady: boolean` | engine/model load complete (lazy init on first call) |
| `ocrError: string \| null` | load/inference failure message |

### App.tsx wiring
- Add `useOcr()`; pass `onRunOcr` / `onRunOcrAll` to `ActionBar`.
- Thread `ocrResults` through `PdfViewer -> LazyPdfPage -> OcrTextLayer`
  (mirrors the existing `searchHighlights` path).
- Feed OCR text into `useSearch` when a page's pdfjs text is empty.

### Coordinate consistency (CLAUDE.md invariant)
- OCR runs on the `PDF_RENDER_SCALE` (1.5x) canvas; divide result px by
  `PDF_RENDER_SCALE` to get PDF points.
- On-screen placement reuses `toScreenCoords(x, y, effectiveZoom)` so zoom/rotation
  stay automatically consistent.

## 5. Error handling & edge cases

### Errors
| Situation | Handling |
|---|---|
| Model/WASM load failure | set `ocrError` -> Toast "OCR engine load failed", restore button; app does not crash |
| `predict()` throws | mark that page `status:'error'`, continue remaining pages (one failure ≠ whole-doc abort) |
| Worker unsupported | fall back to `worker:false` (main thread; brief UI jank) |
| Empty result (no glyphs) | `words:[]`, `status:'done'`; Toast "no text recognized" |

### Edge cases
| Case | Behaviour |
|---|---|
| PDF already has a text layer | OCR button always enabled; pdfjs text takes priority — OCR words shown only on pages whose pdfjs text is empty (avoid duplicates) |
| Rotated page (90/180/270) | OCR runs on pre-rotation source canvas; stored coords rotation-independent; display reuses existing rotation transform |
| Re-OCR an already-done page | cache hit -> instant return, no re-inference. Explicit "re-run" is v2 |
| After page CRUD (insert/delete/reorder) | remap `ocrResults` via the page mapping (like `remapAnnotations`), or invalidate affected page caches |
| OCR running during other ops | `isOcrRunning` gates conflicting ops (mirrors `isExporting` / `isPageOperating`) |
| Large doc whole-doc OCR (100+ pages) | sequential + progress + **cancel button** (AbortSignal); release canvases immediately to bound memory |
| OCR result vs export | v1: OCR text is screen/search-only, **not** included in PDF export; searchable-PDF export is v2 |

### Memory
- High-res OCR canvas released right after inference (`canvas.width = 0`),
  same strategy as the print pipeline.
- `ocrResults` stores only text + coords (light); no images retained.

### Persistence / volatility
- OCR results are **not** volatile like pen/rectangle: they persist for the session
  but are **not** written to the file (v1). Unaffected by ESC / Reset markup.

## 6. Testing strategy

| Target | Type | Key cases |
|---|---|---|
| `ocrEngine.ts` | unit (mock SDK) | init called once, predict passes canvas, worker fallback, load failure throws |
| coordinate transform (pure fn in useOcr) | unit (TDD first) | px / PDF_RENDER_SCALE -> PDF pt; 4-point box -> x/y/w/h |
| `useOcr` hook | unit (renderHook) | cache hit (no re-infer), one-page failure isolation, progress, cancel (Abort) |
| `OcrTextLayer` | RTL render | words -> span count/position; empty result |
| `useSearch` integration | unit | OCR text joins search source; pdfjs-text-priority rule |
| `ActionBar` | RTL | OCR button/dropdown (current/all), disabled while running, i18n labels |

## 7. Implementation phases

```
Phase 0  PoC spike (half day)
  Install @paddleocr/paddleocr-js, predict a Korean sample page, eyeball
  accuracy/speed. Validate model tar / wasm bundle path + worker behaviour.

Phase 1  Engine boundary — ocrEngine.ts (TDD)
  SDK wrapper, model bundle (public/ocr/), lazy init, predict(canvas).

Phase 2  State & coords — useOcr.ts (TDD)
  Pure coordinate transform first -> Map cache, progress, cancel, error isolation.

Phase 3  Display — OcrTextLayer (reuse PdfTextLayer pattern)
  Transparent spans, pdfjs-text-priority rule.

Phase 4  UI wiring — ActionBar OCR button + App.tsx
  Current/all dropdown, progress Toast, op gating.

Phase 5  Search integration — join OCR source into useSearch
  Ctrl+F searches OCR text.

Phase 6  Finish — i18n (ko/en), THIRD-PARTY-NOTICES.md, memory-release verification
```

### i18n keys
`ocr.run`, `ocr.runCurrent`, `ocr.runAll`, `ocr.progress`, `ocr.noText`,
`ocr.engineError`, `ocr.cancel`

### Bundle impact
PaddleOCR SDK + WASM + OpenCV.js + model tars (~13 MB) increase build size.
Add a `paddleocr` manual chunk in `vite.config.ts` and lazy-load on first OCR
click so initial paint is unaffected.

## 8. Out of scope (this spec)
- Translation (any engine) — separate feature, separate spec.
- Searchable-PDF export of OCR text — v2.
- Explicit per-page "re-run OCR" — v2.
- Languages beyond Korean + English — add model packages later.
