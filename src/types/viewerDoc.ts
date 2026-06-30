/** Which engine produced the document. */
export type DocKind = 'pdf' | 'hwp'

export interface ViewerViewport { width: number; height: number; scale: number }

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
  destroy(): void
}
