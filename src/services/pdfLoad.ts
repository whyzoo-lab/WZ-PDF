import { PDFDocument, PDFInvalidObject } from '@cantoo/pdf-lib'

/**
 * Opens a PDF for writing, decrypting it first when it is password-protected.
 *
 * `pdfjs` decrypts for *display*; pdf-lib is handed the raw file and needs the
 * key of its own, which is why the password the reader typed at open time has
 * to travel this far. Saving the result without a password is what removes it.
 */
export async function loadPdfForWriting(
  bytes: ArrayBuffer,
  password?: string,
): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, password ? { password } : undefined)
  if (password) dropStaleXrefObjects(doc)
  return doc
}

/**
 * Drops a cross-reference stream that an encrypted source left behind.
 *
 * The library parses the original xref stream as an opaque `PDFInvalidObject`
 * and carries its raw bytes into the new file, and those bytes still say
 * `/Encrypt 17 0 R` — pointing at an object that is no longer written. Most
 * readers ignore it (pdfjs, pypdf and therefore our own viewer all open the
 * file fine), but pdf-lib re-parses that stale dictionary as a trailer and
 * refuses the document as encrypted. So a file we had just unlocked could not
 * be page-edited by this app afterwards.
 *
 * A rewritten document never needs a carried-over cross-reference stream — the
 * writer emits a fresh one — so dropping it is safe and leaves the output with
 * no trace of the encryption. In practice only files encrypted by this same
 * library carry the leftover; PDFs locked by other tools round-trip clean.
 *
 * This lives here rather than as a patch to the dependency, per the project
 * rule: a local edit to `node_modules` is invisible to `npm install` and
 * silently blocks the next upgrade. Delete this once upstream stops emitting it.
 */
function dropStaleXrefObjects(doc: PDFDocument): void {
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFInvalidObject)) continue
    // Its `toString()` is only a placeholder ("PDFInvalidObject(310 bytes)"),
    // so the bytes themselves have to be read to tell what it is.
    const bytes = new Uint8Array(obj.sizeInBytes())
    obj.copyBytesInto(bytes, 0)
    let head = ''
    for (let i = 0; i < Math.min(bytes.length, HEAD_BYTES); i++) {
      head += String.fromCharCode(bytes[i])
    }
    if (head.includes('/XRef')) doc.context.delete(ref)
  }
}

/** Enough to cover a cross-reference stream's dictionary, before its data. */
const HEAD_BYTES = 400
