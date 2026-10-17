import { createContext } from 'react'

/**
 * What a page needs to show and change comments beyond the annotation props it
 * already gets — kept in context rather than threaded through PdfViewer,
 * SpreadView, LazyPdfPage and FullscreenView.
 */
export interface CommentActions {
  /** Name for new comments and replies. */
  author: string
  /** Whether comments can be changed (editing is on). */
  canEdit: boolean
  remove: (id: string) => void
}

export const CommentContext = createContext<CommentActions>({ author: '', canEdit: false, remove: () => {} })
