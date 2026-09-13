/**
 * Where a document's bytes come from, and how much of them the renderer holds.
 *
 * Up to `EAGER_DOCUMENT_MAX_BYTES` a document is read whole, as it always was:
 * the save paths (pdf-lib export, page CRUD, encryption, the HTML and EXE
 * exports) all need the complete file, and at that size holding it is cheap.
 *
 * Above it, reading whole does not work. A 1.38 GB PDF used to be copied five
 * times on the way to the screen — once in the main process, once across IPC,
 * then `new File`, `fileBytes` and pdfjs's own copy in the renderer — and the
 * main process refused it outright at 500 MB. So a large document is **paged
 * in by byte range** instead: pdfjs asks for the ranges it needs through a
 * `PDFDataRangeTransport`, and reads the cross-reference table at the end plus
 * whatever the visible pages draw. Measured on that 1.38 GB, 223-page file:
 * opening it read 1.7 MB, and pages 1, 100 and 223 together 5.7 MB (0.4%).
 *
 * The cost is that a large document is view-only — there are no bytes to hand
 * pdf-lib, and a 1.4 GB pdf-lib parse would not fit in the renderer anyway.
 * Only PDFs page in this way; the other engines (rhwp, the image decoder, the
 * mail and Markdown parsers) need their whole input.
 */

/** Largest document the renderer reads whole. Above it, pages come in by range. */
export const EAGER_DOCUMENT_MAX_BYTES = 500 * 1024 * 1024

/** The same limit, as a reader sees it in a message. */
export const EAGER_DOCUMENT_LIMIT_LABEL = `${EAGER_DOCUMENT_MAX_BYTES / (1024 * 1024)}MB`

/** How much of a large document to read before handing it to pdfjs. */
export const RANGE_INITIAL_BYTES = 1024 * 1024

/**
 * pdfjs's range granularity. Its default is 64 KB, which turns one large page
 * image into hundreds of IPC round trips; contiguous missing chunks are still
 * requested as a single range, so a bigger chunk only trims the small ones.
 */
export const RANGE_CHUNK_BYTES = 1024 * 1024

/** A document read in pieces rather than held whole. */
export interface RangedFile {
  readonly name: string
  readonly size: number
  readonly type: string
  /** Bytes `[begin, end)`. */
  readRange(begin: number, end: number): Promise<Uint8Array>
}

/**
 * What the viewer opens. A browser `File` can already be read by range
 * (`slice`); a path the operating system handed the desktop app cannot be
 * turned into one, so it is a `RangedFile` backed by IPC.
 */
export type DocumentFile = File | RangedFile

export function isRangedFile(file: DocumentFile): file is RangedFile {
  return typeof (file as Partial<RangedFile>).readRange === 'function'
}

/** Too large to hold: paged in by range, and view-only. */
export function isLargeDocument(file: Pick<DocumentFile, 'size'>): boolean {
  return file.size > EAGER_DOCUMENT_MAX_BYTES
}

/** Bytes `[begin, end)` of either kind of document, without reading the rest. */
export async function readRange(file: DocumentFile, begin: number, end: number): Promise<Uint8Array> {
  if (isRangedFile(file)) return file.readRange(begin, end)
  // A File from the picker or a drop is backed by the file on disk, so a slice
  // reads just that slice.
  return new Uint8Array(await file.slice(begin, end).arrayBuffer())
}

/** The whole document, for the formats and sizes that need it. */
export async function readAll(file: DocumentFile): Promise<ArrayBuffer> {
  if (!isRangedFile(file)) return file.arrayBuffer()
  const bytes = await file.readRange(0, file.size)
  return bytes.slice().buffer
}

/**
 * A local file opened by path, read through the main process one range at a
 * time. `read-file-range` repeats every check `read-file` makes — extension,
 * real path, network paths, signature — on each call.
 */
export function pathFile(filePath: string, size: number): RangedFile {
  const api = window.electronAPI
  if (!api?.readFileRange) throw new Error('Reading by range is only available in the desktop app')
  const name = filePath.split(/[/\\]/).pop() || 'document.pdf'
  return {
    name,
    size,
    type: '',
    readRange: async (begin, end) => {
      const from = Math.max(0, begin)
      const to = Math.min(size, end)
      if (to <= from) return new Uint8Array(0)
      return new Uint8Array(await api.readFileRange(filePath, from, to - from))
    },
  }
}
