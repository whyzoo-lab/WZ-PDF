import { useEffect, useMemo, useRef, useState } from 'react'
import type { Annotation, CommentAnnotation } from '../../types/annotation'
import { isTextMarkup } from '../../types/annotation'
import { CommentBody, CommentHeader } from './CommentBody'
import { commentMatches, sortComments } from './commentFormat'
import { t } from '../../i18n'

type Filter = 'all' | 'open' | 'done'

/**
 * Every comment of the document in the page panel: by page, searchable,
 * filtered by status, the selected one open with its thread. After PdfCraft's
 * comments panel (Apache-2.0/MIT) and Acrobat's.
 */
export function CommentsPanel({ comments, selectedId, canEdit, author, onAuthorChange, onGo, onUpdate, onRemove }: {
  comments: CommentAnnotation[]
  selectedId: string | null
  canEdit: boolean
  author: string
  onAuthorChange: (name: string) => void
  /** Show it: scroll to its page and select it. */
  onGo: (a: CommentAnnotation) => void
  onUpdate: (id: string, updates: Partial<Annotation>) => void
  onRemove: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const listRef = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => sortComments(comments).filter(a =>
    (filter === 'all' || (filter === 'done') === !!a.done) && commentMatches(a, query),
  ), [comments, filter, query])

  const pages = useMemo(() => {
    const out: { page: number; items: CommentAnnotation[] }[] = []
    for (const a of shown) {
      const last = out[out.length - 1]
      if (last && last.page === a.page) last.items.push(a)
      else out.push({ page: a.page, items: [a] })
    }
    return out
  }, [shown])

  // The comment opened on the page comes into view here too.
  useEffect(() => {
    if (!selectedId) return
    listRef.current?.querySelector<HTMLElement>(`[data-comment="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const [nameDraft, setNameDraft] = useState<{ from: string; value: string }>({ from: author, value: author })
  const name = nameDraft.from === author ? nameDraft.value : author

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-1.5 border-b border-gray-700 px-2 py-1.5">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('comment.search')}
          aria-label={t('comment.search')}
          className="wz-compact-input min-w-0 rounded bg-gray-800 px-2 py-1 text-xs text-gray-100 outline-none placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500"
          spellCheck={false}
        />
        <div role="radiogroup" aria-label={t('comment.filter')} className="flex items-center gap-0.5 rounded-md bg-gray-800 p-0.5">
          {(['all', 'open', 'done'] as const).map(f => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}
              className={`flex-1 rounded px-1.5 py-0.5 text-[11px] ${filter === f ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              {t(`comment.filter.${f}`)}
            </button>
          ))}
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {comments.length === 0 ? (
          <p className="px-1 py-4 text-center text-[11px] leading-relaxed text-gray-400 break-keep">{t(canEdit ? 'comment.noneEditing' : 'comment.none')}</p>
        ) : shown.length === 0 ? (
          <p className="px-1 py-4 text-center text-[11px] text-gray-400">{t('comment.noMatch')}</p>
        ) : pages.map(group => (
          <section key={group.page} className="mb-3" aria-label={t('comment.page', { n: group.page })}>
            <h3 className="mb-1 px-1 text-[11px] font-semibold text-gray-400">{t('comment.page', { n: group.page })}</h3>
            <ul className="flex flex-col gap-1.5">
              {group.items.map(a => {
                const open = a.id === selectedId
                return (
                  <li key={a.id} data-comment={a.id}
                    className={`rounded-md border bg-white p-2 dark:bg-gray-800 ${open ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300 dark:border-gray-600'} ${a.done && !open ? 'opacity-60' : ''}`}>
                    <button type="button" onClick={() => onGo(a)} aria-expanded={open}
                      className="block w-full text-left">
                      <CommentHeader a={a} />
                      {!open && (
                        <p className="mt-1 line-clamp-2 break-words text-xs leading-snug text-gray-800 dark:text-gray-100">
                          {a.contents || (isTextMarkup(a) ? <span className="text-gray-500 dark:text-gray-400">“{a.text}”</span> : <span className="text-gray-400">{t('comment.empty')}</span>)}
                        </p>
                      )}
                      {!open && a.replies.length > 0 && (
                        <p className="mt-1 text-[11px] text-blue-600 dark:text-blue-400">{t('comment.replyCount', { n: a.replies.length })}</p>
                      )}
                    </button>
                    {open && (
                      <div className="mt-2">
                        <CommentBody key={a.id} a={a} canEdit={canEdit} author={author} onUpdate={onUpdate} onRemove={onRemove} />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      {canEdit && (
        <label className="flex items-center gap-2 border-t border-gray-700 px-2 py-1.5 text-[11px] text-gray-400">
          <span className="shrink-0">{t('comment.author')}</span>
          <input
            value={name}
            onChange={e => setNameDraft({ from: author, value: e.target.value })}
            onBlur={() => { if (name.trim() !== author) onAuthorChange(name) }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            placeholder={t('comment.anonymous')}
            className="wz-compact-input min-w-0 flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-100 outline-none focus:ring-1 focus:ring-blue-500"
            spellCheck={false}
            maxLength={64}
          />
        </label>
      )}
    </div>
  )
}
