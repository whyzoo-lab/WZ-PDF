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

/** Strip a trailing `.pdf` (case-insensitive) from a filename. */
export function stripPdfExt(filename: string): string {
  return filename.replace(/\.pdf$/i, '')
}
