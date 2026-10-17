import { memo, useContext, useEffect, useRef, useState } from 'react'
import type { FillAnnotation } from '../../types/annotation'
import { FILL_BASELINE, MARK_STROKE, markShape, textBox } from '../../services/fillMarks'
import { FillContext } from './fillContext'
import { useDraftCommit } from '../../hooks/useDraftCommit'
import { t } from '../../i18n'

/**
 * Fill & Sign items of one page: typed text and ✓ ✕ ● ─ marks, laid out on
 * the unrotated page and turned with it (`.wz-fill-layer[data-main-rotation]`).
 * While editing, an item is selected by a click, moved by dragging it, typed
 * into in place, and sized from the little bar above it.
 */
export const FillLayer = memo(function FillLayer({ items, selectedId, scale, rotation, width, height, onSelect }: {
  items: FillAnnotation[]
  selectedId: string | null
  /** CSS px per PDF point. */
  scale: number
  rotation: number
  /** The page as shown (turned box). */
  width: number
  height: number
  onSelect: (id: string | null) => void
}) {
  if (items.length === 0) return null
  const turned = rotation % 180 !== 0
  return (
    <div
      className="wz-fill-layer"
      data-main-rotation={rotation}
      style={{ position: 'absolute', top: 0, left: 0, width: turned ? height : width, height: turned ? width : height, pointerEvents: 'none' }}
    >
      {items.map(a => <FillItem key={a.id} a={a} scale={scale} rotation={rotation} selected={a.id === selectedId} onSelect={onSelect} />)}
    </div>
  )
})

function FillItem({ a, scale, rotation, selected, onSelect }: {
  a: FillAnnotation; scale: number; rotation: number; selected: boolean; onSelect: (id: string | null) => void
}) {
  const { canEdit, update, remove } = useContext(FillContext)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Stored as the reader pauses, so Ctrl+S with the caret still here saves it.
  const { shown: text, onChange: type, flush } = useDraftCommit(a.text, next => {
    if (next.trim()) update(a.id, { text: next, width: textBox(next, a.fontSize).width })
  })

  // A text item just placed (empty) is typed into at once.
  useEffect(() => {
    if (selected && canEdit && a.mark === 'text' && !a.text) inputRef.current?.focus({ preventScroll: true })
  }, [selected, canEdit, a.mark, a.text])

  // The pointer moves on screen; the item moves on the unrotated page.
  const toPage = (dx: number, dy: number) => {
    switch (rotation) {
      case 90: return { dx: dy, dy: -dx }
      case 180: return { dx: -dx, dy: -dy }
      case 270: return { dx: -dy, dy: dx }
      default: return { dx, dy }
    }
  }

  // Leaving an item with nothing in it takes it away.
  const leave = () => {
    flush()
    if (!text.trim()) remove(a.id)
  }

  const s = scale
  const left = a.x * s + (drag?.dx ?? 0)
  const top = a.y * s + (drag?.dy ?? 0)
  const fontPx = a.fontSize * s

  const body = a.mark === 'text' ? (
    <>
      {canEdit ? (
        <input
          ref={inputRef}
          value={text}
          onChange={e => type(e.target.value)}
          onBlur={leave}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }}
          onPointerDown={e => { if (!selected) { e.preventDefault(); onSelect(a.id) } }}
          aria-label={t('fill.textLabel')}
          placeholder={t('fill.placeholder')}
          className="wz-fill-input block border-0 bg-transparent p-0 outline-none placeholder:text-blue-400"
          // As wide as what is typed (field-sizing; elsewhere a fixed guess).
          style={{ fontSize: fontPx, lineHeight: 1, height: fontPx * 1.25, color: a.color, minWidth: fontPx * 2, width: textBox(text, a.fontSize).width * s, fieldSizing: 'content', cursor: selected ? 'text' : 'move' } as React.CSSProperties}
        />
      ) : (
        <span className="block whitespace-pre" style={{ fontSize: fontPx, lineHeight: 1, height: fontPx * 1.25, paddingTop: fontPx * (FILL_BASELINE - 0.8), color: a.color }}>{a.text}</span>
      )}
    </>
  ) : (
    <MarkSvg mark={a.mark} w={a.width * s} h={a.height * s} color={a.color} />
  )

  return (
    <div
      data-wz-fill=""
      className={`absolute ${canEdit ? (selected ? 'outline outline-1 outline-dashed outline-blue-500' : 'hover:outline hover:outline-1 hover:outline-blue-300') : ''}`}
      style={{ left, top, pointerEvents: canEdit ? 'auto' : 'none', cursor: canEdit ? 'move' : undefined, touchAction: 'none' }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => {
        if (!canEdit || (e.target as HTMLElement).closest('button')) return
        if (e.target === inputRef.current && selected) return // caret placement
        e.stopPropagation()
        start.current = { x: e.clientX, y: e.clientY, moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => {
        const st = start.current
        if (!st) return
        const d = toPage(e.clientX - st.x, e.clientY - st.y)
        if (!st.moved && Math.hypot(d.dx, d.dy) < 4) return
        st.moved = true
        setDrag(d)
      }}
      onPointerUp={() => {
        const st = start.current
        start.current = null
        if (st?.moved && drag) {
          update(a.id, { x: a.x + drag.dx / s, y: a.y + drag.dy / s })
          setDrag(null)
        }
        if (!selected) onSelect(a.id)
      }}
      onPointerCancel={() => { start.current = null; setDrag(null) }}
    >
      {body}
      {selected && canEdit && (
        <div className="absolute -top-8 left-0 z-10 flex items-center gap-0.5 rounded-md border border-gray-300 bg-white px-1 py-0.5 shadow-md dark:border-gray-600 dark:bg-gray-800"
          onPointerDown={e => e.stopPropagation()}>
          <SizeButton label={t('fill.smaller')} onClick={() => resize(-1)}>−</SizeButton>
          <SizeButton label={t('fill.bigger')} onClick={() => resize(1)}>+</SizeButton>
          <SizeButton label={t('fill.delete')} onClick={() => remove(a.id)} danger>✕</SizeButton>
        </div>
      )}
    </div>
  )

  function resize(dir: 1 | -1) {
    if (a.mark === 'text') {
      const fontSize = Math.min(72, Math.max(6, a.fontSize + dir * (a.fontSize >= 20 ? 2 : 1)))
      update(a.id, { fontSize, height: fontSize * 1.25 })
    } else {
      const k = dir > 0 ? 1.2 : 1 / 1.2
      const h = Math.min(120, Math.max(6, a.height * k))
      update(a.id, { width: a.width * (h / a.height), height: h })
    }
  }
}

function SizeButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick() }} aria-label={label} title={label}
      className={`flex h-6 w-6 items-center justify-center rounded text-sm leading-none ${danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950' : 'text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-700'}`}>
      {children}
    </button>
  )
}

function MarkSvg({ mark, w, h, color }: { mark: Exclude<FillAnnotation['mark'], 'text'>; w: number; h: number; color: string }) {
  const shape = markShape(mark)
  const sw = MARK_STROKE * h
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block overflow-visible" aria-label={t(`fill.tool.${mark}`)} role="img">
      {shape.lines.map((line, i) => (
        <polyline key={i} points={line.map(([x, y]) => `${x * w},${y * h}`).join(' ')} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {shape.dot && <circle cx={shape.dot.cx * w} cy={shape.dot.cy * h} r={shape.dot.r * h} fill={color} />}
    </svg>
  )
}
