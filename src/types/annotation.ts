export type AnnotationType = 'stamp' | 'signature' | 'watermark'

export interface BaseAnnotation {
  id: string
  page: number        // 1-based page number
  type: AnnotationType
  x: number          // pixel coords at PDF_RENDER_SCALE, zoom=1
  y: number
  width: number
  height: number
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

export type Annotation = StampAnnotation | SignatureAnnotation | WatermarkAnnotation

export type ActiveMode = 'select' | 'stamp' | 'signature' | 'watermark' | null
