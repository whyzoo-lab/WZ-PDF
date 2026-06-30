import { useState, useRef, useEffect, useCallback } from 'react'
import type { OcrWord } from '../../types/ocr'
import type { TextLayerHighlight, TextEditCommit } from './PdfTextLayer'

interface OcrTextLayerProps {
  words: OcrWord[]
  /** Effective display scale (PDF_RENDER_SCALE * zoom). */
  scale: number
  width: number
  height: number
  highlights?: TextLayerHighlight[]
  /** When provided (editor mode), double-clicking a recognized region opens an
   *  inline editor; committing fires this with the new text and the region's
   *  bounds (already in PDF points). Omit to keep the layer selection-only. */
  onEditCommit?: (edit: TextEditCommit) => void
  /** Play the staggered reveal flash on mount. True for OCR (signals recognition
   *  finished); pass false for always-present native text (e.g. HWP) so it doesn't
   *  flash on every page scroll. Default true. */
  reveal?: boolean
}

/**
 * Transparent, positioned text overlay built from OCR words. Mirrors
 * PdfTextLayer's contract: one <span> per item, in order, so highlight item
 * indices map to span indices. Spans are selectable/copyable; text is
 * transparent so only the painted canvas underneath is visible.
 *
 * Editor mode: when `onEditCommit` is set, double-clicking a recognized region
 * swaps it for an inline <input>. Because OCR words already carry PDF-point
 * bounds, the commit passes them straight through (no CSS→PDF conversion).
 */
export function OcrTextLayer({ words, scale, width, height, highlights, onEditCommit, reveal = true }: OcrTextLayerProps) {
  const activeSet = new Set<number>()
  const hlSet = new Set<number>()
  for (const h of highlights ?? []) {
    for (let i = h.itemStart; i <= h.itemEnd; i++) {
      hlSet.add(i)
      if (h.active) activeSet.add(i)
    }
  }

  const [editing, setEditing] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus + select-all when the inline editor opens.
  useEffect(() => {
    if (editing === null) return
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true })
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [editing])

  const commit = useCallback(() => {
    if (editing === null || !onEditCommit) { setEditing(null); return }
    const w = words[editing]
    const newText = inputRef.current?.value ?? ''
    if (w && newText && newText !== w.text) {
      onEditCommit({
        text: newText,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        fontSize: w.height * 0.85, // OCR box height ≈ glyph height + a little leading
      })
    }
    setEditing(null)
  }, [editing, onEditCommit, words])

  const cancel = useCallback(() => setEditing(null), [])
  const editable = !!onEditCommit

  return (
    <div
      className="pdf-text-layer no-print"
      style={{ position: 'absolute', top: 0, left: 0, width, height, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {words.map((w, i) => {
        const cls = ['wz-ocr-span']
        if (editable) cls.push('wz-ocr-editable')
        if (hlSet.has(i)) cls.push('wz-search-hl')
        if (activeSet.has(i)) cls.push('wz-search-hl-active')
        // One-shot reveal flash that plays when the layer first mounts (i.e.
        // right after recognition completes), staggered so the regions light up
        // in reading order. Capped so large pages still finish quickly. Skipped
        // for always-present native text (HWP) so it doesn't flash on scroll.
        if (reveal) cls.push('wz-ocr-reveal')
        return (
          <span
            key={i}
            className={cls.join(' ')}
            onDoubleClick={editable ? (e) => { e.preventDefault(); e.stopPropagation(); setEditing(i) } : undefined}
            style={{
              position: 'absolute',
              left: w.x * scale,
              top: w.y * scale,
              width: w.width * scale,
              height: w.height * scale,
              fontSize: w.height * scale,
              lineHeight: 1,
              color: 'transparent',
              whiteSpace: 'pre',
              cursor: editable ? 'text' : 'text',
              pointerEvents: 'auto',
              userSelect: 'text',
              animationDelay: `${Math.min(i * 0.04, 0.6)}s`,
            }}
          >
            {w.text}
          </span>
        )
      })}

      {editing !== null && words[editing] && (
        <input
          ref={inputRef}
          type="text"
          defaultValue={words[editing].text}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            else if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          onBlur={commit}
          spellCheck={false}
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: words[editing].x * scale,
            top: words[editing].y * scale,
            width: Math.max(words[editing].width * scale, 80),
            height: Math.max(words[editing].height * scale, 24),
            fontSize: words[editing].height * scale * 0.9,
            lineHeight: 1,
            padding: '1px 3px',
            margin: 0,
            border: '2px solid #38bdf8',
            borderRadius: 2,
            background: 'rgba(255,255,255,0.98)',
            color: '#000',
            outline: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            pointerEvents: 'auto',
            fontFamily: 'sans-serif',
            zIndex: 10,
          }}
        />
      )}
    </div>
  )
}
