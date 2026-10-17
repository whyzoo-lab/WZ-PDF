import type { CommentAnnotation } from '../../types/annotation'
import { isTextMarkup } from '../../types/annotation'
import { LANG, t } from '../../i18n'

export function commentTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString(LANG === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ')
  }
}

export function commentKindLabel(a: Pick<CommentAnnotation, 'type'>): string {
  return t(`comment.kind.${a.type}`)
}

export const authorOf = (name: string): string => name || t('comment.anonymous')

const fold = (s: string) => s.normalize('NFC').toLowerCase()

/** Document order: page, then down the page, then across. */
export function sortComments(list: CommentAnnotation[]): CommentAnnotation[] {
  const top = (a: CommentAnnotation) => (isTextMarkup(a) && a.rects.length ? Math.min(...a.rects.map(r => r.y)) : a.y)
  return [...list].sort((a, b) => a.page - b.page || top(a) - top(b) || a.x - b.x)
}

/** Whether a comment matches the search: what it says, the text it marks, its thread, who wrote it. */
export function commentMatches(a: CommentAnnotation, query: string): boolean {
  const q = fold(query.trim())
  if (!q) return true
  const fields = [a.contents, a.author, isTextMarkup(a) ? a.text : '', ...a.replies.flatMap(r => [r.contents, r.author])]
  return fields.some(f => fold(f).includes(q))
}

/** The time now, ms — kept out of components (the React compiler lint flags Date.now in them). */
export const now = (): number => Date.now()
