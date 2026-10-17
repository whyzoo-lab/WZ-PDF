import { memo } from 'react'
import type { CompareMark } from './compareContext'

const FILL = { inserted: 'rgba(34, 197, 94, 0.30)', replaced: 'rgba(245, 158, 11, 0.35)', deleted: 'rgba(239, 68, 68, 0.9)' }

/**
 * What changed, on one page of the open document: added and replaced words
 * tinted, and a red bar where words were deleted. Drawn on the unrotated page
 * (inside PdfPage's turned box), never taking the pointer.
 */
export const CompareMarks = memo(function CompareMarks({ marks, active, scale, width, height }: {
  marks: CompareMark[]
  active: number | null
  /** CSS px per PDF point. */
  scale: number
  width: number
  height: number
}) {
  if (marks.length === 0) return null
  return (
    <div className="no-print pointer-events-none absolute left-0 top-0" style={{ width, height }} data-wz-compare-marks="">
      {marks.flatMap(m => {
        const ring = m.index === active ? { outline: '2px solid #2563eb', outlineOffset: 1 } : null
        if (m.kind === 'deleted') {
          const n = m.near
          if (!n) return []
          return [<div key={`${m.index}`} data-wz-compare={m.index} className="absolute rounded-sm"
            style={{ left: n.x * scale - 2, top: n.y * scale, width: 3, height: n.height * scale, background: FILL.deleted, ...ring }} />]
        }
        return m.rects.map((r, i) => (
          <div key={`${m.index}:${i}`} data-wz-compare={m.index} className="absolute"
            style={{ left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale, background: FILL[m.kind], mixBlendMode: 'multiply', ...ring }} />
        ))
      })}
    </div>
  )
})
