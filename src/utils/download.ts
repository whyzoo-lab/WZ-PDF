/**
 * Trigger a browser download for a Blob. Centralizes the
 * createObjectURL → anchor → click → revoke dance used by every exporter.
 */
/**
 * Make an attachment name safe to hand to the OS. The name comes from the
 * message, so it can carry separators, control characters, a reserved device
 * name (`CON.pdf`) or a trailing dot Windows silently drops.
 */
export function safeFilename(name: string, fallback = 'attachment'): string {
  // Control characters by code point, so the regex below needs none of them.
  let out = Array.from(name, ch => (ch.charCodeAt(0) < 32 ? '_' : ch)).join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(out)) out = '_' + out
  if (out.length > 150) {
    const dot = out.lastIndexOf('.')
    const ext = dot > 0 ? out.slice(dot).slice(0, 12) : ''
    out = out.slice(0, 150 - ext.length) + ext
  }
  return out || fallback
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFilename(filename)
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

// ── Saving ──────────────────────────────────────────────────────────────────
//
// Exports used to fire an anchor download and immediately announce "saved",
// which was wrong twice over: nothing had been written yet, and the user was
// never asked where to put it.
//
// `showSaveFilePicker` fixes both, but it needs *transient user activation* —
// the permission a click grants, which expires after a few seconds. Building a
// PDF can easily outlive that, so the location is chosen FIRST (while the click
// is still fresh) and the bytes are written once they exist. That also reads
// better: pick the file, then it fills in.

/** A chosen destination, or why there isn't one. */
export type SaveTarget =
  | { kind: 'file'; handle: FileSystemFileHandle }
  | { kind: 'canceled' }
  /** Browser has no save picker (Firefox/Safari) — fall back to a download. */
  | { kind: 'unsupported' }

interface PickOptions {
  /** Shown in the dialog's file-type dropdown, e.g. "PDF document". */
  description: string
  /** MIME → extensions, e.g. { 'application/pdf': ['.pdf'] }. */
  accept: Record<string, string[]>
}

/**
 * Ask the user where to save. Call this synchronously from the click handler,
 * BEFORE any slow work, or the picker will be refused for lack of activation.
 */
export async function pickSaveTarget(
  suggestedName: string,
  options: PickOptions,
): Promise<SaveTarget> {
  const picker = (window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle>
  }).showSaveFilePicker
  if (typeof picker !== 'function') return { kind: 'unsupported' }
  try {
    const handle = await picker({
      suggestedName,
      types: [{ description: options.description, accept: options.accept }],
    })
    return { kind: 'file', handle }
  } catch (err) {
    // AbortError is the user closing the dialog — not a failure worth surfacing.
    if (err instanceof DOMException && err.name === 'AbortError') return { kind: 'canceled' }
    // Anything else (no activation left, permission policy) → still let them
    // have the file via the download path rather than losing the export.
    return { kind: 'unsupported' }
  }
}

/**
 * Write the blob to a target chosen earlier. Resolves only once the bytes are
 * actually on disk, so the caller can announce success truthfully.
 *
 * @returns true if written/downloaded, false if the user had cancelled.
 */
export async function saveBlobTo(
  target: SaveTarget,
  blob: Blob,
  fallbackFilename: string,
): Promise<boolean> {
  if (target.kind === 'canceled') return false
  if (target.kind === 'unsupported') {
    downloadBlob(blob, fallbackFilename)
    return true
  }
  const writable = await target.handle.createWritable()
  try {
    await writable.write(blob)
  } finally {
    // close() is what flushes; skipping it on error would leave a 0-byte file.
    await writable.close()
  }
  return true
}
