import { useEffect, useRef, useState } from 'react'
import type { Annotation, CommentAnnotation, CommentReply } from '../../types/annotation'
import { COMMENT_SWATCHES } from '../../types/annotation'
import { t } from '../../i18n'
import { useDraftCommit } from '../../hooks/useDraftCommit'
import { authorOf, commentKindLabel, commentTime, now } from './commentFormat'

/**
 * A comment and its thread: what it says (editable while editing), the
 * answers, a box to answer, its colour, done and delete. Shared by the
 * pop-over on the page and the card in the comments panel, so the two can
 * never offer different things.
 */
export function CommentBody({ a, canEdit, author, onUpdate, onRemove, autoFocus = false, onDone }: {
  a: CommentAnnotation
  canEdit: boolean
  author: string
  onUpdate: (id: string, updates: Partial<Annotation>) => void
  onRemove: (id: string) => void
  autoFocus?: boolean
  /** Escape in a field: the caller closes (the pop-over deselects). */
  onDone?: () => void
}) {
  // Stored as the reader pauses or leaves the box (hooks/useDraftCommit):
  // every keystroke through onUpdate would be one undo step per letter.
  const { shown: draft, onChange: setDraft, flush: commit } = useDraftCommit(a.contents,
    next => onUpdate(a.id, { contents: next, modifiedAt: now() }))
  const [reply, setReply] = useState('')
  const contentsRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoFocus) contentsRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const sendReply = () => {
    const text = reply.trim()
    if (!text) return
    const r: CommentReply = { id: crypto.randomUUID(), author, contents: text, createdAt: now() }
    onUpdate(a.id, { replies: [...a.replies, r], modifiedAt: now() })
    setReply('')
  }
  function removeReply(id: string) {
    onUpdate(a.id, { replies: a.replies.filter(r => r.id !== id), modifiedAt: now() })
  }
  const keys = (e: React.KeyboardEvent, submit: () => void) => {
    e.stopPropagation()
    if (e.key === 'Escape') { submit(); onDone?.() }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
  }

  return (
    <div className="flex flex-col gap-2 text-xs text-gray-800 dark:text-gray-100">
      {a.type !== 'note' && a.text && (
        <blockquote className="line-clamp-3 border-l-2 pl-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400" style={{ borderColor: a.color }}>
          {a.text}
        </blockquote>
      )}
      {canEdit ? (
        <textarea
          ref={contentsRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => keys(e, commit)}
          placeholder={t('comment.placeholder')}
          aria-label={t('comment.contents')}
          rows={Math.min(6, Math.max(2, draft.split('\n').length))}
          className="wz-compact-input w-full resize-none rounded border border-gray-300 bg-white px-2 py-1.5 leading-snug outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800"
        />
      ) : (
        a.contents
          ? <p className="whitespace-pre-wrap break-words leading-snug">{a.contents}</p>
          : <p className="text-gray-400">{t('comment.empty')}</p>
      )}

      {a.replies.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-gray-200 pt-2 dark:border-gray-700" aria-label={t('comment.replies')}>
          {a.replies.map(r => (
            <li key={r.id} className="group">
              <div className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-200">{authorOf(r.author)}</span>
                <span>· {commentTime(r.createdAt)}</span>
                {canEdit && (
                  <button type="button" onClick={() => removeReply(r.id)} aria-label={t('comment.removeReply')} title={t('comment.removeReply')}
                    className="ml-auto rounded px-1 text-gray-400 opacity-0 hover:text-red-600 focus:opacity-100 group-hover:opacity-100">×</button>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words leading-snug">{r.contents}</p>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex items-end gap-1">
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.stopPropagation(); sendReply(); return }
              keys(e, () => {})
            }}
            placeholder={t('comment.replyPlaceholder')}
            aria-label={t('comment.reply')}
            rows={1}
            className="wz-compact-input min-w-0 flex-1 resize-none rounded border border-gray-300 bg-white px-2 py-1 leading-snug outline-none focus:border-blue-500 dark:border-gray-600 dark:bg-gray-800"
          />
          <button type="button" onClick={sendReply} disabled={!reply.trim()}
            className="shrink-0 rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500 disabled:opacity-40">{t('comment.reply')}</button>
        </div>
      )}

      {canEdit && (
        <div className="flex items-center gap-1 border-t border-gray-200 pt-2 dark:border-gray-700">
          <div className="flex items-center gap-1" role="radiogroup" aria-label={t('comment.color')}>
            {COMMENT_SWATCHES.map(c => (
              <button key={c} type="button" role="radio" aria-checked={a.color.toLowerCase() === c.toLowerCase()} aria-label={c}
                onClick={() => onUpdate(a.id, { color: c })}
                className={`h-4 w-4 rounded-full border ${a.color.toLowerCase() === c.toLowerCase() ? 'border-gray-900 ring-2 ring-blue-500 dark:border-white' : 'border-black/20'}`}
                style={{ background: c }} />
            ))}
          </div>
          <button type="button" onClick={() => onUpdate(a.id, { done: !a.done, modifiedAt: now() })} aria-pressed={!!a.done}
            className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${a.done ? 'bg-green-600 text-white' : 'text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700'}`}>
            ✓ {t('comment.done')}
          </button>
          <button type="button" onClick={() => onRemove(a.id)} title={t('comment.delete')} aria-label={t('comment.delete')}
            className="rounded px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">
            {t('comment.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

/** "김철수 · 10월 17일 오후 3:04" with the colour and kind. */
export function CommentHeader({ a }: { a: CommentAnnotation }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/20" style={{ background: a.color }} aria-hidden />
      <span className="shrink-0 font-medium text-gray-700 dark:text-gray-200">{authorOf(a.author)}</span>
      <span className="truncate">· {commentKindLabel(a)} · {commentTime(a.modifiedAt ?? a.createdAt)}</span>
      {a.done && <span className="shrink-0 rounded bg-green-600 px-1 text-[10px] text-white">{t('comment.done')}</span>}
    </div>
  )
}
