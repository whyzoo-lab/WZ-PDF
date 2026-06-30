# HWP / HWPX Viewer Integration — Design Spec

**Date:** 2026-06-30
**Status:** Approved (brainstorming) → ready for implementation plan
**Author:** WZ PDF team (with Claude)

## Goal

Add **HWP and HWPX** (Korean Hangul word-processor documents) viewing to WZ PDF,
**reusing the existing viewer UI and editing tools unchanged**. An HWP/HWPX file
opens and behaves exactly like a PDF: paginated canvas rendering, scroll/zoom,
rotation, fullscreen presentation, our annotation tools (stamp, signature,
watermark, pen, rectangle, text-edit overlay), OCR, search, print, and export.

Editing scope is limited to **our current annotation/overlay capabilities** —
we do NOT perform rhwp-native HWP editing (no text reflow edits, no `.hwp`
write-back) in this iteration.

## Scope

**In scope**
- Open `.hwp` (binary OLE2) and `.hwpx` (OOXML/zip) files.
- Render pages to canvas via rhwp `@rhwp/core` (WASM), fed into the existing
  page pipeline (`usePdfPage`'s scale-aware render → Konva stage).
- All existing downstream features work on HWP pages: annotations, OCR, search
  (via OCR), print, export to images, and export to **PDF** (new compositing path).
- Web build + Electron desktop build.

**Out of scope (this iteration)**
- rhwp-native document editing (text insert/format, table ops) and `.hwp`/`.hwpx`
  write-back. (`@rhwp/core` supports it, but it is pre-1.0/unstable.)
- Selectable native text layer for HWP (OCR provides text instead).
- DOC/DOCX, PPT/PPTX, XLS/XLSX viewing — see Appendix A (feasibility review).

## Background / grounding

`@rhwp/core` (npm, v0.7.x, MIT; local source mirror at
`D:\Workspace\HwpEditor\rhwp`, wasm-pack `pkg/`) exposes exactly what we need:

```ts
import init, { HwpDocument } from '@rhwp/core'
await init(wasmUrl)                       // async WASM bootstrap, once
const doc = new HwpDocument(bytes)        // sync construct from Uint8Array
doc.pageCount()                           // number
doc.renderPageToCanvas(pageNum, canvas, scale)  // sizes canvas to page×scale, then paints
doc.getPageInfo(pageNum)                  // JSON incl. page dimensions (for layout, if needed)
```

`renderPageToCanvas` **auto-sizes the canvas** to `page size × scale`, which maps
directly onto WZ PDF's existing scale-aware rasterization (`usePdfPage.renderPage`).

WZ PDF's current pipeline is `bytes → pdfjs → canvas → Konva`. HWP slots in as a
parallel source: `bytes → rhwp HwpDocument → canvas → Konva`. Everything after the
canvas is already source-agnostic.

## Architecture — Approach A: pdfjs-shaped document adapter

Chosen over (B) a full `DocSource` abstraction replacing `PDFDocumentProxy`
across ~15 files (cleaner long-term but high-risk surgery) and (C) a separate HWP
viewer mode (no reuse, violates "identical UI"). Approach A is the least-invasive
way to satisfy "same UI + current editing".

The app already centralizes on a pdfjs-shaped `pdfDoc` object. We introduce an
adapter so an HWP document presents the **subset of the pdfjs API the app
actually uses**, letting all downstream code stay unchanged.

### Components

**1. `src/services/hwpEngine.ts` — rhwp WASM boundary**
- Lazy-loads `@rhwp/core` and runs `init()` once (mirrors `ocrEngine.ts`).
- `loadHwp(bytes: ArrayBuffer): Promise<HwpDocument>`.
- WASM asset resolution mirrors OCR: dev loads from the package/CDN; production
  serves the bundled `rhwp_bg.wasm` next to the app (via `app://` in Electron).
  Resolve the asset URL against `document.baseURI` (same fix as OCR asset paths).
- Must stay a **dynamically-imported chunk** — never hoisted into the entry
  static graph (the OCR blank-screen lesson: opencv/ort `new Function` under the
  packaged CSP). Verify the build keeps rhwp inside the lazy chunk.

**2. `src/services/hwpDocAdapter.ts` — HwpDocument → PdfDocLike**
- Define a minimal `PdfDocLike` type = the surface the app uses:
  `{ numPages: number; getPage(n): Promise<PdfPageLike>; destroy(): void }`,
  `PdfPageLike = { getViewport({scale}): {width,height}; render({canvas,viewport}): {promise: Promise<void>}; getTextContent(): Promise<{items: []}> }`.
- HWP adapter:
  - `numPages = doc.pageCount()`.
  - `getPage(n)`: `getViewport({scale})` returns `{width: pageW1*scale, height: pageH1*scale}` where `pageW1/H1` is the natural (scale-1) page size from `getPageInfo` (or derived from a scale-1 render probe, cached). `render({canvas, viewport})` calls `doc.renderPageToCanvas(n, canvas, viewport.scale)` and resolves its `promise`.
  - `getTextContent()` returns `{items: []}` (no native text layer; OCR covers text).
  - `destroy()` calls `doc.free()`.
- Note: PDF rotation is handled by WZ PDF via CSS transform, not pdfjs viewport
  rotation, so the adapter's viewport only needs `width`/`height` (+ `scale`).

**3. Loader detection — `usePdfDocument` (+ App open paths)**
- Detect type from extension (`.hwp` / `.hwpx`) AND magic bytes:
  OLE2 = `D0 CF 11 E0 A1 B1 1A E1` (.hwp), ZIP = `50 4B 03 04` (.hwpx) with an
  `mimetype` of `application/hwp+zip` (distinguishes from other zips when needed).
- PDF → existing pdfjs path. HWP → `hwpDocAdapter`. Both yield a `PdfDocLike`
  consumed identically downstream. `usePdfDocument` returns the same shape + a
  `kind: 'pdf' | 'hwp'` flag for the few branch points (text layer, PDF export).

**4. Text layer / search**
- `PdfTextLayer` is rendered only when `kind === 'pdf'` (HWP `getTextContent` is
  empty). For HWP, text selection/search is provided by the **existing OCR**
  feature, which already operates on the rendered canvas — no new code needed.

**5. Export**
- Image export, print, and annotation compositing already work from canvases →
  unchanged for HWP.
- **PDF export** currently edits the *original bytes* with pdf-lib; HWP bytes are
  not a PDF. Add a branch: when `kind === 'hwp'`, build the PDF by compositing the
  rendered page canvases + annotations into a fresh pdf-lib document (same
  technique as the print pipeline). This doubles as an **HWP→PDF converter**.

**6. UI**
- File `<input accept>` and drag-drop accept `.hwp,.hwpx`. Open-from-URL accepts
  them too. Viewer, toolbar, panel, annotations are all unchanged.
- Optional: a small file-type badge ("HWP") in the empty-state/title — cosmetic.

**7. Electron / packaging**
- Serve `rhwp_bg.wasm` like the OCR wasm (bundled, `app://`, offline). Add to the
  CSP allowances already present for OCR (`wasm-unsafe-eval`, blob:/data:).
- Lazy-load so the initial chunk and startup CSP are unaffected.

## Data flow

```
file (.hwp/.hwpx)
  → detect kind (ext + magic bytes)
  → hwpEngine.loadHwp(bytes) → HwpDocument (WASM)
  → hwpDocAdapter → PdfDocLike { numPages, getPage }
  → usePdfDocument returns { doc: PdfDocLike, numPages, kind:'hwp' }
  → usePdfPage.renderPage(doc, page, scale)
        → page.render({canvas, viewport{scale}}) → renderPageToCanvas(...)
        → canvas (page bitmap)
  → Konva stage + AnnotationLayer (unchanged)
  → OCR / print / export consume the same canvases
```

## Error handling
- WASM init / load failure → surface via the existing non-blocking toast +
  inline error (the same path added for URL loads), localized (`hwp.engineError`).
- Corrupt/unsupported HWP → catch in `loadHwp`, show a clear message, keep the app
  responsive (no blocking `alert`).
- Per-page render failure → render the page as a blank/skeleton with an inline
  notice; do not abort the whole document (mirror OCR per-page isolation).
- Large documents → parsing builds the whole `HwpDocument` up front; show the
  existing loading state. Flag perf for very large files; consider a size guard.

## Testing
- Unit: `hwpDocAdapter` shape conformance (numPages, getViewport math,
  render resolves, getTextContent empty) with a mocked `HwpDocument`.
- Unit: magic-byte/extension detection (`.hwp` OLE2, `.hwpx` zip, PDF, unknown).
- Unit: PDF-export-from-canvases path produces a valid pdf-lib document for the
  HWP branch (mock canvases/annotations).
- Manual/integration: open representative `.hwp` and `.hwpx` (incl. tables,
  images, multi-section) and verify render, zoom, annotate, OCR, print,
  export-to-PDF. rhwp is v0.7.x → record fidelity gaps.

## Risks / open items
- **rhwp v0.7.x render fidelity** on complex documents — communicate "beta".
- **WASM size** (several MB) — lazy-load; measure initial vs lazy chunk.
- **Parse cost** for large HWP — measure; add a size guard if needed.
- **Page dimensions for `getViewport`** — confirm `getPageInfo` JSON fields vs a
  scale-1 render probe during implementation; cache per page.
- **Package**: pin `@rhwp/core@0.7.x`; the local `pkg/` (named `rhwp`) is a
  reference mirror. Confirm the published package's `init`/`HwpDocument` exports
  match the local `.d.ts`.
- **wasm asset pipeline**: decide bundling (copy `rhwp_bg.wasm` into `public/hwp/`
  via a setup step, gitignored like OCR assets, or import via Vite `?url`).

## Appendix A — Office formats feasibility (reviewed, deferred)

WZ PDF's fixed-page-canvas + Konva-overlay model fits HWP/PDF; Office formats fit
poorly and are deferred:
- **DOCX** — `docx-preview` renders to HTML (reflowable); a read-only HTML view is
  possible but outside the annotation/canvas pipeline. △
- **XLSX** — `SheetJS` → HTML table; not page-based. △
- **PPTX** — `pptxjs`/`pptx-preview` → HTML/SVG slides; slides could map to pages,
  fidelity varies. △
- **Legacy .doc/.ppt/.xls (OLE2 binary)** — no practical pure-client renderer;
  needs server/LibreOffice → conflicts with the no-upload privacy model. ✗
- **LibreOffice WASM** — hundreds of MB; impractical to bundle. ✗

Recommendation: revisit Office as a separate, read-only HTML viewer track (its own
spec) if/when demanded; do not fold into this canvas-pipeline work.
