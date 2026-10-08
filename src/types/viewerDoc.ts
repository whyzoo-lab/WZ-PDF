/** Which engine produced the document. `eml` has no ViewerDoc — a message
 *  is reflowing HTML, not pages, so it renders outside the page pipeline.
 *  Nor do `docx` (Word) and `sheet` (Excel, ODS, CSV), for the same reason. */
export type DocKind = 'pdf' | 'hwp' | 'eml' | 'image' | 'md' | 'docx' | 'pptx' | 'sheet'

/**
 * True for the kinds that reflow instead of paginating (mail, Markdown, Office).
 *
 * These have no `ViewerDoc`, so anything keyed to page geometry — rotation,
 * spread/grid, OCR, stamps — is meaningless for them, while zoom, print and
 * fullscreen still are. One predicate so the two lists never drift apart.
 */
export function isFlowKind(kind: DocKind): boolean {
  return kind === 'eml' || kind === 'md' || isOfficeKind(kind)
}

/** Word, PowerPoint and spreadsheets: read-only views, nothing to edit or save. */
export function isOfficeKind(kind: DocKind): kind is 'docx' | 'pptx' | 'sheet' {
  return kind === 'docx' || kind === 'pptx' || kind === 'sheet'
}

export interface ViewerViewport { width: number; height: number; scale: number }

/** A positioned native text run (HWP), in page-point coordinates (scale-1 px). */
export interface HwpTextRun { text: string; x: number; y: number; width: number; height: number }

export interface ViewerPage {
  getViewport(params: { scale: number }): ViewerViewport
  render(params: { canvas: HTMLCanvasElement; viewport: ViewerViewport }): { promise: Promise<void> }
  /** Selectable text geometry. PDF returns real items; HWP returns `{ items: [] }`. */
  getTextContent(): Promise<{ items: unknown[] }>
}

/** The type of a File that is an image collection's manifest (services/imageSet.ts). */
export const IMAGE_SET_MIME = 'application/x-wz-image-set'

/** One page of an image collection: a file, and which page of it (multi-page TIFF). */
export interface ImageSetEntry { src: string; page?: number }

/** The frames of an animated image (GIF, animated WebP), decoded on demand. */
export interface ImageAnimation {
  frameCount: number
  /** Frame `i`, and how long it stays up in ms. The caller closes `image`. */
  frame(i: number): Promise<{ image: VideoFrame; duration: number }>
  close(): void
}

/**
 * What an image collection knows beyond its pages: one image, the images in
 * its folder, a selection, or a ZIP — all shown as one document. See
 * services/imageSet.ts.
 */
export interface ImageSetView {
  /** The collection's name — the folder's, or the first file's. */
  name: string
  /** Page order. */
  entries: ImageSetEntry[]
  /** File name of page n's image (1-based). */
  nameOf(page: number): string
  /** Page n's file, as it is on disk. */
  original(page: number): Promise<{ bytes: ArrayBuffer; name: string }>
  /** The file's own bytes when a PDF can take them as they are (JPEG, PNG). */
  encoded(page: number): Promise<{ bytes: Uint8Array; type: 'jpeg' | 'png' } | null>
  /** Anything but a JPEG may have transparent pixels. */
  mayHaveAlpha(page: number): boolean
  /** Frames to animate page n with, or null when it is a still picture. */
  animation(page: number): Promise<ImageAnimation | null>
}

/**
 * The subset of pdfjs's `PDFDocumentProxy` the app actually uses. Both the real
 * pdfjs document and the HWP adapter satisfy this, so all downstream code is
 * source-agnostic.
 */
export interface ViewerDoc {
  numPages: number
  getPage(pageNumber: number): Promise<ViewerPage>
  /** Native positioned text for a page (HWP only — enables real text selection
   *  without OCR). Absent on the pdfjs path (PDF uses its own text layer). */
  getPageText?(pageNumber: number): Promise<HwpTextRun[]>
  /** Present on image collections only. */
  images?: ImageSetView
  destroy(): void
}
