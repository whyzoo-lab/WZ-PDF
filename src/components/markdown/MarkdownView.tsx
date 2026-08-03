import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { renderMarkdown, type RenderedMarkdown } from '../../services/markdownDoc'
import { pickSaveTarget, saveBlobTo } from '../../utils/download'
import { FLOW_PRINT_ATTR } from '../../services/htmlPrint'
import { ReaderFullscreen } from '../reader/ReaderFullscreen'
import type { AppMode } from '../../types/viewModes'
import { t } from '../../i18n'

interface MarkdownViewProps {
  /** Raw Markdown source as loaded from the file. */
  source: string
  /** File name, used as a heading when the document has no title of its own. */
  filename: string
  /** `editor` swaps the rendered page for the source text. */
  appMode: AppMode
  /** Display zoom — scales the type, since there is no page to scale. */
  zoom: number
  /** Present the document fullscreen instead of inside the app shell. */
  fullscreen: boolean
  /** Called when the browser leaves fullscreen, however that happened. */
  onExitFullscreen: () => void
  /** Reports a completed save so the app can show its toast. */
  onSaved: (message: string) => void
}

/** Long documents get a contents rail; short ones would just look cluttered. */
const OUTLINE_MIN_HEADINGS = 3
/** How far down the viewport a heading counts as "the section you're reading". */
const ACTIVE_OFFSET = 96
/** Body size at zoom 1; everything else in `.wz-md-body` is relative to it. */
const BASE_FONT_PX = 15

/**
 * Reads — and, unlocked, edits — a Markdown file.
 *
 * Like mail, this sits outside the Konva/page pipeline: Markdown reflows and has
 * no page geometry, so rendering it to a canvas would trade away selectable,
 * searchable text for nothing.
 */
export function MarkdownView({
  source, filename, appMode, zoom, fullscreen, onExitFullscreen, onSaved,
}: MarkdownViewProps) {
  const editing = appMode === 'editor'

  // The working copy is keyed by the source it came from, so opening a different
  // file reseeds it without an effect (and without discarding edits on a
  // re-render). Same trick as `result` below.
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null)
  const text = draft && draft.base === source ? draft.text : source
  const dirty = text !== source
  const [saving, setSaving] = useState(false)

  // Rendered output is stored with the text it came from, so a change reads as
  // "not ready yet" without a synchronous setState in the effect (which would
  // risk a cascading render).
  const [result, setResult] = useState<{ src: string; doc: RenderedMarkdown | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    renderMarkdown(text)
      .then(r => { if (!cancelled) setResult({ src: text, doc: r }) })
      .catch(err => {
        console.error('Markdown render failed:', err)
        if (!cancelled) setResult({ src: text, doc: null })
      })
    return () => { cancelled = true }
  }, [text])

  const current = result && result.src === text ? result : null
  const doc = current?.doc ?? null
  const failed = current !== null && current.doc === null

  // Only headings shallow enough to be useful; H4+ makes the rail noisy.
  const outline = useMemo(() => (doc?.outline ?? []).filter(o => o.level <= 3), [doc])
  const showOutline = !editing && outline.length >= OUTLINE_MIN_HEADINGS

  // ── Which section am I in ────────────────────────────────────────────────
  // Heading offsets are measured once per render and reused on scroll, so
  // scrolling never forces a layout pass.
  const scrollRef = useRef<HTMLDivElement>(null)
  const offsetsRef = useRef<Array<{ id: string; top: number }>>([])
  // Tagged with the outline it belongs to, so a new document falls back to its
  // own first heading instead of keeping the previous file's highlight — and
  // without an effect that would setState during render.
  const [active, setActive] = useState<{ key: string; id: string } | null>(null)
  const outlineKey = useMemo(() => outline.map(o => o.id).join('|'), [outline])
  const outlineKeyRef = useRef(outlineKey)
  const activeId = active?.key === outlineKey ? active.id : outline[0]?.id ?? null

  const measure = useCallback(() => {
    const root = scrollRef.current
    if (!root) return
    offsetsRef.current = outline
      .map(o => {
        const el = root.querySelector<HTMLElement>(`[id="${CSS.escape(o.id)}"]`)
        return el ? { id: o.id, top: el.offsetTop } : null
      })
      .filter((x): x is { id: string; top: number } => x !== null)
  }, [outline])

  useLayoutEffect(() => {
    measure()
    outlineKeyRef.current = outlineKey
  }, [measure, outlineKey])

  const handleScroll = useCallback(() => {
    const root = scrollRef.current
    if (!root) return
    const offsets = offsetsRef.current
    let id: string | null
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
      // At the bottom nothing can scroll further, so the trailing sections would
      // never light up on their own — the last heading owns the end of the file.
      id = offsets[offsets.length - 1]?.id ?? null
    } else {
      const y = root.scrollTop + ACTIVE_OFFSET
      id = offsets[0]?.id ?? null
      for (const o of offsets) {
        if (o.top <= y) id = o.id
        else break
      }
    }
    if (!id) return
    const next = { key: outlineKeyRef.current, id }
    setActive(prev => (prev?.id === id && prev.key === next.key ? prev : next))
  }, [])

  const handleSave = useCallback(async () => {
    const target = await pickSaveTarget(filename, {
      description: 'Markdown document', accept: { 'text/markdown': ['.md', '.markdown'] },
    })
    if (target.kind === 'canceled') return
    setSaving(true)
    try {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
      if (await saveBlobTo(target, blob, filename)) {
        // The buffer now matches what is on disk, so the "edited" flag clears.
        setDraft({ base: text, text })
        onSaved(t('md.saved', { name: filename }))
      }
    } catch (err) {
      console.error('Markdown save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [filename, text, onSaved])

  // ── Edit mode: the source, exactly as written ────────────────────────────
  // Checked before `failed` so a document the renderer chokes on can still be
  // opened and fixed, and before `fullscreen` so unlocking wins over presenting.
  if (editing && !fullscreen) {
    return (
      <div className="flex h-full flex-col bg-gray-300">
        <div className="flex items-center gap-3 border-b border-gray-400/50 bg-gray-200 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
            {t('md.source')}
          </span>
          {dirty && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              {t('md.unsaved')}
            </span>
          )}
          <span className="flex-1" />
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-full bg-blue-600 px-3.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {t('md.save')}
          </button>
        </div>
        <textarea
          value={text}
          onChange={e => setDraft({ base: source, text: e.target.value })}
          spellCheck={false}
          aria-label={t('md.source')}
          className="min-h-0 flex-1 resize-none bg-white px-6 py-5 font-mono text-[13px] leading-6 text-gray-900 outline-none"
        />
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-red-400">
        {t('md.renderFailed')}
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-gray-400 text-sm select-none">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
        {t('url.loading')}
      </div>
    )
  }

  const body = (
    <div
      className="wz-md-body leading-7 text-gray-900"
      // Sanitized in services/markdownDoc.ts — see that module for what is
      // stripped and why images are allowed here but not in mail.
      dangerouslySetInnerHTML={{ __html: doc.html }}
    />
  )

  // ── Presenting: one continuous document, scrolled, with the presenter tools ─
  if (fullscreen) {
    return (
      <ReaderFullscreen onExit={onExitFullscreen}>
        <div {...{ [FLOW_PRINT_ATTR]: '' }}>{body}</div>
      </ReaderFullscreen>
    )
  }

  return (
    // `relative` makes this element the headings' offsetParent, so the offsets
    // measured above are in the same coordinate space as its own scrollTop.
    <div ref={scrollRef} onScroll={handleScroll} className="relative h-full overflow-auto bg-gray-300 py-6 px-4">
      <div className="mx-auto flex max-w-5xl items-start gap-7">
        {showOutline && (
          // Sticky so it stays with you on a long file; hidden on narrow screens,
          // where the body needs the whole width.
          <nav
            className="sticky top-0 hidden w-60 shrink-0 py-1 lg:block"
            aria-label={t('md.contents')}
          >
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
              {t('md.contents')}
            </p>
            {/* One continuous hairline the items sit against, so the list reads
                as a single rail instead of scattered rows. */}
            <ul className="border-l border-gray-400/50">
              {outline.map(o => {
                const active = o.id === activeId
                return (
                  <li key={o.id}>
                    <a
                      href={`#${o.id}`}
                      title={o.text}
                      aria-current={active ? 'location' : undefined}
                      style={{ paddingLeft: 12 + (o.level - 1) * 12 }}
                      className={[
                        'block truncate py-[5px] pr-2 transition-colors',
                        // The active item owns the rail segment next to it.
                        '-ml-px border-l-2',
                        active
                          ? 'border-blue-600 font-medium text-blue-700'
                          : 'border-transparent hover:border-gray-500 hover:text-gray-900',
                        // Depth reads through weight and size, not indentation alone.
                        o.level === 1 ? 'text-[13.5px] font-medium' : 'text-[13px]',
                        active ? '' : o.level >= 3 ? 'text-gray-500' : 'text-gray-700',
                      ].join(' ')}
                    >
                      {o.text}
                    </a>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}

        <article
          className="min-w-0 flex-1 rounded-sm bg-white px-8 py-7 shadow-xl"
          // Zoom has no page to scale here, so it scales the type instead. The
          // body's own sizes are all em-based, so one declaration moves the
          // whole hierarchy together.
          style={{ fontSize: `${BASE_FONT_PX * zoom}px` }}
          {...{ [FLOW_PRINT_ATTR]: '' }}
        >
          {/* The file name is only worth showing when it isn't already the
              document's own H1 — otherwise it reads as a duplicate title. */}
          {!doc.title && (
            <header className="mb-5 border-b border-gray-200 pb-4">
              <h1 className="text-xl font-semibold text-gray-900 break-words">{filename}</h1>
            </header>
          )}
          {body}
        </article>
      </div>
    </div>
  )
}
