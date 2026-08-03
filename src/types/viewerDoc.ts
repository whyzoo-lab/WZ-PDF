/** Which engine produced the document. `eml` has no ViewerDoc — a message
 *  is reflowing HTML, not pages, so it renders outside the page pipeline. */
export type DocKind = 'pdf' | 'hwp' | 'eml' | 'image' | 'md'

/**
 * True for the kinds that reflow instead of paginating (mail, Markdown).
 *
 * These have no `ViewerDoc`, so anything keyed to page geometry — rotation,
 * spread/grid, OCR, stamps — is meaningless for them, while zoom, print and
 * fullscreen still are. One predicate so the two lists never drift apart.
 */
export function isFlowKind(kind: DocKind): boolean {
  return kind === 'eml' || kind === 'md'
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
  destroy(): void
}
