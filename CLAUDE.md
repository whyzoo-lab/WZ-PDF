# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Compile Electron main (tsc) + start Vite dev server + launch Electron
npm run dev:vite     # Vite only (web browser, no Electron)
npm test             # Vitest in watch mode
npm run test:run     # Vitest single run (CI)
npx vitest run src/path/to/file.test.tsx   # Run a single test file
npm run build        # Production build (tsc + vite build)
npm run build:exe    # Build both Windows artifacts (portable first, then NSIS installer
                     # — the NSIS afterPack hook bundles the portable as viewer-template.exe)
npm run lint         # ESLint
```

`predev` automatically compiles `electron/` before `dev` runs — no need to call `electron:compile` manually in development.

## Architecture

### Dual-process Electron app

```
electron/main.ts      ← Node/Electron main process (BrowserWindow, IPC, embedded-PDF extraction)
electron/preload.ts   ← Context bridge (exposes IPC to renderer)
src/                  ← Renderer process (React app served by Vite on :5173)
```

The renderer never uses Node APIs directly. All IPC calls go through `window.electronAPI`:

| API | Description |
|---|---|
| `onOpenFile(cb)` | File path from OS open-file event, CLI arg, or `.pdf` file-association entry point |
| `onOpenPdfBytes(cb)` | PDF bytes when launched as a viewer-exe (portable build only) |
| `readFile(path)` | Read a local file via main process (avoids CORS on `http://localhost`) |
| `exportExe(pdfData)` | Save current PDF embedded into a copy of the portable exe |
| `printWindow()` | Native OS print dialog |

### Rendering pipeline

```
PDF bytes   → pdfjs-dist (Worker)  → HTMLCanvasElement → Konva Stage (KonvaImage)
HWP/HWPX    → @rhwp/core (WASM)    → HTMLCanvasElement → Konva Stage (KonvaImage)
image bytes → browser decoder      → HTMLCanvasElement → Konva Stage (KonvaImage)
EML bytes   → emlParser            → sanitized HTML    → EmailView (NOT this pipeline)
```

Everything except mail becomes a `ViewerDoc`, so zoom / rotate / fit / annotations
/ print / OCR / every export work through one set of paths. Mail is the deliberate
exception: it reflows and has no page geometry (see "Email (.eml)").

Key points:
- **pdfjs worker** is built in `src/services/pdfjsWorker.ts` — a blob URL wrapper that polyfills `Uint8Array.prototype.toHex` and `Map.prototype.getOrInsertComputed` before importing the real worker (both are absent in the Electron Chromium version but required by pdfjs 5.x). That module imports no pdfjs itself, so it stays off the startup path; `usePdfDocument` pulls it in with pdfjs on first document open.
- `usePdfPage` renders each page once and stores the result in a **module-level WeakMap cache** (`pageCache`). View-mode switches (single ↔ spread ↔ grid ↔ fullscreen) do not re-render pages.
- `PdfPage` passes `pageData.canvas` directly to `<KonvaImage>` — no `toDataURL` / `new Image()` round-trip.

### HWP / HWPX viewing

WZ PDF can open Korean `.hwp` (OLE2 binary) and `.hwpx` (zip-based XML) documents alongside PDF files. The full viewer pipeline (page panel, zoom, spread/grid/fullscreen, annotations, OCR, print) works unchanged.

**Detection** — `src/utils/detectDocType.ts` reads magic bytes first (OLE2 `D0 CF 11 E0` → hwp; `%PDF` → pdf); file extension is a fallback only. This ensures a `.pdf`-named HWP file is still routed correctly.

**Engine** — `src/services/hwpEngine.ts` is a lazy-loaded WASM boundary around `@rhwp/core`. `loadHwp(bytes: Uint8Array) → HwpDocument` is the sole public function. The WASM binary (`rhwp_bg.wasm`) is:
- **Production/build:** copied to `public/hwp/` by `npm run setup:hwp` (script is prepended to `build` and `build:exe`; `public/hwp/` is gitignored — run `npm run setup:hwp` before building).
- **Dev:** loaded directly from `node_modules/@rhwp/core/`.

**Adapter** — `src/services/hwpDocAdapter.ts` wraps `HwpDocument` as a pdfjs-shaped `ViewerDoc` interface (`src/types/viewerDoc.ts`). `renderPageToCanvas` auto-sizes the canvas to match HWP page dimensions and paints text, shapes **and embedded pictures** (logos, header bands) — all at the correct position.

**Two things the adapter must get right about embedded pictures:**

1. **Do NOT composite images from `getPageLayerTree` on top of the render.** rhwp already draws each image; a second draw lands at a slightly different position/scale and shows as a **misplaced gray "blob"**, most visible at the app's HiDPI `renderScale` (3× on dpr-2 displays) where the header band balloons over the body text. (`getPageOverlayImages` returning empty `behind`/`front` arrays is a red herring — it does not mean pictures are unpainted.)

2. **rhwp decodes pictures ASYNCHRONOUSLY, per page.** A page's first render(s) within ~200 ms of first touching that page paint the text but **omit the picture** — verified by pixel-sampling in Electron: 5 back-to-back renders all miss the logo, yet a render 200 ms later includes it (time-based, not render-count-based; and per-page, so warming page 1 does not warm page 3). This is why "the logo doesn't show" and why it looked non-deterministic (a browser tab that had already rendered other HWPs had a warm decoder; a cold Electron launch does not). `ensureImagePainted` fixes it: after the initial render, if the page has an image (from `getPageLayerTree`, cached per page) whose bbox region isn't painted yet, it re-renders in place every 80 ms until it appears (cap ~1.5 s), keeping rhwp's own single correct draw. Cost is only paid on the first cold render of each image-bearing page.

Note: HWP pages are 0-based internally; the adapter converts to the app's 1-based page numbers.

**Integration** — `usePdfDocument` detects the file type and returns `{ pdfDoc: ViewerDoc | null, kind: 'pdf'|'hwp'|'image'|'eml', email, ... }`. Downstream code consumes `ViewerDoc` and is unaware of the source format; `pdfDoc` is null only for `eml`.

**Text / search** — on screen HWP has no selectable text layer; `PdfTextLayer` is gated to `kind === 'pdf'`, and in-app selection/search go through OCR on the rendered canvas (same path as scanned PDFs).

**Export → PDF** — `exportHwpToPdf` in `src/services/pdfExporter.ts` composites the rendered page canvases (plus any annotation overlays) into a fresh PDF via pdf-lib, and doubles as an HWP→PDF converter.

It also writes a **selectable text layer**: the page picture alone would be an
image-only PDF (looks right, nothing copyable or searchable), so each run from
`getPageTextLayout` is drawn invisibly (`opacity: 0`) over the pixels it belongs
to — the technique OCR layers use. Two details matter:
- Run size comes from the **measured run width**, not its height: the text is
  invisible so vertical distortion never shows, while matching the width keeps
  selection highlights aligned with the glyphs.
- Noto Sans KR is embedded **subsetted**, and a run whose glyphs the font lacks
  is skipped rather than failing the whole export.

Verify a change here by reading the exported file back with pdfjs and calling
`getTextContent()` — that is the same call a reader uses for select/copy/search.

**Other exports** — HTML viewer and Images ZIP work for HWP (and images) too.
Both go through `ViewerDoc`, so nothing is format-specific; the HTML exporter
converts to PDF first because the page it generates hands its bytes to the
browser's PDF viewer.

**Editing scope** — Existing annotation overlays (stamps, signatures, watermarks, pen, rectangle) work on HWP pages. There is no native HWP content editing. Office formats (DOC, PPT, XLS) are out of scope.

**Bundle impact** — `@rhwp/core` is kept in a lazy chunk (`hwpEngine-*.js`) and never included in the entry bundle; it is only fetched when a HWP/HWPX file is opened.

**Engine version** — `@rhwp/core` is pinned to an **exact** version (no caret) so
an engine change is always a deliberate, tested step. Upgrading is cheap because
rhwp itself is never patched (see "Never patch a dependency in place"): 0.7.17 →
0.8.2 needed no code change. When bumping, compare the two `rhwp.d.ts` surfaces
for removals, then run the same document through both and check page count, ink
coverage and `getPageTextLayout` output — 0.8.2 kept text layout identical but
did shift pagination.

**Korean fonts** — rhwp resolves each HWP font through a CSS fallback chain, e.g.
for 바탕: `"바탕", Batang, 바탕, Nanum Myeongjo, …, Noto Serif KR, …, serif`. On
Korean Windows the first entries are installed system fonts and win, so nothing
of ours is used. Elsewhere every named family misses and the browser drops to
generic serif/sans, changing glyph shapes and metrics.

We therefore ship the **open end of that chain only** — Noto Sans KR + Noto Serif
KR (SIL OFL; `public/fonts/OFL.txt` is the Source Han text that covers both, Noto
CJK being Source Han renamed). The fonts HWP documents actually name —
함초롬바탕/함초롬돋움 (Hancom), 맑은 고딕 / 바탕 / 돋움 (Windows) — are proprietary
and **must not be bundled**: Hancom's licence forbids commercial redistribution
and names using their bundled fonts from another program as a violation, and the
Windows faces may not be redistributed standalone or inside an application.

Two traps, both handled in `src/services/hwpFonts.ts`:
1. **Canvas never starts `@font-face` downloads.** Declaring the face in CSS is
   not enough — it must be loaded through the CSS Font Loading API *before*
   anything is drawn, or the first render silently uses the fallback.
2. Loading unconditionally would waste ~12 MB on the machines that need it least,
   so it first checks whether a Korean face already resolves and no-ops if so
   (measured on Korean Windows: 21 ms, zero bytes fetched).

### Images (jpg / png / bmp / gif / webp)

An image is page-like in the way mail is not — fixed geometry, one page, no
reflow — so `src/services/imageDocAdapter.ts` presents it as a **one-page
ViewerDoc** instead of adding a separate viewer. Zoom, rotation, fit,
annotations, print, OCR and every export then work through the paths they
already use, with no branching downstream.

Decoding uses `createImageBitmap` (Promise-based, so it resolves even when the
window isn't painting), falling back to `<img>` only on engines without it.

### Email (.eml)

The one format that does NOT become a `ViewerDoc`: a message is reflowing HTML
with no page geometry, so rendering it to a canvas would cost text fidelity and
selection for nothing. `usePdfDocument` returns a parsed message and `App`
renders `components/email/EmailView.tsx`.

**Parsing** (`src/services/emlParser.ts`) works from a *binary string* (one char
per byte) rather than decoding the file as text up front — attachments are
arbitrary bytes and would not survive that. Text is decoded per part using that
part's own charset, which is what makes real Korean mail work: EUC-KR bodies,
RFC 2047 encoded-word subjects (including the split-across-lines form) and RFC
2231 percent-encoded filenames all round-trip. `cid:` images are inlined as
`data:` URLs so a normal message renders without fetching anything.

**Safety** (`src/services/emailHtml.ts`) — bodies are attacker-controlled.
DOMPurify does the sanitizing; on top of that we drop `<style>`/`<link>` so a
message cannot restyle the app around it, and **withhold remote images until the
reader asks** (loading one silently tells the sender the mail was opened). Links
get `target=_blank` + `rel=noopener`.

**Attachments** download through `utils/download.ts`, and a PDF/HWP/image
attachment can be opened straight into the viewer.

### What the reflowing formats share (mail, Markdown)

Neither becomes a `ViewerDoc`, and the whole toolbar used to hang off
`hasPdf = !!pdfDoc` — so opening a `.md` or `.eml` silently hid print, zoom and
fullscreen along with the page controls that genuinely don't apply. `isFlowKind`
(`types/viewerDoc.ts`) is now the single predicate for "reflows instead of
paginating", and `ActionBar` takes a `flowDoc` prop beside `hasPdf`. Rotation,
spread/grid, OCR, page CRUD and annotation tools stay page-only; zoom, print and
fullscreen work for everything.

- **Zoom** scales the *type*, not a page. Both views set `fontSize` on their
  article from `BASE_FONT_PX * zoom` and size everything inside in `em` — a
  Tailwind `text-sm` is rem-based and would stubbornly stay put while the rest
  of the document grew. `App` resets zoom to 1 when the doc kind changes,
  because `useFitZoom` never runs for these and they would otherwise inherit
  whatever the last PDF was fitted to (often ~0.5 — microscopic).
- **Print** (`services/htmlPrint.ts`) prints the DOM rather than page images.
  This is the better output, not just the easier one: the browser already knows
  how to break text across sheets, and text printed as text stays vector-sharp
  and selectable in a "print to PDF". It reuses `usePrint`'s `#wz-print-root` /
  `data-wz-printing` mechanism and clones the element marked `FLOW_PRINT_ATTR`.
  Two things it must get right: the global `@page { margin: 0 }` (which exists
  so a rasterised page fills the sheet edge to edge) is overridden by a `<style>`
  injected for the duration of the print, since `@page` cannot be scoped by a
  selector; and **every wait on the way to the dialog has a deadline**, because
  `requestAnimationFrame` and `HTMLImageElement.decode()` are compositor-driven
  and never settle while the window is occluded — by that point the app shell is
  already hidden, so an unbounded await strands the user on a blank window.
- **Fullscreen** is `components/reader/ReaderFullscreen.tsx`, deliberately not
  shared with `FullscreenView`: that one advances through pages, this one
  scrolls one continuous document, so the keymap differs (PageDown/Space/arrows
  scroll by a screenful; `+`/`-`/`0` size the text). Everything that *isn't*
  about pages is reused as-is — `PresentationOverlay` and `PresentationHud` are
  page-agnostic, so pen/highlighter/arrow/laser/spotlight and the ESC two-step
  behave identically to a PDF presentation.

- **Find (`Ctrl+F`)** reuses the same `SearchBar`; only the engine differs
  (`hooks/useFlowSearch.ts`). It walks the marked element's text nodes and paints
  matches through the **CSS Custom Highlight API** — mail and Markdown bodies are
  attacker-controlled HTML that DOMPurify has already vetted, and the usual
  "wrap matches in `<mark>`" trick would mean rewriting that vetted DOM on every
  keystroke. Highlights come from `Range` objects instead, so the document is
  never touched (styled in `index.css` via `::highlight()`; without the API,
  Chromium <105, it still finds and scrolls, it just can't paint). Text is
  flattened with a `
` at every block boundary so a query cannot match across
  the gap between two paragraphs.

  This is also why **both views memoize their body element**. React re-runs the
  `dangerouslySetInnerHTML` assignment whenever the subtree re-renders, which
  replaces every node in it: any `Range` held over the content collapses, and —
  independently of search — the reader's own text selection vanishes on something
  as ordinary as a zoom click. `useMemo` on the element lets React bail out of
  the subtree entirely.

Still page-only, and deliberately: **export**. A Markdown or mail → PDF that is
worth shipping needs real text layout (the HWP exporter's problem, minus the
engine that already knows the geometry), so the export menu stays hidden here
rather than offering a rasterised downgrade.

### Markdown (.md)

The second format that stays off the `ViewerDoc` path, for the same reason as
mail: Markdown reflows. `usePdfDocument` decodes the bytes (UTF-8 with a *strict*
decoder, falling back to EUC-KR when it throws — Korean notes are still commonly
CP949) and `App` renders `components/markdown/MarkdownView.tsx`.

**Rendering** (`src/services/markdownDoc.ts`) — `renderMarkdown(source)` returns
`{ html, title, outline }` using `marked` (GFM) plus DOMPurify. YAML front matter
is stripped before parsing, and GFM task-list checkboxes are rewritten into
`li.wz-md-task` markers **before** sanitizing, since an `<input>` would not
survive it. Body typography lives in `.wz-md-body` (`src/index.css`).

**Contents rail** — headings down to H3 become a sticky left rail (only when the
document has ≥3 of them; fewer just looks cluttered). The active section is
tracked from the scroll container's own `scrollTop` against heading offsets
measured **once per render**, so scrolling never forces a layout pass. Two things
this depends on:
- The scroll container is `position: relative`, which makes it the headings'
  `offsetParent` — otherwise `offsetTop` and `scrollTop` are in different
  coordinate spaces and the highlight drifts by the toolbar height.
- At the bottom of the file nothing can scroll further, so the trailing sections
  would never light up; that case explicitly selects the last heading.

**Editing** — the padlock switch (`appMode === 'editor'`) swaps the rendered page
for a monospace textarea holding the **raw** Markdown, tags and all. The buffer is
keyed to the source it came from (`{ base, text }`) so opening another file
reseeds it without an effect that would setState during render — the same pattern
the render result uses. Locking again re-renders from the edited text, so the
view and the source stay in step. Saving goes through the shared
`pickSaveTarget`/`saveBlobTo` helpers, and only reports success once the write
actually completed.

### Coordinate system

Annotations are stored in **PDF-point space** (independent of zoom/scale).

- `effectiveZoom = PDF_RENDER_SCALE * zoom` (render scale 1.5 × user zoom)
- Screen → stored: `toStoredCoords(x, y, effectiveZoom)` → divides by effectiveZoom
- Stored → screen: `toScreenCoords(x, y, effectiveZoom)` → multiplies by effectiveZoom
- For pdf-lib export, Y-axis is flipped: `toPdfLibY(pdfJsY, height, pageHeight)`

### State management (App.tsx)

All state lives in `App.tsx` (no external store). Key state:

| State | Purpose |
|---|---|
| `file / fileBytes` | Current PDF — `fileBytes` kept separately for export |
| `zoom` | Display zoom multiplier (0.1–3, step 0.25). Does NOT affect render cache. |
| `rotation` | Page rotation: `0 \| 90 \| 180 \| 270` degrees |
| `viewMode` | `'single' \| 'spread' \| 'grid' \| 'fullscreen'` |
| `fullscreenLayout` | `'single' \| 'spread'` — captured from `viewMode` when entering fullscreen |
| `appMode` | `'viewer' \| 'editor'` — hides annotation tools in viewer mode; entering `editor` also opens the page list |
| `activeMode` | `'select' \| 'stamp' \| 'signature' \| 'watermark' \| 'pen' \| 'rectangle' \| null` |
| `pendingStamp / pendingSignature` | Image data URL awaiting placement click |
| `scrollToPage` | Target page number for programmatic scroll (cleared after use) |
| `currentPage` | Currently visible page number (1-based) |
| `isExporting` | Boolean blocking UI during export operations |
| `isPanelOpen` | Whether the left Pages panel is open |
| `isPageOperating` | Boolean blocking UI during page insert/delete/reorder operations |
| `toast` | `{ id: number; message: string } \| null` — current toast notification |

### Component tree

```
App
├── ActionBar          ← Top bar: view/zoom controls, editor tools, Reset markup button, upload/export
│                        Chrome-style flat chrome: every control is a rounded-full
│                        ghost button (no idle background), groups are separated by
│                        whitespace rather than 1px rules, and editing is one padlock
│                        `role="switch"` (locked = read-only) instead of a segmented
│                        viewer/editor control. BTN_ACTIVE is a soft wash for "which
│                        view am I in"; BTN_ARMED keeps the saturated accent for a
│                        drawing tool, because that changes what the next click does.
├── PagePanel          ← Left sidebar: thumbnail strip, multi-select, drag-reorder, add/delete pages
│                        readOnly={appMode === 'viewer'} — visible in both viewer and editor modes
├── Toast              ← Fixed bottom-center auto-dismissing notification (2500ms)
├── [hidden file input] ← Double-click empty area to open
└── main
    └── PdfViewer
        ├── (single)   → LazyPdfPage × numPages (IntersectionObserver-gated)
        ├── (spread)   → SpreadView → LazyPdfPage pairs
        ├── (grid)     → GridView → LazyPdfPage × numPages at zoom=0.3
        └── (fullscreen) → FullscreenView → PdfPage(s) (1 or 2 depending on fullscreenLayout)
```

`LazyPdfPage` wraps `PdfPage` and defers mounting the Konva Stage until the container enters the viewport (400px rootMargin). Once mounted it stays mounted — the render cache makes re-mounts cheap.

`PdfPage` = Konva `<Stage>` with three layers: background (`KonvaImage`) + `AnnotationLayer` + in-progress drawing preview layer.

### Performance notes

- `PdfPage` and `AnnotationLayer` are wrapped in `React.memo`.
- `pageAnnotations` inside `PdfPage` is memoized with `useMemo` — gives `AnnotationLayer` a stable reference.
- Ctrl+scroll zoom is handled via a passive-false wheel listener on `window` in App.tsx (disabled in `fullscreen` and `grid` modes).
- `FullscreenView` manages its own zoom state (auto-fit on page change, Ctrl+scroll override). ESC calls `document.exitFullscreen()` first; `onExit()` is triggered by the resulting `fullscreenchange` event — this avoids the "window shrinks after React unmount" artefact.

### Bundle splitting & lazy loading

The renderer bundle is split so the initial chunk only contains code needed for the first paint. Everything optional is lazy-loaded on demand:

| Lazy chunk | Triggered by | Why it's lazy |
|---|---|---|
| `services/pdfExporter` | Export → PDF | pdf-lib (~200 KB) only needed at export time |
| `services/htmlExporter` | Export → HTML | base64 encoding helper |
| `services/imageExporter` | Export → Images | JSZip (~100 KB) only needed at export time |
| `services/pdfPageService` | Page CRUD ops | Shares pdf-lib with the PDF exporter |
| `services/hwpEngine` | Opening a HWP/HWPX file | @rhwp/core WASM; not loaded for PDF-only use |
| `components/modals/SignaturePad` | Editor → Signature | Canvas drawing UI |
| `components/modals/WatermarkConfig` | Editor → Watermark | Form UI |

`vite.config.ts` declares a manual chunk for `react` / `react-dom` only. Modals and the viewer subtree load through `<Suspense>` boundaries in `App.tsx`.

**Only list a library in `manualChunks` if the FIRST PAINT genuinely needs it.**
Forcing a lazily-used library into a manual chunk makes rolldown hoist that chunk
into the entry's *static* graph (an `import "./vendor-x.js"` at the top of the
entry plus a modulepreload) — which silently cancels any `React.lazy` /
dynamic-import work done to keep it off startup. This has bitten twice: the OCR
runtime (which then evaluated at startup and hit the CSP), and pdfjs + konva
(~730 KB paid on every cold launch for code an empty viewer never uses).

**`prefetchViewerChunks` (App.tsx)** — deferring the viewer fixed startup but
moved the cost: the common desktop flow is double-clicking a PDF, so the app
booted fast and then sat on the Suspense fallback while the viewer downloaded.
The chunks are now fetched on an idle callback right after mount, so first paint
still needs only the entry chunk and `<Suspense>` resolves without ever showing
its fallback. If you add a heavy view, prefetch it the same way.

### Custom hooks (src/hooks/)

App.tsx is kept thin by extracting feature bundles into hooks. Each owns the state it needs, returns just the handlers, and lazy-imports any heavy dependencies internally.

| Hook | Returns | Notes |
|---|---|---|
| `useAnnotations()` | annotation state + CRUD + `remapAnnotations`, `clearMarkups` | Sole source of annotation state |
| `usePdfDocument(file)` | `{ pdfDoc, numPages, isLoading, error }` | Wraps pdfjs `getDocument` lifecycle |
| `useFitZoom({ pdfDoc, viewMode, rotation, setZoom })` | `{ calcFitZoom }` | Auto-fit on doc/view/rotation change (debounced 80 ms) |
| `usePrint()` | `{ handlePrint }` | Composites Konva canvases → image, listens to `wz-print` event |
| `useExporters({ ... onSuccess })` | `{ isExporting, handleExport{Pdf,Html,Images,Exe} }` | Lazy-imports services; surfaces a single `isExporting` for UI gating |
| `usePageOperations({ fileBytes, onResult })` | `{ isPageOperating, handle{Delete,InsertBlank,InsertFromPdf,Reorder}Pages }` | Shared `runOp` wrapper handles try/catch + state flips |
| `useThumbnails(pdfDoc, numPages)` | `thumbnails: string[]` (data URLs) | Sequential render at `THUMBNAIL_SCALE=0.2` |

### Page management

Page CRUD operations are handled by pure functions in `src/services/pdfPageService.ts` (uses **pdf-lib**). All functions return `{ newBytes: ArrayBuffer, pageMapping: Map<number, number> }` so callers can remap existing annotations via `useAnnotations().remapAnnotations(mapping)`.

| Function | Description |
|---|---|
| `deletePages(bytes, pageNums)` | Remove one or more pages (1-based); surviving pages are remapped |
| `insertBlankPage(bytes, afterPage, width?, height?)` | Insert a blank A4 page after `afterPage` (0 = prepend) |
| `insertPagesFromPdf(bytes, afterPage, srcBytes)` | Append all pages from another PDF after `afterPage` |
| `reorderPages(bytes, newOrder)` | Reorder pages according to a permutation array |

`useThumbnails(pdfDoc, numPages)` — hook that renders page thumbnails sequentially at `THUMBNAIL_SCALE=0.2` (JPEG quality 0.8). Returns `thumbnails: string[]` (data URLs). Re-runs whenever `pdfDoc` changes.

`PagePanel` (`src/components/panel/PagePanel.tsx`) — left sidebar showing thumbnails:
- Click to navigate, Ctrl/Shift-click for multi-select
- Drag-and-drop reorder (HTML5 drag API)
- Toolbar: Insert blank page, Insert from PDF, Delete selected pages
- `readOnly` prop: hides toolbar, disables drag, disables Delete key listener — used in Viewer mode
- Delete key shortcut: fires `handleDelete` when `!readOnly && selected.size > 0` and focus is not in an input/textarea

### Volatile markup tools (pen & rectangle)

Drawing tools that are **display-only and not exported to PDF**. They live alongside permanent annotations in the same `annotations` array but are identified by `isVolatile(a)` (`type === 'pen' || type === 'rectangle'`).

**Keyboard shortcuts (work in both normal and fullscreen mode):**

| Key | Action |
|---|---|
| `1` | Toggle yellow freehand pen mode (`activeMode = 'pen'`) |
| `2` | Toggle red rectangle drag mode (`activeMode = 'rectangle'`) |
| `ESC` (first press) | Clear all markups + exit drawing mode (if any markups or drawing mode active) |
| `ESC` (second press) | Exit fullscreen (if in fullscreen with no markups) |
| `Home` | Jump to first page (fullscreen only) |
| `End` | Jump to last page (fullscreen only) |

**Visual constants (in `PdfPage.tsx`):**

| Constant | Value | Purpose |
|---|---|---|
| `PEN_COLOR` | `'#FFFF00'` | Yellow pen stroke color |
| `PEN_STROKE_WIDTH` | `14` | PDF points (~21px at zoom=1) |
| `PEN_OPACITY` | `0.4` | Semi-transparent overlay feel |
| `RECT_COLOR` | `'#FF0000'` | Red rectangle stroke color |
| `RECT_STROKE_WIDTH` | `2` | PDF points |

**How continuous drawing works:**
- `addAnnotation` for volatile types does **not** reset `activeMode` or `selectedId`, so the user stays in drawing mode for multiple strokes.
- `handleAnnotationAdd` in App.tsx early-returns for pen/rectangle, skipping the `pendingStamp` clear and `setActiveMode('select')` path.
- The in-progress stroke is shown as a 3rd preview `<Layer listening={false}>` inside the Stage.

**Reset button:** Appears in ActionBar (hidden in fullscreen). Calls `clearMarkups()` + resets `activeMode` to `null`.

**Clearing markups:**
- `clearMarkups()` in `useAnnotations` removes all pen/rectangle annotations and preserves non-volatile `selectedId`.
- App.tsx global ESC handler runs in **capture phase** with `stopImmediatePropagation()` to prevent FullscreenView's bubble-phase handler from seeing the event when markups are being cleared.

### Annotation types

```typescript
// src/types/annotation.ts
type AnnotationType = 'stamp' | 'signature' | 'watermark' | 'pen' | 'rectangle'
type ActiveMode = 'select' | 'stamp' | 'signature' | 'watermark' | 'pen' | 'rectangle' | null

interface PenAnnotation extends BaseAnnotation {
  type: 'pen'
  points: number[]    // flat [x1,y1,x2,y2,...] in PDF points, page-local coords
  color: string       // '#FFFF00'
  strokeWidth: number // PDF points
  opacity: number     // 0–1
}

interface RectangleAnnotation extends BaseAnnotation {
  type: 'rectangle'
  color: string       // '#FF0000'
  strokeWidth: number // PDF points
}

const VOLATILE_TYPES: readonly AnnotationType[] = ['pen', 'rectangle']
function isVolatile(a: Annotation): boolean  // true for pen and rectangle
```

`remapAnnotations(mapping: Map<number, number>)` in `useAnnotations` — updates annotation page numbers after page CRUD. `allPages` watermarks are always preserved regardless of the mapping.

### Toast notifications

`src/components/Toast.tsx` — fixed bottom-center notification:
- Auto-dismisses after `duration` ms (default 2500ms)
- `role="status"` + `aria-live="polite"` for accessibility
- Rendered with a unique `key={toast.id}` in App.tsx so each new toast resets the timer even for identical messages
- Triggered by `showToast(message)` helper in App.tsx after successful export operations

### Export

Four export formats, all operating on `fileBytes` (not the rendered canvas). All show a toast on success.

| Format | Service | Notes |
|---|---|---|
| PDF (annotated) | `src/services/pdfExporter.ts` | Embeds stamp/signature/watermark using **pdf-lib**; pen/rectangle are volatile and **not** exported |
| HTML viewer | `src/services/htmlExporter.ts` | Self-contained file: PDF encoded as base64, decoded to a Blob URL at runtime |
| Images (ZIP) | `src/services/imageExporter.ts` | Each page rendered to PNG at 2× scale via pdfjs; bundled with **JSZip** |
| Viewer EXE | `electron/main.ts` `export-exe` IPC | Self-clone of the portable exe with PDF bytes appended; only works when running the packaged portable build |

### Viewer EXE feature

The current PDF can be exported as a standalone viewer exe in **both** the
portable run and the NSIS-installed app. The trick: a portable SFX template
is required as the base — the NSIS installer ships one in its resources.

`electron/main.ts` exposes `findViewerTemplate()` which resolves the template path:

1. **Portable run:** `process.env.PORTABLE_EXECUTABLE_FILE` is set by electron-builder
   and points to the running SFX itself. Use that.
2. **NSIS-installed run:** the env var is absent, but the installer bundled the
   portable as `<install>/resources/viewer-template.exe` (see afterPack hook below).
3. **Dev mode:** neither exists; `export-exe` IPC returns an error explaining the user must build first.

Export pipeline (regardless of source):

1. `findViewerTemplate()` resolves the template path.
2. The handler appends: `[PDF bytes] [4-byte length UInt32LE] [16-byte WZPDF_VIEWER_V01 marker]`.
3. On startup, `extractEmbeddedPdf()` checks `PORTABLE_EXECUTABLE_FILE` (the resulting EXE always runs as a portable SFX) for the marker and reads the embedded bytes.
4. If found, sends them to the renderer via the `open-pdf-bytes` IPC channel.

### Startup cost (measured, not guessed)

Measured end to end on the packaged build over CDP (spawn → the app on screen):
Chromium up ~0.16 s, `loadURL` issued at ~0.15 s, every critical asset fetched
by ~0.19 s, React mounted ~0.23 s. There is no meaningful download cost — the
whole critical path is 271 KB read from a local asar.

**Do not profile this by staring at the window.** The two facts that matter were
both invisible from the outside and only showed up in a CDP trace: the bytes
arrive in 190 ms, and the blank window afterwards is main-thread blocking, not
loading.

- **`app.html` ships an inline first-paint shell** (48 px gray-900 bar over the
  window's own background). Until the bundle runs, `#root` is empty, and the
  window used to sit as a dark void for however long that took. `createRoot()`
  clears the shell on mount, so there is no flash.
- **`app.asar` must stay small.** electron-builder ships production
  `node_modules` by default, but nothing needs them at runtime — Vite bundles
  every renderer dependency into `dist/`, and the main process imports only
  `electron` plus Node built-ins. Shipping them anyway put ~237 MB of exact
  duplicates in the asar (3106 of 3182 entries). Windows opens `app.asar` on
  every launch, so that file is what an AV scan or a cold page-in must get
  through first. `electron-builder.json5` therefore excludes `node_modules` and
  `asarUnpack`s the lazily-read binaries (OCR models, wasm, OCR chunks):
  **363 MB → 12.7 MB.**

- **Never touch `localStorage` on the startup path.** On the packaged app's
  custom `app://` origin the **first** `localStorage` access blocks the
  renderer's main thread for **~6 seconds** while Chromium initialises DOM
  Storage for a non-http scheme. Every later access is 0 ms, and it is specific
  to that one API: on the same origin `sessionStorage` costs 15 ms and
  `indexedDB.open` 37 ms. The landmine is still there — `localStorage.getItem`
  in the shipped app still measures ~5.9 s — our code simply no longer steps
  on it.

  This shipped for a long time. `src/i18n/index.ts` computed `LANG` during
  module evaluation, and that read `localStorage`, so the freeze landed *before
  the first paint*: the window sat empty for six seconds on every launch,
  showing neither the app nor app.html's own boot shell. Deferring the read
  would not have helped — the cost is in the first access whenever it happens,
  so it would only have moved the freeze into a moment the user is interacting.
  `canPersistOverride()` now keeps non-http origins off storage entirely.

  Symptom to recognise: a fixed, suspiciously round delay that is identical
  across runs and unaffected by `--no-sandbox`, `--disable-gpu`, Electron
  version or a warm file cache, with all sub-resources already `loadingFinished`
  long before `DOMContentLoaded`. That shape means blocking work on the main
  thread, and `Profiler.start`/`stop` across the gap names the function.

- **The portable exe pays ~5.2 s before any of our code runs**, self-extracting
  its ~114 MB SFX payload to `%TEMP%` on every launch. Nothing in the app can
  shorten or paint during that window — no process exists yet. The NSIS-installed
  build does not pay it, which is why the installer is the recommended download.

When profiling the packaged app, disable Chromium's background throttling
(`--disable-background-timer-throttling --disable-renderer-backgrounding
--disable-backgrounding-occluded-windows`) or an unfocused window will report
document loads 10× slower than they are — that artefact cost a whole debugging
session once.

### Distribution (Windows)

`npm run build:exe` runs **two electron-builder invocations sequentially** —
`--win portable` then `--win nsis`. The order matters: NSIS's afterPack hook
needs the portable artifact already on disk to embed.

- `release/WZ_PDF_${version}.exe` — Portable single-file exe (~140 MB)
  - Built first
  - Acts as both a standalone launcher AND the template embedded by NSIS
  - `PORTABLE_EXECUTABLE_FILE` env-var is set automatically when launched

- `release/WZ_PDF_Setup_${version}.exe` — NSIS installer (~280 MB; recommended for daily use)
  - User chooses install path, creates Desktop + Start Menu shortcuts
  - Registers as a handler for `.pdf` files (`fileAssociations` in `electron-builder.json5`)
  - Maximum LZMA compression; only en-US/ko Electron locales bundled
  - **Bundles the portable** as `resources/viewer-template.exe` so the installed app can still produce Viewer EXE exports — see `scripts/afterPack.cjs`

The OS passes the double-clicked PDF path as a CLI argument; `electron/main.ts`
picks it up via `process.argv` and sends `open-file` to the renderer.

### `hwp2pdf` console tool

A batch HWP/HWPX → PDF converter installed beside the app. Three pieces:

- `cli/hwp2pdf.cs` → `build/hwp2pdf.exe` (~5 KB), built by `scripts/build-cli.cjs`
  with the **csc.exe that ships with Windows**, so the project still needs
  nothing but Node to build. It exists only because `WZ PDF.exe` is a
  GUI-subsystem binary: started from cmd it has no console and its output goes
  nowhere. A console-subsystem parent has one, and a child launched with
  inherited handles writes to it — so the launcher's whole job is to lend the
  app a console and pass the exit code back.
- `electron/cli.ts` — argument parsing, wildcard matching, output paths. Pure
  and unit-tested; Windows hands `*.hwp` to a program **unexpanded**, so
  expanding it is the tool's job. The matcher is written directly rather than
  translated into a RegExp, because every character of a real file name would
  otherwise need escaping (`report(final).hwp`) and a star-heavy pattern can
  backtrack exponentially.
- `electron/cliRunner.ts` + `src/services/cliBridge.ts` — the conversion runs in
  a **hidden window loading the ordinary app page**, because `@rhwp/core` renders
  into a canvas and `exportHwpToPdf` composites those canvases. That is not a
  workaround, it is what makes the output identical to the GUI's Export → PDF,
  selectable text layer and bundled Korean fonts included.

Two things that cost real time to learn:

- **Every wait must be bounded.** `loadURL`, the poll for `window.__wzCli` and
  each conversion all have deadlines. Without them the process sits with no
  window and no output and has to be killed from Task Manager. One-time startup
  (engine + the ~12 MB Korean fonts) is a separate `warmup()` step, or the first
  document gets billed for it and is reported as a timeout.
- **Never hand-patch `release/win-unpacked/resources/app.asar` to test a
  change.** electron-builder stamps an integrity hash into the exe (`updating
  asar integrity executable resource` in the build log); a repacked asar fails
  that check and the app starts but never loads its code — no window, no output,
  no error. It looks exactly like a hang in your own code. Run `build:exe`.

### File associations — three lists that must agree

Opening a document by double-click crosses three gates, and each used to carry
its own copy of "which formats do we support":

1. `fileAssociations` in `electron-builder.json5` — what the installer registers.
2. The argv scan in `electron/main.ts` — what the running app accepts as the
   file to open (`findFileArgument`).
3. The `read-file` IPC — what the main process will actually read.

They drifted: only `pdf` was ever registered, and (2) and (3) allowed only
pdf/hwp/hwpx. Associating `.md` by hand therefore *launched* the app and then
showed an empty window, because the path was silently dropped at gate (2).

`DOCUMENT_EXTENSIONS` in `electron/security.ts` is now the single list, and
`security.test.ts` fails if the installer registers an extension the runtime
would refuse. Two details worth knowing:

- **Markdown and mail have no signature.** `hasSupportedDocumentSignature`
  cannot vet them, so `isTextDocumentPath` exempts them and they are accepted on
  extension alone. That is sound here: `read-file`'s threat model is a
  compromised renderer asking for an arbitrary path, which stays bounded by the
  extension allowlist, the symlink-resolved real path and the size cap. The
  signature check exists to catch a *renamed binary*, which is only enforceable
  where the format has a signature.
- **electron-builder uses `name` as the Windows ProgID**, not as a label —
  confirmed in the registry, where `HKLM\Software\Classes\.pdf` resolves to the
  literal string `PDF Document` from that config. Generic names are therefore a
  collision risk with other applications, so every entry except the pre-existing
  `pdf` one uses a `WZPDF.<ext>` ProgID. `description` is the text Explorer shows.

Registering a type makes the app *available* for it and gives it the app icon.
Windows 10/11 still asks the user before changing an established default, and no
installer can bypass that.

### Security hardening (electron/main.ts)

Renderer is sandboxed and IPC inputs are validated. Notable measures:

- `BrowserWindow.webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`, plus the `*InWorker`/`*InSubFrames` variants.
- `will-navigate` blocks all URLs except the exact `app://bundle` origin (production) and `http://localhost:5173` (dev).
- `setWindowOpenHandler` denies new Electron windows; external `http(s)://` URLs are handed to `shell.openExternal`.
- `web-contents-created` denies `<webview>` attachments app-wide.
- **Production-only CSP** is injected via `session.defaultSession.webRequest.onHeadersReceived`. Dev mode skips this (Vite HMR needs `unsafe-eval` and a WebSocket connect, which would weaken the policy).
- Every IPC handler rejects non-renderer senders. `read-file` resolves symlinks, accepts only `.pdf`/`.hwp`/`.hwpx`, verifies the file signature, and reads at most 500 MB through the validated handle.
- `fetch-url` rejects private/link-local targets (including redirects), applies a timeout and streaming size limit, and verifies the downloaded document signature.

## Critical gotchas

### pdfjs polyfills — both copies are required
`Uint8Array.prototype.toHex` and `Map.prototype.getOrInsertComputed` must exist in
**two places**: the main thread (`src/main.tsx`, before anything touches pdfjs)
and inside the blob worker string (`src/services/pdfjsWorker.ts`). Removing
either breaks PDF rendering in Electron. The two files are separate on purpose —
`pdfjsWorker.ts` deliberately does not import pdfjs, so requiring it costs a few
bytes instead of pulling the ~400 KB chunk into the entry bundle.

### Annotation coordinates
Everything stored and exported uses the `effectiveZoom = PDF_RENDER_SCALE * zoom` divisor. If you pass plain `zoom` instead of `effectiveZoom` to `toStoredCoords`, annotations will be placed at the wrong position relative to the PDF.

### `page.render()` API (pdfjs 5.x)
Call as `page.render({ canvas, viewport })` — NOT `{ canvasContext: ctx, viewport }`. The old API was removed in pdfjs 5.x.

### pdfjs runtime assets — wasm, cmaps AND standard_fonts
pdfjs 5.x decodes JBIG2, CCITT-Fax and JPEG2000 images in WebAssembly and **silently drops any image it can't decode** if `getDocument` isn't given a `wasmUrl`. Korean scanner / MRC PDFs (e.g. 특허증) store their text as CCITT/JBIG2 `ImageMask`s layered over a DCTDecode background — without `wasmUrl` the masks vanish and only the faint background renders. `usePdfDocument.ts` passes `wasmUrl: new URL('wasm/', new URL('./', document.baseURI)).href` (same base-relative pattern as the OCR assets, so it works over http(s) and Electron `app://`). The decoders live at `public/wasm/` — **gitignored**; regenerate with `npm run setup:pdfjs` (runs automatically in `predev`, `predev:vite`, `build`, `build:exe`). Symptom of a missing/404 wasm: console spams `Jbig2Error: JBig2 failed to initialize` and the operator list has zero `paintImageMaskXObject` ops.

`setup:pdfjs` also mirrors **`cmaps/`** (predefined CJK CMaps) and
**`standard_fonts/`** (substitutes for the 14 non-embedded standard fonts), and
`getDocument` is given `cMapUrl` + `cMapPacked: true` + `standardFontDataUrl`.
These matter because `disableFontFace: true` (needed so pdfjs doesn't hang on the
FontFace path in Electron) *also* disables its system-font fallback: a font the
PDF references but does not embed then has no glyph source at all and every
character renders as a `.notdef` box (▯) while the surrounding embedded-font text
looks fine. All three directories are **gitignored** — regenerate with
`npm run setup:pdfjs`.

### Fullscreen two-step exit (ESC priority)
The two-step ESC behavior ("first press clears markups, second press exits fullscreen") requires:
1. **Keyboard Lock API** in FullscreenView: `navigator.keyboard.lock(['Escape'])` prevents the browser/OS from auto-exiting fullscreen before any JS handler fires.
2. **Capture-phase listener** in App.tsx: `window.addEventListener('keydown', handler, true)` fires before FullscreenView's bubble-phase listener.
3. **`stopImmediatePropagation()`** in App.tsx ESC handler: blocks FullscreenView's handler from also triggering `exitFullscreen()` on the same keydown when clearing markups.

Do **not** call `onExit()` directly from an ESC keydown handler. Always call `document.exitFullscreen()` first and let the `fullscreenchange` event trigger `onExit()`.

### Window-level mouseup for spread-mode drawing
In spread (two-page) view, dragging a pen stroke across the boundary between two `<Stage>` elements means the originating Stage never receives `mouseup`, leaving the stroke orphaned. Fix: each `PdfPage` registers a `window.addEventListener('mouseup', commitDraft)` safety net while in drawing mode. `commitDraft` is wrapped in `useCallback` with a `draftRef.current = null` guard so it is idempotent — calling it twice (once from `window`, once from Stage) is safe.

### Hooks must precede early returns in PdfPage
`PdfPage` has an early return for the loading skeleton (`if (isLoading || !pageData) return …`). All React hooks — including the drawing state (`draft`/`draftRef`), `commitDraft`, and the window-level `mouseup` useEffect — must be declared **before** this early return, or React will throw a "hooks called in different order" error.

### addAnnotation volatile behavior
`addAnnotation` in `useAnnotations` checks `annotation.type === 'pen' || 'rectangle'` and, for these types, **does not** reset `activeMode` or `selectedId`. This allows continuous multi-stroke drawing without leaving drawing mode. The corresponding `handleAnnotationAdd` in App.tsx early-returns for volatile types so `pendingStamp`/`pendingSignature` state is not cleared and `setActiveMode('select')` is not called.

### Electron native print timing
Since Electron's `webContents.print` is asynchronous, do not restore the DOM canvases (`afterPrint` cleanup) immediately after starting the print. Instead, expose the print call as a Promise and `await` it in the renderer, so cleanup is deferred until the print dialog is closed.

### Never read the whole exe at startup (blank-screen stall)
`extractEmbeddedPdf()` (viewer-exe mode) runs in `app.whenReady()` right after `createWindow()`. It must only do **async partial reads** — the 20-byte trailer marker, then just the embedded PDF bytes if present. A synchronous `fs.readFileSync` of the whole portable exe (>140 MB, and it grows with every bundled asset — OCR/HWP/pdfjs wasm) blocks the main-process event loop, which stalls the `app://` protocol handler that serves the renderer, so the window sits on its dark `backgroundColor` for seconds (worst on first launch while AV scans the read). Only the portable / exported viewer exe is affected (`PORTABLE_EXECUTABLE_FILE` set); the NSIS app returns early. Any new startup work in the main process must stay off the event loop until the first paint.

### TypeScript Omit on union types
TypeScript's `Omit<T, K>` does not distribute over union types (it resolves to common keys first, stripping unique properties from union members). Use a distributed utility:
`type OmitId<T> = T extends any ? Omit<T, 'id'> : never`

### Viewer EXE export — template resolution
The `export-exe` IPC handler can't work in dev mode because no SFX template exists. In portable runs it uses `PORTABLE_EXECUTABLE_FILE`; in NSIS-installed runs it uses the bundled `resources/viewer-template.exe`. See `findViewerTemplate()` in `electron/main.ts`. To test the feature you must run a packaged build (either artifact).

### build:exe sequencing — portable MUST build first
The script in `package.json` runs `electron-builder --win portable` *and then* `electron-builder --win nsis` deliberately, not as one combined invocation. The NSIS `afterPack` hook (`scripts/afterPack.cjs`) embeds the portable artifact as `viewer-template.exe`, which requires the portable to already exist on disk. A combined invocation would share `win-unpacked/` and the template wouldn't be ready when NSIS packs.

### OCR assets + dev-vs-prod wasm path
OCR models + onnxruntime-web wasm (~56 MB) live under `public/ocr/` and are **gitignored** — regenerate with `npm run setup:ocr` (`scripts/build-ocr-assets.py`, needs Python + pyyaml) before building. Similarly, the HWP WASM (`public/hwp/`) is **gitignored** — regenerate with `npm run setup:hwp` before building (this runs automatically as part of `build` and `build:exe`). It downloads the PP-OCRv5 detection tar, repackages the community Korean ONNX rec model (`monkt/paddleocr-onnx`) into the SDK's `inference.onnx`+`inference.yml` tar layout (image_shape **[3,48,320]** — the ONNX input height is 48, not the 32 its config.json claims), and copies the ort wasm.

The ort runtime is loaded differently per environment (see `wasmPaths` in `ocrEngine.ts`): **production** uses the bundled `/ocr/wasm/` (fully offline), but **`vite dev` can't serve a `/public` file as a dynamically-imported module** (ort `import()`s its `.mjs` glue → Vite 500s on the `?import` request), so dev loads the runtime from the version-matched jsDelivr CDN instead. Net effect: OCR needs internet in `npm run dev` but the shipped app is offline. Keep `ORT_VERSION` in `ocrEngine.ts` in sync with the `onnxruntime-web` dependency.

### Never patch a dependency in place
Project rule: do not edit third-party sources (`node_modules`, vendored copies)
unless there is genuinely no alternative — every dependency must stay upgradable
at any moment. A local edit is invisible to `npm install` and silently
disappears, or silently blocks, the next upgrade. Put the workaround in our own
wrapper/adapter and comment *why*, so it can be deleted without archaeology once
upstream fixes it. Precedents: `ensureImagePainted` in `hwpDocAdapter.ts` (rhwp's
async picture decode) and the blob-worker polyfills in `pdfjsWorker.ts`. If a
patch is ever unavoidable, prefer a documented build-time patch (`patch-package`)
over an ad-hoc edit, and record it here.

### `npm run dev` fails with `EACCES ... ::1:5173`
Not a port conflict — Windows *reserves* TCP ranges for Hyper-V/WSL/Docker, and
`5078-5177` (which contains Vite's 5173) is commonly one of them. Check with:

```bash
netsh interface ipv4 show excludedportrange protocol=tcp
```

If 5173 falls inside a listed range, nothing can bind it until the reservation is
released — `net stop winnat` / `net start winnat` from an **Administrator** shell
frees the dynamically-claimed ranges. Picking a dev port outside every reserved
range also works, but that port is referenced in three places (Vite, the
`wait-on` in `package.json`, and the dev `loadURL` + trusted-origin check in the
main process), so change all of them together.

### Fit-zoom must measure, not estimate
`useFitZoom` reads the real viewport (`<main>`'s `clientWidth`/`clientHeight`,
which already exclude borders and any visible scrollbar) instead of deriving it
from `window.innerHeight` minus constants. It used to assume a 44 px toolbar; the
toolbar is 48 px plus a 1 px border, so it over-estimated the free height by 5 px
and a single-page document opened just tall enough to raise a scrollbar.

### Type-check with `tsc -b`, not `tsc -p tsconfig.json`

`tsconfig.json` is a **solution file** — `"files": []` plus references to
`tsconfig.app.json` and `tsconfig.node.json`. So `tsc --noEmit -p tsconfig.json`
exits 0 without checking a single source file, which reads exactly like a clean
type-check. `npm run build` and `npm run build:exe` run `tsc -b`, which does
build the referenced projects, so errors surface only at build time — after the
change looks verified.

This has already broken one Windows build: a newly-required `ActionBar` prop was
missing from the test fixtures, `tsc -b` failed with 30+ errors and
electron-builder was never reached. Note that the referenced projects include
`*.test.tsx`, so a prop added to a component's public interface must be added to
its test fixtures too.

### Claude Code file locks during build
The `claude.exe` agent process can hold open file handles to `release/win-unpacked/resources/app.asar` from previous Glob/Read tool calls, causing electron-builder to fail with "process cannot access the file because it is being used by another process". Before a `build:exe` run, either restart the Claude Code session or delete `release/` from a separate admin terminal. Also add the project folder to Windows Defender exclusions if real-time scanning is locking newly written asars.
