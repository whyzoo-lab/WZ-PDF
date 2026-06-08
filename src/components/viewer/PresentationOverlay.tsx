import { useRef, useState, useEffect } from 'react'
import type { PresentStroke, PresentToolState } from '../../types/present'
import { arrowHead, isDrawingTool } from '../../utils/presentTools'

interface PresentationOverlayProps {
  strokes: PresentStroke[]
  tool: PresentToolState
  onAddStroke: (stroke: PresentStroke) => void
}

let strokeSeq = 0
const nextId = () => `s${++strokeSeq}`

/** Local coords from a pointer event relative to the SVG element. */
function localPoint(svg: SVGSVGElement | null, e: { clientX: number; clientY: number }) {
  const r = svg?.getBoundingClientRect()
  return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
}

const pointsAttr = (pts: number[]) => {
  let out = ''
  for (let i = 0; i < pts.length; i += 2) out += `${pts[i]},${pts[i + 1]} `
  return out.trim()
}

function renderStroke(s: PresentStroke) {
  const opacity = s.kind === 'highlighter' ? 0.35 : 1
  if (s.kind === 'pen' || s.kind === 'highlighter') {
    return (
      <polyline key={s.id} points={pointsAttr(s.points)} fill="none"
        stroke={s.color} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />
    )
  }
  if (s.kind === 'rect') {
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2)
    const w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1)
    return <rect key={s.id} x={x} y={y} width={w} height={h} fill="none" stroke={s.color} strokeWidth={s.width} />
  }
  // s is narrowed to arrow here (the only remaining union member)
  if (s.kind === 'arrow') {
    const head = arrowHead(s.x1, s.y1, s.x2, s.y2, Math.max(12, s.width * 3))
    return (
      <g key={s.id}>
        <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={s.width} strokeLinecap="round" />
        <polygon points={head.map(p => `${p[0]},${p[1]}`).join(' ')} fill={s.color} />
      </g>
    )
  }
  return null
}

export function PresentationOverlay({ strokes, tool, onAddStroke }: PresentationOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<PresentStroke | null>(null)
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null)
  const drawing = isDrawingTool(tool.kind)

  useEffect(() => {
    if (tool.kind !== 'laser') { setLaser(null); return }
    const onMove = (e: PointerEvent) => setLaser(localPoint(svgRef.current, e))
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [tool.kind])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!drawing) return
    const p = localPoint(svgRef.current, e)
    if (tool.kind === 'pen' || tool.kind === 'highlighter') {
      setDraft({ id: nextId(), kind: tool.kind, color: tool.color, width: tool.width, points: [p.x, p.y] })
    } else {
      setDraft({ id: nextId(), kind: tool.kind as 'rect' | 'arrow', color: tool.color, width: tool.width, x1: p.x, y1: p.y, x2: p.x, y2: p.y })
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draft) return
    const p = localPoint(svgRef.current, e)
    setDraft(d => {
      if (!d) return d
      if (d.kind === 'pen' || d.kind === 'highlighter') return { ...d, points: [...d.points, p.x, p.y] }
      return { ...d, x2: p.x, y2: p.y }
    })
  }
  const onPointerUp = () => {
    if (draft) onAddStroke(draft)
    setDraft(null)
  }

  return (
    <svg
      ref={svgRef}
      className="wz-present-overlay no-print"
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', zIndex: 55, pointerEvents: drawing ? 'auto' : 'none', cursor: drawing ? 'crosshair' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {strokes.map(renderStroke)}
      {draft && renderStroke(draft)}
      {laser && (
        <circle className="wz-laser-dot" cx={laser.x} cy={laser.y} r={9} fill="rgba(239,68,68,0.85)"
          style={{ filter: 'drop-shadow(0 0 8px rgba(239,68,68,0.9))' }} />
      )}
    </svg>
  )
}
