// Reads the comments a PDF already has into the app once it opens (see
// services/pdfCommentImport). The pages hide them from their pictures on
// their own; this brings them back as editable comments.

import { useEffect, useRef, useState } from 'react'
import type { ViewerDoc, DocKind } from '../types/viewerDoc'
import type { Annotation, CommentAnnotation } from '../types/annotation'
import { isComment } from '../types/annotation'

export interface CommentImport {
  /** The file's annotation objects the comments stand for — replaced on save. */
  refs: ReadonlySet<string>
  /** How many comments came from the file (to tell when one was deleted). */
  total: number
}

const NONE: CommentImport = { refs: new Set(), total: 0 }

/**
 * @param add  Receives the comments read; the caller adds them without making
 *             the document unsaved.
 * @param session  Changes when another document is opened. Within one session
 *             a reload (a page edit, or undoing one) imports nothing twice —
 *             and does not bring back a comment the reader deleted.
 */
export function useCommentImport(
  pdfDoc: ViewerDoc | null,
  kind: DocKind,
  numPages: number,
  annotations: Annotation[],
  add: (comments: CommentAnnotation[]) => void,
  session: unknown,
): CommentImport {
  const [state, setState] = useState<{ doc: ViewerDoc | null; value: CommentImport }>({ doc: null, value: NONE })
  // Per document session (a tab keeps its own while another is in front).
  const seen = useRef(new WeakMap<object, Set<string>>())
  const annotationsRef = useRef(annotations)
  const addRef = useRef(add)
  useEffect(() => { annotationsRef.current = annotations; addRef.current = add })

  useEffect(() => {
    if (!pdfDoc || kind !== 'pdf' || numPages < 1) return
    let cancelled = false
    void (async () => {
      const { importComments, markPristine } = await import('../services/pdfCommentImport')
      const got = await importComments(pdfDoc, numPages, () => cancelled)
      if (cancelled || !got) return
      const owner = (session && typeof session === 'object' ? session : seen) as object
      let keys = seen.current.get(owner)
      if (!keys) { keys = new Set(); seen.current.set(owner, keys) }
      // Comments already here (restored after a crash, or kept through a page edit).
      for (const a of annotationsRef.current) if (isComment(a) && a.importKey) keys.add(a.importKey)
      const fresh: CommentAnnotation[] = []
      for (const c of got.comments) {
        if (c.importKey && keys.has(c.importKey)) continue
        if (c.importKey) keys.add(c.importKey)
        const a = { ...c, id: crypto.randomUUID() } as CommentAnnotation
        markPristine(a)
        fresh.push(a)
      }
      setState({ doc: pdfDoc, value: { refs: new Set(got.refs), total: got.comments.length } })
      if (fresh.length > 0) addRef.current(fresh)
    })()
    return () => { cancelled = true }
  }, [pdfDoc, kind, numPages, session])

  return state.doc === pdfDoc ? state.value : NONE
}
