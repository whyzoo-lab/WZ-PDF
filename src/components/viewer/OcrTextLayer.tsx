import type { OcrWord } from '../../types/ocr'
import type { TextLayerHighlight } from './PdfTextLayer'

interface OcrTextLayerProps {
  words: OcrWord[]
  /** Effective display scale (PDF_RENDER_SCALE * zoom). */
  scale: number
  width: number
  height: number
  highlights?: TextLayerHighlight[]
}

/**
 * Transparent, positioned text overlay built from OCR words. Mirrors
 * PdfTextLayer's contract: one <span> per item, in order, so highlight item
 * indices map to span indices. Spans are selectable/copyable; text is
 * transparent so only the painted canvas underneath is visible.
 */
export function OcrTextLayer({ words, scale, width, height, highlights }: OcrTextLayerProps) {
  const activeSet = new Set<number>()
  const hlSet = new Set<number>()
  for (const h of highlights ?? []) {
    for (let i = h.itemStart; i <= h.itemEnd; i++) {
      hlSet.add(i)
      if (h.active) activeSet.add(i)
    }
  }

  return (
    <div
      className="pdf-text-layer no-print"
      style={{ position: 'absolute', top: 0, left: 0, width, height, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {words.map((w, i) => {
        const cls = ['wz-ocr-span']
        if (hlSet.has(i)) cls.push('wz-search-hl')
        if (activeSet.has(i)) cls.push('wz-search-hl-active')
        return (
          <span
            key={i}
            className={cls.join(' ')}
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
              cursor: 'text',
              pointerEvents: 'auto',
              userSelect: 'text',
            }}
          >
            {w.text}
          </span>
        )
      })}
    </div>
  )
}
