// The document's outline (bookmarks) in the page panel.
//
// After PdfCraft's bookmarks panel (Apache-2.0/MIT): a filter that keeps the
// parents of every match visible, expand / collapse all, and the entry the
// reader is in marked and kept in view. Top-level entries start open, deeper
// ones closed.

import { useEffect, useMemo, useRef, useState } from 'react'
import { currentOutlineId, flattenOutline, type OutlineNode } from '../../services/pdfOutline'
import { t } from '../../i18n'

const fold = (s: string) => s.normalize('NFC').toLowerCase()

export function OutlineView({ nodes, currentPage, onGo }: {
  nodes: OutlineNode[]
  currentPage: number
  onGo: (page: number) => void
}) {
  const flat = useMemo(() => flattenOutline(nodes), [nodes])
  // Collapsed ids; top level open by default (closed = has children and depth ≥ 1).
  const [closed, setClosed] = useState<Set<string>>(() => new Set(flat.filter(f => f.depth >= 1 && f.node.children.length).map(f => f.id)))
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLUListElement>(null)
  const current = useMemo(() => currentOutlineId(nodes, currentPage), [nodes, currentPage])

  // Filtering: an entry shows when it matches or something under it does;
  // while filtering everything on the way to a match is open.
  const visible = useMemo(() => {
    const q = fold(query.trim())
    const shown = new Set<string>()
    if (q) {
      for (const { id, node } of flat) {
        if (!fold(node.title).includes(q)) continue
        const parts = id.split('.')
        for (let i = 1; i <= parts.length; i++) shown.add(parts.slice(0, i).join('.'))
      }
    }
    return flat.filter(({ id }) => {
      if (q) return shown.has(id)
      // Hidden when any ancestor is closed.
      const parts = id.split('.')
      for (let i = 1; i < parts.length; i++) if (closed.has(parts.slice(0, i).join('.'))) return false
      return true
    })
  }, [flat, closed, query])

  useEffect(() => {
    if (!current) return
    listRef.current?.querySelector<HTMLElement>(`[data-outline="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  const toggle = (id: string) => setClosed(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const expandAll = () => setClosed(new Set())
  const collapseAll = () => setClosed(new Set(flat.filter(f => f.node.children.length).map(f => f.id)))

  const go = (node: OutlineNode) => {
    if (node.page !== null) onGo(node.page)
    else if (node.url && /^https?:/i.test(node.url)) window.open(node.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-gray-700 px-2 py-1.5">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('outline.filter')}
          aria-label={t('outline.filter')}
          className="min-w-0 flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-100 outline-none placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500"
          spellCheck={false}
        />
        <button type="button" onClick={expandAll} title={t('outline.expandAll')} aria-label={t('outline.expandAll')}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-700 hover:text-white">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><path d="M6 8l4-4 4 4M6 12l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" onClick={collapseAll} title={t('outline.collapseAll')} aria-label={t('outline.collapseAll')}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-700 hover:text-white">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5"><path d="M6 4l4 4 4-4M6 16l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <ul ref={listRef} role="tree" aria-label={t('outline.title')} className="min-h-0 flex-1 overflow-y-auto py-1">
        {visible.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">{t('outline.none')}</li>}
        {visible.map(({ id, node, depth }) => {
          const open = query.trim() ? true : !closed.has(id)
          const here = id === current
          return (
            <li key={id} role="treeitem" aria-level={depth + 1} aria-expanded={node.children.length ? open : undefined} aria-selected={here}>
              <div
                data-outline={id}
                className={`group flex items-center gap-0.5 pr-2 text-xs ${here ? 'bg-blue-600/25 text-white' : 'text-gray-300 hover:bg-white/5'}`}
                style={{ paddingLeft: 4 + depth * 12 }}
              >
                {node.children.length > 0 ? (
                  <button type="button" onClick={() => toggle(id)} aria-label={open ? t('outline.collapse') : t('outline.expand')}
                    className="flex h-6 w-5 shrink-0 items-center justify-center text-gray-500 hover:text-white">
                    <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}><path d="M7 5l6 5-6 5z" /></svg>
                  </button>
                ) : <span className="w-5 shrink-0" />}
                <button
                  type="button"
                  onClick={() => go(node)}
                  title={node.title}
                  className={`min-w-0 flex-1 truncate py-1 text-left ${node.bold ? 'font-semibold' : ''} ${node.italic ? 'italic' : ''} ${node.page === null && !node.url ? 'cursor-default text-gray-500' : ''}`}
                >{node.title}</button>
                {node.page !== null && <span className="shrink-0 pl-1 text-[10px] tabular-nums text-gray-500">{node.page}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
