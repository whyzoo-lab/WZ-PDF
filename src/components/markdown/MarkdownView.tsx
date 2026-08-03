import { useEffect, useMemo, useState } from 'react'
import { renderMarkdown, type RenderedMarkdown } from '../../services/markdownDoc'
import { t } from '../../i18n'

interface MarkdownViewProps {
  /** Raw Markdown source. */
  source: string
  /** File name, used as a heading when the document has no title of its own. */
  filename: string
}

/** Long documents get a contents rail; short ones would just look cluttered. */
const OUTLINE_MIN_HEADINGS = 3

/**
 * Reads a Markdown file as a document.
 *
 * Like mail, this sits outside the Konva/page pipeline: Markdown reflows and has
 * no page geometry, so rendering it to a canvas would trade away selectable,
 * searchable text for nothing.
 */
export function MarkdownView({ source, filename }: MarkdownViewProps) {
  // The rendered result is stored together with the source it came from, so a
  // source change reads as "not ready yet" without a synchronous setState in
  // the effect (which would risk a cascading render).
  const [result, setResult] = useState<
    { src: string; doc: RenderedMarkdown | null } | null
  >(null)

  useEffect(() => {
    let cancelled = false
    renderMarkdown(source)
      .then(r => { if (!cancelled) setResult({ src: source, doc: r }) })
      .catch(err => {
        console.error('Markdown render failed:', err)
        if (!cancelled) setResult({ src: source, doc: null })
      })
    return () => { cancelled = true }
  }, [source])

  const current = result && result.src === source ? result : null
  const doc = current?.doc ?? null
  const failed = current !== null && current.doc === null

  // Only show headings deep enough to be useful; H4+ makes the rail noisy.
  const outline = useMemo(
    () => (doc?.outline ?? []).filter(o => o.level <= 3),
    [doc],
  )
  const showOutline = outline.length >= OUTLINE_MIN_HEADINGS

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

  return (
    <div className="h-full overflow-auto bg-gray-300 py-6 px-4">
      <div className="mx-auto flex max-w-5xl items-start gap-6">
        {showOutline && (
          // Sticky so it stays with you on a long file; hidden on narrow
          // screens, where the body needs the whole width.
          <nav className="hidden lg:block sticky top-0 w-56 shrink-0 py-2" aria-label={t('md.contents')}>
            <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              {t('md.contents')}
            </p>
            <ul className="space-y-0.5 text-sm">
              {outline.map(o => (
                <li key={o.id} style={{ paddingLeft: (o.level - 1) * 10 }}>
                  <a
                    href={`#${o.id}`}
                    className="block truncate rounded px-2 py-1 text-gray-700 hover:bg-white/60 hover:text-gray-900"
                    title={o.text}
                  >
                    {o.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <article className="min-w-0 flex-1 bg-white shadow-xl rounded-sm">
          {/* The file name is only worth showing when it isn't already the
              document's own H1 — otherwise it reads as a duplicate title. */}
          {!doc.title && (
            <header className="border-b border-gray-200 px-8 pt-7 pb-4">
              <h1 className="text-xl font-semibold text-gray-900 break-words">{filename}</h1>
            </header>
          )}
          <div
            className="wz-md-body px-8 py-7 text-[15px] leading-7 text-gray-900"
            // Sanitized in services/markdownDoc.ts — see that module for what is
            // stripped and why images are allowed here but not in mail.
            dangerouslySetInnerHTML={{ __html: doc.html }}
          />
        </article>
      </div>
    </div>
  )
}
