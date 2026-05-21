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
