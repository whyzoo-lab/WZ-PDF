export type AnnotationType = 'stamp' | 'signature' | 'watermark' | 'pen' | 'rectangle'

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

export type Annotation =
  | StampAnnotation
  | SignatureAnnotation
  | WatermarkAnnotation
  | PenAnnotation
  | RectangleAnnotation

export type OmitId<T> = T extends any ? Omit<T, 'id'> : never

export type ActiveMode = 'select' | 'stamp' | 'signature' | 'watermark' | 'pen' | 'rectangle' | null

/** Annotation types that are display-only (not exported to PDF, cleared by Reset). */
export const VOLATILE_TYPES: readonly AnnotationType[] = ['pen', 'rectangle']

export function isVolatile(a: Annotation): boolean {
  return a.type === 'pen' || a.type === 'rectangle'
}
