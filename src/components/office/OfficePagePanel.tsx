import { useLayoutEffect, useRef } from 'react'
import { t } from '../../i18n'

interface OfficePagePanelProps {
  count: number
  /** 1-based page at the top of the view. */
  current: number
  /** Width / height of each page, for the placeholder box until it is drawn. */
  aspect: (index: number) => number
  /**
   * The element a page is drawn from (a rendered slide, a Word section), or
   * null while it is not drawn yet. The panel shows a scaled copy.
   */
  source: (index: number) => HTMLElement | null
  /** Bumped by the view whenever more pages have been drawn. */
  version: number
  /** Marks hidden slides, as PowerPoint's own list does. */
  hidden?: (index: number) => boolean
  onPick: (page: number) => void
}

/** Width the thumbnails are drawn at, px. */
const THUMB_PX = 128

/**
 * The page list for Word and PowerPoint, styled like the PDF one.
 *
 * Thumbnails are copies of the pages already on screen, scaled down — drawing
 * a slide costs up to ~650 ms, so rendering it a second time just for a
 * thumbnail would double the wait. A copy is made once per page, when its
 * source first exists.
 */
export function OfficePagePanel({ count, current, aspect, source, version, hidden, onPick }: OfficePagePanelProps) {
  const boxes = useRef<Array<HTMLDivElement | null>>([])
  const listRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    for (let i = 0; i < count; i++) {
      const box = boxes.current[i]
      if (!box || box.dataset.filled) continue
      const src = source(i)
      if (!src) continue
      // The computed width, not offsetWidth: Word pages sit under a CSS
      // `zoom`, and the copy must be scaled from the page's own size.
      const width = parseFloat(getComputedStyle(src).width) || src.offsetWidth
      if (!width) continue
      const copy = src.cloneNode(true) as HTMLElement
      // Inert: no links, no focus, nothing for find or a screen reader.
      copy.setAttribute('inert', '')
      copy.setAttribute('aria-hidden', 'true')
      copy.style.transform = `scale(${THUMB_PX / width})`
      copy.style.transformOrigin = 'top left'
      copy.style.margin = '0'
      copy.style.boxShadow = 'none'
      box.replaceChildren(copy)
      box.dataset.filled = '1'
    }
  }, [count, source, version])

  // Keep the current page in sight in the list as the document scrolls.
  useLayoutEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-page="${current}"]`)
    item?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <nav
      aria-label={t('panel.title')}
      className="flex w-44 shrink-0 flex-col border-r border-gray-700 bg-gray-900 select-none"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-gray-700 px-3 py-2">
        <span className="text-xs font-semibold text-gray-300">{t('panel.title')}</span>
        <span className="text-[11px] text-gray-400">{t('panel.count', { n: count })}</span>
      </div>
      <div ref={listRef} className="flex flex-1 flex-col items-center gap-2 overflow-y-auto px-1.5 py-2">
        {Array.from({ length: count }, (_, i) => {
          const page = i + 1
          const isCurrent = page === current
          return (
            <button
              key={i}
              type="button"
              data-page={page}
              onClick={() => onPick(page)}
              aria-current={isCurrent ? 'page' : undefined}
              aria-label={t('panel.thumbAlt', { n: page })}
              className={[
                'flex flex-col items-center gap-1 rounded p-1 transition-all',
                isCurrent ? 'bg-blue-600/30 ring-2 ring-blue-500' : 'hover:bg-gray-800',
                hidden?.(i) ? 'opacity-50' : '',
              ].filter(Boolean).join(' ')}
            >
              <div
                ref={el => { boxes.current[i] = el }}
                className="pointer-events-none relative overflow-hidden rounded bg-white shadow-sm"
                style={{ width: THUMB_PX, height: Math.round(THUMB_PX / (aspect(i) || 0.75)) }}
              />
              <span className={`text-[11px] tabular-nums ${isCurrent ? 'font-medium text-blue-400' : 'text-gray-400'}`}>
                {page}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
