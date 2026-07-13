// Visual constants for volatile markups (pen / rectangle). Shared by the
// drawing hook (usePageDrawing, which bakes them into committed annotations)
// and PdfPage's in-progress preview layer.
export const PEN_COLOR        = '#FFFF00'
export const PEN_STROKE_WIDTH = 14   // PDF points → renders ~21px at zoom=1
export const PEN_OPACITY      = 0.4
export const RECT_COLOR        = '#FF0000'
export const RECT_STROKE_WIDTH = 2   // PDF points
