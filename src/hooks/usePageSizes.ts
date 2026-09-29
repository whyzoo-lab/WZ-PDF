import { useEffect, useState } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import type { PageSize } from '../utils/spreadLayout'

// One lookup per document, shared by every view that asks: switching between
// two-page view and a two-page presentation must not walk the pages again.
const cache = new WeakMap<ViewerDoc, Promise<PageSize[]>>()

function loadSizes(doc: ViewerDoc): Promise<PageSize[]> {
  let sizes = cache.get(doc)
  if (!sizes) {
    // getPage parses only the page dictionary — no rendering, no content
    // stream — so this stays cheap even for a document opened by byte range.
    sizes = Promise.resolve().then(() => Promise.all(Array.from({ length: doc.numPages }, (_, i) =>
      doc.getPage(i + 1).then(page => {
        const vp = page.getViewport({ scale: 1 })
        return { width: vp.width, height: vp.height }
      }),
    )))
    cache.set(doc, sizes)
    sizes.catch(() => cache.delete(doc))
  }
  return sizes
}

/**
 * Every page's size at scale 1 (including the page's own /Rotate), or null
 * until known. Only fetched while `enabled`, since single view never needs it.
 */
export function usePageSizes(doc: ViewerDoc, enabled: boolean): PageSize[] | null {
  const [state, setState] = useState<{ doc: ViewerDoc; sizes: PageSize[] } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    loadSizes(doc).then(
      sizes => { if (!cancelled) setState({ doc, sizes }) },
      err => console.error('Reading page sizes failed:', err),
    )
    return () => { cancelled = true }
  }, [doc, enabled])

  // Keyed to the document, so sizes from the previous file never leak into the
  // next one's layout while its own are loading.
  return state && state.doc === doc ? state.sizes : null
}
