import type { ViewerDoc } from '../types/viewerDoc'
import { PDF_RENDER_SCALE } from './constants'

/** US Letter, in points — the guess for a document that offers none. */
const LETTER = { width: 612, height: 792 }

/**
 * The on-screen size of a page that is not drawn yet: the document's own
 * guess when it has one (image collections), US Letter otherwise. Shared by
 * the unmounted placeholder and the "rendering…" box, so a page does not
 * change size between the two and once more when it is drawn.
 */
export function pagePlaceholder(doc: ViewerDoc, page: number, zoom: number, rotation = 0): { width: number; height: number } {
  const size = doc.pageSizeHint?.(page) ?? LETTER
  const k = PDF_RENDER_SCALE * zoom
  const turned = rotation === 90 || rotation === 270
  return { width: (turned ? size.height : size.width) * k, height: (turned ? size.width : size.height) * k }
}
