# PDF Viewer + Annotation Editor — Design Spec

**Date:** 2026-05-21  
**Status:** Approved

---

## Overview

Browser-only MVP for viewing PDFs and adding lightweight annotations (stamps, signatures, watermarks). No backend required. Does not modify original PDF object streams — uses an overlay rendering approach.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React + TypeScript + Vite |
| Styling | TailwindCSS |
| PDF Rendering | pdfjs-dist |
| Annotation Layer | react-konva (Konva.js) |
| PDF Export | pdf-lib |

---

## Architecture

### Core Approach: Single-Layer Konva Stage

Each PDF page is rendered by PDF.js onto an offscreen `<canvas>`, converted to a base64 image via `canvas.toDataURL()`, and inserted as a Konva `Image` node (background layer). Annotations are rendered as Konva nodes on a separate layer above the background. Konva's built-in `Transformer` handles drag, resize, and rotate interactions for all annotation types.

**Data Flow:**
```
PDF Upload
  → PDF.js parse (usePdfDocument)
  → Per-page canvas render (usePdfPage)
  → canvas.toDataURL() → base64 image
  → Konva Stage: background Image layer
  → AnnotationLayer: stamp / signature / watermark nodes
  → User interaction → annotation state update
  → Export: pdf-lib renders annotations onto new PDF
```

### Project Structure

```
src/
├── components/
│   ├── viewer/
│   │   ├── PdfViewer.tsx          # Viewer container, page list management
│   │   ├── PdfPage.tsx            # Single page: PDF.js render → Konva Stage
│   │   └── ZoomControls.tsx       # Zoom in/out buttons
│   ├── annotations/
│   │   ├── AnnotationLayer.tsx    # Konva Layer, renders annotation nodes
│   │   ├── StampNode.tsx          # Konva Image node (stamp)
│   │   ├── SignatureNode.tsx      # Konva Image node (signature)
│   │   └── WatermarkNode.tsx      # Text overlay across all pages
│   ├── toolbar/
│   │   ├── Toolbar.tsx            # Left sidebar
│   │   └── ActionBar.tsx          # Top action bar (Upload, Export)
│   └── modals/
│       ├── SignaturePad.tsx        # Signature drawing modal
│       └── WatermarkConfig.tsx    # Watermark settings modal
├── hooks/
│   ├── usePdfDocument.ts          # PDF.js document load
│   ├── usePdfPage.ts              # Single page rendering
│   └── useAnnotations.ts          # Annotation state CRUD
├── services/
│   └── pdfExporter.ts             # pdf-lib based PDF generation
├── utils/
│   ├── coordinates.ts             # Zoom coordinate conversion utilities
│   └── stampPresets.ts            # Built-in stamp preset data
└── types/
    └── annotation.ts              # Annotation type definitions
```

---

## Data Model

### Annotation Types

```typescript
type AnnotationType = 'stamp' | 'signature' | 'watermark';

interface BaseAnnotation {
  id: string;
  page: number;         // 1-based page number
  type: AnnotationType;
  x: number;            // Normalized PDF coordinates (zoom-invariant)
  y: number;
  width: number;
  height: number;
  rotation: number;     // degrees
}

interface StampAnnotation extends BaseAnnotation {
  type: 'stamp';
  src: string;          // base64 PNG (preset or uploaded)
  presetId?: string;    // 'approved' | 'confidential' | 'draft' | 'rejected' | undefined
}

interface SignatureAnnotation extends BaseAnnotation {
  type: 'signature';
  src: string;          // base64 PNG from handwriting canvas
}

interface WatermarkAnnotation extends BaseAnnotation {
  type: 'watermark';
  text: string;
  opacity: number;      // 0–1
  fontSize: number;
  color: string;
  allPages: boolean;    // true = apply to all pages; when true, page field is ignored
}

type Annotation = StampAnnotation | SignatureAnnotation | WatermarkAnnotation;
```

### Annotation State (`useAnnotations` hook)

```typescript
{
  annotations: Annotation[];
  selectedId: string | null;
  activeMode: 'select' | 'stamp' | 'signature' | 'watermark' | null;
}
```

**Coordinate normalization rule:** Coordinates are always stored at zoom=1 (PDF page native dimensions). On render, multiply by current zoom scale. On `dragend`/`transformend`, divide back to zoom=1 before saving. This guarantees stable annotation positioning across zoom levels.

---

## Rendering & Konva Integration

### Zoom Handling

```
Stage width  = page.naturalWidth  * zoom
Stage height = page.naturalHeight * zoom
Background Image: scaleX = zoom, scaleY = zoom
Annotation nodes: x = stored.x * zoom, y = stored.y * zoom,
                  width = stored.width * zoom, height = stored.height * zoom
```

### Konva Transformer

Attaches automatically when an annotation is selected. Provides 8 resize handles and 1 rotation handle. On `transformend` and `dragend`, de-normalize coordinates back to zoom=1 and dispatch state update.

### Multi-page Scrolling

`PdfPage` components are stacked vertically with a 16px gap inside a single scroll container. Each page has its own Konva Stage. Watermark with `allPages: true` is rendered on every Stage.

### Mobile Support

- Touch drag via Konva's built-in touch event support
- Responsive breakpoint at 768px
- Below 768px: Toolbar moves to bottom fixed bar, ActionBar shows icons only

---

## PDF Export Engine (`pdfExporter.ts`)

### Export Flow

```
PDFDocument.load(originalPdfBytes)
  → for each page:
      → filter annotations for this page
      → for stamp / signature:
            pdfDoc.embedPng(base64ToPng(annotation.src))
            page.drawImage(image, { x, y, width, height, rotate })
      → for watermark (allPages: true applies to every page; allPages: false only to annotation.page):
            page.drawText(text, { x: center, y: center, size, font,
                                   color, opacity, rotate })
  → pdfDoc.save()
  → download Blob
```

### Coordinate Conversion (PDF.js → pdf-lib)

PDF.js uses top-left origin; pdf-lib uses bottom-left origin:

```typescript
pdfLibY = pageHeight - annotationY - annotationHeight
```

### Built-in Stamp Presets

4 presets embedded as SVG, converted to PNG at runtime:

| ID | Label | Color |
|---|---|---|
| `approved` | APPROVED | Green |
| `rejected` | REJECTED | Red |
| `confidential` | CONFIDENTIAL | Blue |
| `draft` | DRAFT | Gray |

---

## UI/UX Layout

### Desktop Layout

```
┌─────────────────────────────────────────────┐
│  ActionBar  [Upload PDF]        [Export PDF] │
├──────────┬──────────────────────────────────┤
│          │                                  │
│ Toolbar  │         PDF Viewer               │
│          │    (vertically scrollable)        │
│ [Select] │                                  │
│ [Stamp]  │   ┌────────────────────┐         │
│ [Sign]   │   │  Page 1 (Konva)    │         │
│ [Water]  │   └────────────────────┘         │
│          │   ┌────────────────────┐         │
│ ── ── ── │   │  Page 2 (Konva)    │         │
│ Zoom +/- │   └────────────────────┘         │
└──────────┴──────────────────────────────────┘
```

### Mobile Layout (< 768px)

- ActionBar: top, icon-only buttons
- Viewer: full width
- Toolbar: bottom fixed bar with icon buttons

### Interaction Flows

| Action | Flow |
|---|---|
| Upload PDF | Drag & drop or file picker → PDF.js load → render pages |
| Add Stamp | Click `[Stamp]` → slide-in panel (presets + upload) → click on page to place |
| Add Signature | Click `[Sign]` → modal opens → draw on canvas → click OK → click on page to place |
| Add Watermark | Click `[Water]` → config modal (text, opacity, rotation) → apply to all pages |
| Select / Move | Click annotation → Konva Transformer appears → drag to move |
| Resize / Rotate | Drag Transformer handles |
| Delete | Select annotation → press `Delete` key |
| Export | Click `[Export PDF]` → pdf-lib generates → browser download |

---

## Constraints

- Browser-only, no backend
- No annotation persistence across page reload (session memory only)
- No PDF text selection (PDF rendered as image in Konva)
- No OCR, form parsing, or incremental save
- No full text editing engine

---

## Dependencies

| Package | Purpose | License |
|---|---|---|
| `pdfjs-dist` | PDF rendering | Apache-2.0 |
| `react-konva` + `konva` | Annotation canvas layer | MIT |
| `pdf-lib` | PDF export | MIT |
| `react` + `typescript` + `vite` | App framework | MIT |
| `tailwindcss` | Styling | MIT |
