# PDFusion

> Presentation-focused PDF viewer, editor & distribution platform.

PDFusion is a fast, fully client-side PDF tool. Open a PDF, mark it up, manage
pages, present it fullscreen, and export it in multiple formats — all in the
browser or as a desktop app. **No backend, no upload: your file never leaves
your machine.**

Built with React, Konva, pdfjs, pdf-lib, and Electron. Ships with an optional
[Model Context Protocol](https://modelcontextprotocol.io) server so AI agents
(e.g. Claude) can drive PDF operations programmatically.

---

## Features

- **View** — single page, two-page spread, grid overview, and a presentation
  fullscreen mode (USB-clicker friendly, touchpad swipe, click-to-advance).
- **Annotate** (Editor mode) — stamps, hand-drawn signatures, and full-page
  watermarks, baked into the exported PDF. Korean text supported via an
  embedded Noto Sans KR subset.
- **On-screen markup** — yellow highlighter (`1`) and red rectangle (`2`) for
  live presenting; never written to the file, cleared with `ESC`.
- **Select & copy text** — real selectable text layer over the rendered page;
  in Editor mode, double-click to edit text via an inline overlay.
- **Page management** — reorder (drag), insert blank / insert from another PDF,
  delete, with thumbnails. Annotations follow their pages automatically.
- **Export** — annotated PDF, self-contained HTML viewer, page images (ZIP),
  and a standalone Viewer EXE (desktop build).
- **Print** — every page composited with annotations, aspect-ratio preserved.
- **i18n** — UI and help auto-switch to Korean on Korean OS/browser locale,
  English everywhere else.
- **Responsive** — works on desktop, tablet, and phone.

## Quick start (web)

```bash
npm install
npm run dev:vite      # Vite dev server only (browser)
```

Open <http://localhost:5173>.

## Desktop app (Electron)

```bash
npm run dev           # compile Electron main + Vite + launch Electron
```

## Build

```bash
npm run build         # production web build → dist/
npm run build:exe     # Windows portable + NSIS installer → release/
```

`build:exe` regenerates the app icon from `public/icon.svg`, then runs two
electron-builder passes (portable first, then NSIS). See
[`CLAUDE.md`](./CLAUDE.md) for architecture and build details.

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

`deploy.example.bat` is a template for deploying the web build to an
nginx-served host over SSH. Copy it to `deploy.bat` (gitignored) and fill in
your own server, user, and paths.

## Tech stack

| Area | Tooling |
|---|---|
| UI | React 19, Tailwind CSS 4, Konva / react-konva |
| PDF | pdfjs-dist (render/text), pdf-lib + @pdf-lib/fontkit (export) |
| Desktop | Electron + electron-builder |
| Build/Test | Vite, TypeScript, Vitest, ESLint |
| Agents | @modelcontextprotocol/sdk |

## License

[MIT](./LICENSE). Third-party components and their licenses (Apache-2.0,
SIL OFL, etc.) are listed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
