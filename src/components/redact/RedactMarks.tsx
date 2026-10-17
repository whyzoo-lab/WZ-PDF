import { memo } from 'react'
import type { RedactAnnotation } from '../../types/annotation'

/**
 * Areas marked for redaction and not yet applied: a dark veil with a red
 * edge, so it reads as "this will go" rather than as already gone. Drawn on
 * the unrotated page; a click finds a mark by position (PdfPage).
 */
export const RedactMarks = memo(function RedactMarks({ marks, selectedId, scale, width, height }: {
  marks: RedactAnnotation[]
  selectedId: string | null
  scale: number
  width: number
  height: number
}) {
  if (marks.length === 0) return null
  return (
    <div className="no-print pointer-events-none absolute left-0 top-0" style={{ width, height }} data-wz-redact-marks="">
      {marks.flatMap(m => m.rects.map((r, i) => (
        <div key={`${m.id}:${i}`} className="absolute"
          style={{
            left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale,
            background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.42) 0 6px, rgba(0,0,0,0.30) 6px 12px)',
            outline: m.id === selectedId ? '2px solid #2563eb' : '1.5px solid #dc2626',
          }} />
      )))}
    </div>
  )
})
