import { useEffect, useState } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import { hasOutline, loadOutline, type OutlineNode } from '../services/pdfOutline'

/**
 * The open PDF's outline (bookmarks), pages resolved; an empty list for a
 * document without one and for every other format. Loaded once per document.
 */
export function useOutline(doc: ViewerDoc | null): OutlineNode[] {
  const [state, setState] = useState<{ doc: ViewerDoc | null; nodes: OutlineNode[] }>({ doc: null, nodes: [] })
  useEffect(() => {
    if (!doc || !hasOutline(doc)) return
    let cancelled = false
    loadOutline(doc).then(nodes => { if (!cancelled) setState({ doc, nodes }) }, () => {})
    return () => { cancelled = true }
  }, [doc])
  return state.doc === doc ? state.nodes : []
}
