import type { PdfJob } from '../../services/officePdf'
import type { ViewMode } from '../../types/viewModes'

/**
 * What an Office view offers the app, so the toolbar's viewer controls —
 * fit width, page navigation, PDF save — work for Word, PowerPoint and
 * spreadsheets the way they do for a PDF. Filled in by the view through
 * `handleRef`; null while nothing is loaded.
 */
export interface OfficeViewHandle {
  /** The zoom at which the document fills the view's width; null when it cannot say. */
  fitWidth(): number | null
  /** Scroll page `page` (1-based) into view. */
  goTo(page: number): void
  /** The document laid out for a PDF (see services/officePdf.ts). */
  pdfJob(): Promise<PdfJob>
  /**
   * What read-aloud should read, when the view knows better than its visible
   * text: a deck's speaker notes, from the slide on screen on. Null to read
   * what is on screen.
   */
  speechText?(): string | null
}

export interface OfficePageInfo {
  /** Pages (Word) or slides (PowerPoint). */
  count: number
  /** The one at the top of the view, 1-based. */
  current: number
  /** A deck with speaker notes (the presentation script). */
  hasNotes?: boolean
}

/** Props every Office view takes from the app besides its bytes. */
export interface OfficeViewProps {
  zoom: number
  fullscreen: boolean
  onExitFullscreen: () => void
  /** single / spread / grid, as for a PDF (fullscreen is `fullscreen`). */
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  /** Whether the page list is open on the left. */
  panelOpen: boolean
  handleRef: { current: OfficeViewHandle | null }
  /** Page count and current page, for the toolbar's counter. */
  onPageInfo?: (info: OfficePageInfo | null) => void
  /** Show a deck's speaker notes under each slide. */
  showNotes?: boolean
  /** Page (slide) the slideshow opens on, 1-based: 1 for F5, the one in view for Alt+F5. */
  fullscreenStartPage?: number
}

/** Gap between pages in the two-page and all-pages layouts, px. */
export const PAGE_GAP_PX = 24
/** Side gutter around the pages, px. */
export const GUTTER_PX = 48
/** Width of one page in the all-pages layout, px. */
export const GRID_PAGE_PX = 240
