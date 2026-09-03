export type AnnotationType = 'stamp' | 'signature' | 'watermark' | 'pen' | 'rectangle' | 'textEdit'

export interface BaseAnnotation {
  id: string
  page: number        // 1-based page number
  type: AnnotationType
  x: number          // PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
  y: number          // PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
  width: number      // PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
  height: number     // PDF points (screen pixels / effectiveZoom, where effectiveZoom = PDF_RENDER_SCALE * zoom)
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

/**
 * Free-form highlighter / pen stroke. Volatile — not exported to PDF, cleared
 * by ESC or the Reset button. x/y/width/height fields are unused; the stroke
 * is fully described by `points`.
 */
export interface PenAnnotation extends BaseAnnotation {
  type: 'pen'
  points: number[]   // flat [x1, y1, x2, y2, ...] in PDF points, page-local
  color: string      // hex color e.g. '#FFFF00'
  strokeWidth: number // PDF points
  opacity: number    // 0–1
}

/**
 * Drag-to-create rectangle outline. Volatile — same semantics as PenAnnotation.
 * x/y/width/height represent the rectangle in PDF points.
 */
export interface RectangleAnnotation extends BaseAnnotation {
  type: 'rectangle'
  color: string       // hex color e.g. '#FF0000'
  strokeWidth: number // PDF points
}

/**
 * Editor-mode text patch: covers the original PDF text at (x, y, width, height)
 * with a white rectangle and renders `text` on top in the default font.
 * Created by double-clicking a text span in the selectable text layer.
 */
export interface TextEditAnnotation extends BaseAnnotation {
  type: 'textEdit'
  text: string       // new text content to display
  fontSize: number   // PDF points (matches original text size)
  color: string      // hex color, default '#000000'
  background: string // rectangle fill that hides the original, default '#FFFFFF'
}

export type Annotation =
  | StampAnnotation
  | SignatureAnnotation
  | WatermarkAnnotation
  | PenAnnotation
  | RectangleAnnotation
  | TextEditAnnotation

// Distributive Omit over the Annotation union. `T extends unknown` triggers
// distribution just like `extends any` but without the no-explicit-any lint.
export type OmitId<T> = T extends unknown ? Omit<T, 'id'> : never

export type ActiveMode = 'select' | 'stamp' | 'signature' | 'watermark' | 'pen' | 'rectangle' | null

/** Annotation types that are display-only (not exported to PDF, cleared by Reset). */
export const VOLATILE_TYPES: readonly AnnotationType[] = ['pen', 'rectangle']

/** Accepts anything with a type, so a not-yet-saved annotation (no id) qualifies. */
export function isVolatile(a: Pick<Annotation, "type">): boolean {
  return VOLATILE_TYPES.includes(a.type)
}

/**
 * Annotations that belong on a given 1-based page. `allPages` watermarks match
 * every page; everything else matches only its own `page`. Single source of
 * truth used by the renderer, the print pipeline, and the PDF exporter.
 */
export function annotationsForPage(annotations: Annotation[], pageNumber: number): Annotation[] {
  return annotations.filter(a =>
    a.type === 'watermark' ? a.allPages || a.page === pageNumber : a.page === pageNumber,
  )
}
