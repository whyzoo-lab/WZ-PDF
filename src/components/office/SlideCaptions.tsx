import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t } from '../../i18n'

/** How long the captions button stays after the mouse stops moving. */
const BUTTON_IDLE_MS = 5000

interface SlideCaptionsProps {
  /** The speaker notes of the slide on screen; empty when it has none. */
  text: string
  on: boolean
  onToggle: () => void
}

/**
 * A deck's speaker notes in the slideshow, set as subtitles are: white on a
 * black box along the bottom of the screen. Mounted only while the slideshow
 * of a deck with notes is up, so the button starts visible each time and is
 * found without being looked for.
 *
 * C (or the button in the corner) turns them on and off. The button keeps out
 * of the way of what is presented: it shows when the mouse moves and goes
 * again after five still seconds, unless the pointer is resting on it.
 *
 * Portalled to <body> so no transform on the slideshow (the zoom spot) moves
 * either of them.
 */
export function SlideCaptions({ text, on, onToggle }: SlideCaptionsProps) {
  const [buttonShown, setButtonShown] = useState(true)
  const timer = useRef(0)
  const hovered = useRef(false)

  const wake = useCallback(() => {
    setButtonShown(true)
    window.clearTimeout(timer.current)
    if (!hovered.current) timer.current = window.setTimeout(() => setButtonShown(false), BUTTON_IDLE_MS)
  }, [])

  useEffect(() => {
    timer.current = window.setTimeout(() => setButtonShown(false), BUTTON_IDLE_MS)
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      // By position as well as by letter: with the Korean IME on, C arrives as ㅊ.
      if (e.key.toLowerCase() !== 'c' && e.code !== 'KeyC') return
      e.preventDefault()
      onToggle()
    }
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer.current)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', onKey)
    }
  }, [wake, onToggle])

  const lines = text.split('\n').filter(line => line.trim())

  return createPortal(
    <>
      {on && lines.length > 0 && (
        <div className="wz-captions" role="note" aria-label={t('office.notes')}>
          {/* One box per line, as subtitles are drawn: the background hugs the
              text instead of filling a band across the slide. */}
          {lines.map((line, n) => <p key={n}><span>{line}</span></p>)}
        </div>
      )}
      <button
        type="button"
        className={`wz-captions-toggle ${buttonShown ? '' : 'wz-captions-toggle-idle'}`}
        aria-pressed={on}
        aria-label={t('office.captionsToggle')}
        title={t('office.captionsToggle')}
        onClick={onToggle}
        onMouseEnter={() => { hovered.current = true; window.clearTimeout(timer.current); setButtonShown(true) }}
        onMouseLeave={() => { hovered.current = false; wake() }}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <path d="M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6" strokeLinecap="round" />
          {!on && <path d="M4 20 20 4" strokeLinecap="round" />}
        </svg>
      </button>
    </>,
    document.body,
  )
}
