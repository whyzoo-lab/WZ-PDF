// Logical scale: PDF points → CSS pixels at zoom 1. This is the coordinate
// system divisor (effectiveZoom = PDF_RENDER_SCALE * zoom) used for annotations,
// clicks, fit-zoom and the text layer. It is NOT the rasterization resolution.
export const PDF_RENDER_SCALE = 1.5

// Rasterization (bitmap) resolution is decoupled from the logical scale above.
// A page is rendered to a canvas at `pixels-per-point` chosen to match how big
// it is actually shown (PDF_RENDER_SCALE * zoom * devicePixelRatio), so small
// pages blown up to fill the viewport and HiDPI screens stay sharp. MAX_RENDER_SCALE
// caps the per-page pixel count so memory stays bounded on large documents.
export const MAX_RENDER_SCALE = 4

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 3
export const ZOOM_STEP = 0.25
