export function toScreenCoords(
  storedX: number,
  storedY: number,
  zoom: number,
): { x: number; y: number } {
  return { x: storedX * zoom, y: storedY * zoom }
}

export function toStoredCoords(
  screenX: number,
  screenY: number,
  zoom: number,
): { x: number; y: number } {
  return { x: screenX / zoom, y: screenY / zoom }
}

export function toScreenSize(
  storedWidth: number,
  storedHeight: number,
  zoom: number,
): { width: number; height: number } {
  return { width: storedWidth * zoom, height: storedHeight * zoom }
}

/** PDF.js top-left origin → pdf-lib bottom-left origin (all values in same unit) */
export function toPdfLibY(
  pdfJsY: number,
  elementHeight: number,
  pageHeight: number,
): number {
  return pageHeight - pdfJsY - elementHeight
}

/** Converts #rrggbb hex to [r, g, b] in 0–1 range */
export function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b]
}
