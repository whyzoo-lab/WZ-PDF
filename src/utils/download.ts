/**
 * Trigger a browser download for a Blob. Centralizes the
 * createObjectURL → anchor → click → revoke dance used by every exporter.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Strip a trailing document extension so exports are named after the source.
 * Covers every format the app can open — otherwise a HWP export came out as
 * `report.hwp.html`.
 */
export function stripDocExt(filename: string): string {
  return filename.replace(/\.(pdf|hwpx?|eml|png|jpe?g|bmp|gif|webp|avif|ico)$/i, '')
}
