import { memo } from 'react'
import type { TextMarkupAnnotation } from '../../types/annotation'

/**
 * Highlights, underlines and strike-throughs of one page, drawn in the page's
 * unrotated space (inside PdfPage's rotated box) as plain elements over the
 * page picture. A highlight is blended with `multiply`, as it is saved, so
 * the text under it stays black. Never takes the pointer: selecting text
 * through a highlight has to work, and clicks find a comment by position
 * (PdfPage).
 */
export const CommentMarks = memo(function CommentMarks({ markups, scale, selectedId, width, height }: {
  markups: TextMarkupAnnotation[]
  /** CSS px per PDF point (effectiveZoom). */
  scale: number
  selectedId: string | null
  width: number
  height: number
}) {
  if (markups.length === 0) return null
  return (
    <div className="no-print pointer-events-none absolute left-0 top-0" style={{ width, height }} data-wz-comment-marks="">
      {markups.map(a => a.rects.map((r, i) => {
        const box = { left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale }
        const selected = a.id === selectedId
        const outline = selected ? { outline: '1.5px solid #2563eb', outlineOffset: 1 } : null
        if (a.type === 'highlight') {
          return <div key={`${a.id}:${i}`} className="absolute" style={{ ...box, background: a.color, mixBlendMode: 'multiply', ...outline }} />
        }
        const thickness = Math.max(1, r.height * 0.07 * scale)
        const at = r.height * (a.type === 'underline' ? 0.9 : 0.55) * scale
        return (
          <div key={`${a.id}:${i}`} className="absolute" style={{ ...box, ...outline }}>
            <div className="absolute left-0 right-0" style={{ top: at - thickness / 2, height: thickness, background: a.color }} />
          </div>
        )
      }))}
    </div>
  )
})
