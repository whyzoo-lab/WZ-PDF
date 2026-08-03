# WZ PDF

**Open PDF, Korean HWP, e-mail, images and Markdown — present, annotate, OCR and convert. 100% in your browser. No upload.**

Introduce : https://whyzoo.com/WzPDF/ · Demo : https://whyzoo-lab.github.io/WZ-PDF/ · Download : [Releases](https://github.com/whyzoo-lab/WZ-PDF/releases)

[![Latest release](https://img.shields.io/github/v/release/whyzoo-lab/WZ-PDF?label=release)](https://github.com/whyzoo-lab/WZ-PDF/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Platform](https://img.shields.io/badge/platform-Web%20%C2%B7%20Windows-informational)
![No upload](https://img.shields.io/badge/privacy-no%20upload%20%C2%B7%20offline-success)

<img width="1871" height="995" alt="image" src="https://github.com/user-attachments/assets/11aad7cd-0b71-4f2e-8dc4-670e90bf0cd7" />
<img width="1590" height="870" alt="image" src="https://github.com/user-attachments/assets/a7eea157-9be1-4749-bda5-076134bed0db" />
<img width="1455" height="1000" alt="image" src="https://github.com/user-attachments/assets/2fa5af89-d1c0-434c-b5ab-96172fa2f551" />

> A presentation-focused viewer, editor, and distribution platform for the
> documents that actually land in your inbox.

WZ PDF is a fast, **fully client-side** document tool. Open a PDF, a Korean
`.hwp` / `.hwpx`, a saved e-mail (`.eml`) or an image — read and select the text,
mark it up, run OCR, present it fullscreen, and export it in several formats —
all in the browser or as a desktop app. **No backend, no upload: your file never
leaves your machine.**

Built with React, Konva, pdfjs, pdf-lib, and Electron, plus a Rust→WASM HWP
engine ([`@rhwp/core`](https://www.npmjs.com/package/@rhwp/core)) and an on-device
OCR runtime. Ships with an optional
[Model Context Protocol](https://modelcontextprotocol.io) server so AI agents
(e.g. Claude) can drive PDF operations programmatically.

---

## Why WZ PDF

- 🔒 **Private by design** — everything runs in the browser/desktop. Nothing is uploaded.
- 📄 **PDF _and_ HWP/HWPX** — open Korean word-processor files exactly like a PDF, with **native selectable text** (no OCR needed).
- 🔁 **HWP → PDF that you can actually copy from** — the converted file carries a real text layer, so text stays selectable and searchable in any reader. Not a picture of a document.
- 📦 **Any document → standalone `.exe`** — hand someone a single file that opens itself. Works for HWP/HWPX too, not just PDF.
- ✉️ **Open `.eml` mail** — headers, body and **attachments you can save**, with Korean encodings (EUC-KR bodies, encoded subjects and filenames) handled properly. Remote images are blocked until you ask, so opening a message doesn't report back to the sender.
- 🖼️ **Images too** — jpg / png / bmp / gif / webp open as documents, so zoom, annotation, OCR and every export just work.
- 📝 **Markdown as a document** — `.md` renders as a formatted page (headings, tables, code, task lists) with a contents rail, not as raw text.
- 🎯 **Made for presenting** — fullscreen mode with ZoomIt-style presenter tools (pen, highlighter, arrow, laser pointer, spotlight zoom).
- 🔎 **On-device OCR** — recognize text in scanned pages and images, **fully offline** (Korean + English). Plus **Ctrl-drag any region → OCR → clipboard**.
- 🧩 **Embed anywhere** — drop the viewer into any website with a single `<iframe>` (see below).
- ⚡ **Starts fast, stays sharp** — the desktop app boots without waiting on code it isn't using yet, and pages are rasterised at the size they're shown so small text stays crisp.
- 🖥️ **Web + Windows desktop** — same app, and the desktop build associates with `.pdf` / `.hwp` / `.hwpx`.

## Embed the viewer in your site

Show a PDF inline on any page — no download, no plugin:

```html
<iframe
  src="https://whyzoo-lab.github.io/WZ-PDF/app.html?embed=1&url=PDF_URL"
  style="width:100%; height:80vh; border:0;"
  title="PDF preview"
  allowfullscreen></iframe>
```

- `url` — the PDF/HWP to display (URL-encode it). `embed=1` hides the editing chrome for a clean read-only viewer; drop it to open the full app.
- **CORS:** the web build fetches the file in the browser, so host the document on the **same origin** (or a CORS-enabled URL). The desktop app is not affected by CORS.
- Try it live on the [demo page](https://whyzoo-lab.github.io/WZ-PDF/), which embeds this viewer with a sample document and shows a copy-ready snippet for your deployment.

---

## Features

### View & present
- **View modes** — single page, two-page spread, grid overview, and a
  presentation **fullscreen** mode (USB-clicker friendly, touchpad swipe,
  click-to-advance, `Home`/`End` jumps).
- **Presenter tools** (fullscreen, ZoomIt-style) — pen (`P`), highlighter (`H`),
  rectangle (`R`), arrow (`A`), laser pointer (`L`), and spotlight zoom (`Z`);
  color `1`–`5`, width `[` `]`, undo `Ctrl+Z`, erase `E`. Two-step `ESC`.
- **On-screen markup** (any mode) — yellow highlighter (`1`) and red rectangle
  (`2`) for quick emphasis; never written to the file, cleared with `ESC`.
- **Sharp rendering** — pages rasterize to match zoom × display density, so small
  slides and HiDPI screens stay crisp.

### Text, search & OCR
- **Select & copy text** — real selectable text layer over PDF pages, and
  **native selectable text for HWP/HWPX** (no OCR required). In Editor mode,
  double-click to edit text via an inline overlay.
- **Search** — `Ctrl+F` find across the document (works on OCR text too).
- **OCR** — recognize text in scanned/image pages, **100% on-device and offline**
  (Korean + English, PaddleOCR PP-OCRv5). Run per page or whole document.
- **Region OCR → clipboard** — hold **Ctrl and drag** to highlight any area; on
  release it's OCR'd and the text is copied to your clipboard.

### HWP / HWPX (Korean documents)
- View `.hwp` (binary) and `.hwpx` (OOXML) files through the **same pipeline as
  PDF** — annotations, OCR, print, and export all work unchanged.
- **HWP → PDF** — Export → PDF composites the rendered pages, doubling as a
  converter.

### Annotate, manage & export
- **Annotate** (Editor mode) — stamps, hand-drawn signatures, and full-page
  watermarks, baked into the exported PDF. Korean text via an embedded Noto Sans
  KR subset.
- **Page management** — reorder (drag), insert blank / insert from another PDF,
  delete, with thumbnails. Annotations follow their pages automatically.
- **Export** — annotated PDF, self-contained HTML viewer, page images (ZIP), and
  a standalone **Viewer EXE** (desktop build).
- **Print** — in-app WYSIWYG **print preview**; every page composited with
  annotations, aspect ratio preserved.

### App & platform
- **Open from anywhere** — file picker, drag-and-drop, OS file association
  (desktop), or **Open from URL**.
- **Auto-update notice** — the desktop app checks for new versions in the
  background and shows an optional, dismissable prompt.
- **i18n** — UI and help auto-switch to Korean on Korean OS/browser locale,
  English everywhere else.
- **Responsive** — works on desktop, tablet, and phone.

## Quick start (web)

```bash
npm install
npm run dev:vite      # Vite dev server only (browser)
```

Open <http://localhost:5173>. (The root is the landing/demo page; the app itself is at `/app.html`.)

## Desktop app (Electron)

```bash
npm run dev           # compile Electron main + Vite + launch Electron
```

## Build

```bash
npm run build         # production web build → dist/
npm run build:exe     # Windows portable + NSIS installer → release/
```

`build:exe` regenerates the app icon from `public/icon.svg`, copies the HWP WASM
runtime, and runs two electron-builder passes (portable first, then NSIS). The
OCR and HWP binary assets are gitignored and regenerated at build time
(`npm run setup:ocr` needs Python + pyyaml; `npm run setup:hwp` runs
automatically). See [`CLAUDE.md`](./CLAUDE.md) for architecture and build details.

## Testing & quality

```bash
npm test              # Vitest (watch)
npm run test:run      # Vitest (single run)
npm run lint          # ESLint
```

## MCP server (optional)

`mcp/` contains a Model Context Protocol server exposing PDF operations
(info, text extract, search, watermark, stamp, text overlay, split, merge,
delete/reorder/insert pages) to MCP-capable AI clients. It runs over stdio
or HTTP (Streamable HTTP) and sandboxes all file access to a configured
directory. See [`mcp/README.md`](./mcp/README.md).

## Deployment

Two supported targets:

- **GitHub Pages / static host** — the CI workflow builds and deploys the web app
  (and the demo landing) to Pages on every push to `main`. Any static host works:
  serve the `npm run build` output in `dist/`.
- **Self-host over SSH** — `deploy.example.bat` is a template for deploying to an
  nginx-served host. Copy it to `deploy.bat` (gitignored) and fill in your server,
  user, and paths.

Tagging `v*.*.*` triggers a GitHub Release that builds and publishes the Windows
installer + portable exe.

## Tech stack

| Area | Tooling |
|---|---|
| UI | React 19, Tailwind CSS 4, Konva / react-konva |
| PDF | pdfjs-dist (render/text), pdf-lib + @pdf-lib/fontkit (export) |
| HWP / HWPX | @rhwp/core (Rust → WebAssembly) |
| OCR | onnxruntime-web + PaddleOCR PP-OCRv5 (offline, on-device) |
| Desktop | Electron + electron-builder |
| Build/Test | Vite, TypeScript, Vitest, ESLint |
| Agents | @modelcontextprotocol/sdk |

## License

[MIT](./LICENSE). Third-party components and their licenses (Apache-2.0,
SIL OFL, MIT, etc.) are listed in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
