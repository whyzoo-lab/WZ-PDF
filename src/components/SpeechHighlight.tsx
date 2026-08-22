import type { SpeechRect } from '../hooks/useSpeechHighlight'

/**
 * The highlighter over the sentence being read.
 *
 * Drawn as an overlay rather than by styling the document, because on a page
 * document the text under the highlight is an invisible stand-in for glyphs
 * painted on a canvas — see useSpeechHighlight for why its metrics cannot be
 * trusted. Painting our own rectangles from the *boxes* keeps the band on the
 * words, and leaves both the sanitized mail/Markdown body and pdfjs's
 * positioned spans untouched.
 *
 * Translucent and drawn on top, like a real highlighter: the glyphs stay
 * legible through it, so it does not matter that it is not behind them.
 */
export function SpeechHighlight({ rects }: { rects: readonly SpeechRect[] }) {
  if (rects.length === 0) return null
  return (
    <div className="no-print fixed inset-0 z-30 pointer-events-none" aria-hidden="true">
      {rects.map((r, i) => (
        <div
          key={i}
          className="absolute rounded-[2px]"
          style={{
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            // A distinct hue from find's amber, so the two never read as the
            // same thing when both are on screen, and soft: this one moves by
            // itself every few seconds.
            backgroundColor: 'rgba(59, 130, 246, 0.28)',
          }}
        />
      ))}
    </div>
  )
}
