import { memo, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { Annotation, CommentAnnotation, NoteAnnotation } from '../../types/annotation'
import { isTextMarkup } from '../../types/annotation'
import { boundsOf, fromDisplayed, toDisplayed } from '../../utils/pageGeometry'
import { CommentContext } from './commentContext'
import { CommentBody, CommentHeader } from './CommentBody'
import { t } from '../../i18n'

/** On screen a note keeps one size, whatever the zoom (Acrobat's NoZoom). */
const ICON_PX = 22
const POPOVER_W = 280

interface Props {
  comments: CommentAnnotation[]
  selectedId: string | null
  /** CSS px per PDF point. */
  scale: number
  /** The page unrotated, CSS px. */
  width: number
  height: number
  rotation: number
  onSelect: (id: string | null) => void
  onUpdate: (id: string, updates: Partial<Annotation>) => void
}

/**
 * The parts of a page's comments that take the pointer, in the turned box
 * (above the text layers): note icons — clicked to open, dragged to move
 * while editing — and the pop-over of the selected comment.
 */
export const PageComments = memo(function PageComments({ comments, selectedId, scale, width, height, rotation, onSelect, onUpdate }: Props) {
  const turned = rotation === 90 || rotation === 270
  const boxW = turned ? height : width
  const boxH = turned ? width : height
  const notes = comments.filter((a): a is NoteAnnotation => a.type === 'note')
  const selected = comments.find(a => a.id === selectedId) ?? null

  return (
    <>
      {notes.map(n => (
        <NoteIcon key={n.id} note={n} scale={scale} width={width} height={height} rotation={rotation} boxW={boxW} boxH={boxH}
          selected={n.id === selectedId} onSelect={onSelect} onUpdate={onUpdate} />
      ))}
      {selected && (
        <Popover key={selected.id} a={selected} scale={scale} width={width} height={height} rotation={rotation}
          boxW={boxW} boxH={boxH} onSelect={onSelect} onUpdate={onUpdate} />
      )}
    </>
  )
})

function NoteIcon({ note, scale, width, height, rotation, boxW, boxH, selected, onSelect, onUpdate }: {
  note: NoteAnnotation; scale: number; width: number; height: number; rotation: number; boxW: number; boxH: number
  selected: boolean; onSelect: (id: string | null) => void; onUpdate: (id: string, u: Partial<Annotation>) => void
}) {
  const { canEdit } = useContext(CommentContext)
  const at = toDisplayed(note.x * scale, note.y * scale, width, height, rotation)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(0, max - ICON_PX))
  const left = clamp(at.x + (drag?.dx ?? 0), boxW)
  const top = clamp(at.y + (drag?.dy ?? 0), boxH)

  return (
    <button
      type="button"
      data-wz-note=""
      aria-label={t('comment.noteLabel', { text: note.contents || t('comment.empty') })}
      aria-pressed={selected}
      title={note.contents || undefined}
      className={`no-print absolute flex items-center justify-center rounded-sm border shadow-sm ${selected ? 'border-blue-600 ring-2 ring-blue-500' : 'border-black/40'} ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      style={{ left, top, width: ICON_PX, height: ICON_PX, background: note.color, touchAction: 'none', zIndex: 5 }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => {
        e.stopPropagation()
        start.current = { x: e.clientX, y: e.clientY, moved: false }
        if (canEdit) e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => {
        const s = start.current
        if (!s || !canEdit) return
        const dx = e.clientX - s.x, dy = e.clientY - s.y
        if (!s.moved && Math.hypot(dx, dy) < 4) return
        s.moved = true
        setDrag({ dx, dy })
      }}
      onPointerUp={e => {
        const s = start.current
        start.current = null
        if (s?.moved) {
          // Back to the page's own space; the icon's corner is the note's place.
          const p = fromDisplayed(left, top, width, height, rotation)
          onUpdate(note.id, { x: p.x / scale, y: p.y / scale })
          setDrag(null)
          e.stopPropagation()
          return
        }
        onSelect(selected ? null : note.id)
      }}
      onPointerCancel={() => { start.current = null; setDrag(null) }}
    >
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="#404040" strokeWidth="1.4" aria-hidden>
        <path d="M4 5h12M4 9h12M4 13h7" strokeLinecap="round" />
      </svg>
    </button>
  )
}

function Popover({ a, scale, width, height, rotation, boxW, boxH, onSelect, onUpdate }: {
  a: CommentAnnotation; scale: number; width: number; height: number; rotation: number; boxW: number; boxH: number
  onSelect: (id: string | null) => void; onUpdate: (id: string, u: Partial<Annotation>) => void
}) {
  const { canEdit, author, remove } = useContext(CommentContext)
  const ref = useRef<HTMLDivElement>(null)

  // The comment's box on screen: a markup's lines, or the note's icon.
  let anchor: { left: number; top: number; right: number; bottom: number }
  if (isTextMarkup(a)) {
    const b = boundsOf(a.rects)
    const p = toDisplayed(b.x * scale, b.y * scale, width, height, rotation)
    const q = toDisplayed((b.x + b.width) * scale, (b.y + b.height) * scale, width, height, rotation)
    anchor = { left: Math.min(p.x, q.x), top: Math.min(p.y, q.y), right: Math.max(p.x, q.x), bottom: Math.max(p.y, q.y) }
  } else {
    const p = toDisplayed(a.x * scale, a.y * scale, width, height, rotation)
    anchor = { left: p.x, top: p.y, right: p.x + ICON_PX, bottom: p.y + ICON_PX }
  }

  // Below the comment when it fits, above it otherwise, kept inside the page
  // (the page clips what overflows it).
  const w = Math.min(POPOVER_W, Math.max(160, boxW - 8))
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  // Every render on purpose: the height changes as replies are typed. The
  // setter bails out when nothing moved, so it cannot loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0
    const left = Math.min(Math.max(4, anchor.left), Math.max(4, boxW - w - 4))
    const below = anchor.bottom + 6
    const above = anchor.top - h - 6
    const top = below + h <= boxH - 4 || above < 4 ? Math.min(below, Math.max(4, boxH - h - 4)) : above
    setPos(p => (p && p.left === left && p.top === top ? p : { left, top }))
  })

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('comment.dialog')}
      data-wz-comment-popover=""
      className="no-print absolute rounded-lg border border-gray-300 bg-white p-2.5 shadow-xl dark:border-gray-600 dark:bg-gray-900"
      // Transparent, not hidden, until placed: a hidden field cannot take focus.
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, width: w, zIndex: 20, opacity: pos ? 1 : 0 }}
      // Clicks inside must not reach the page, which would close it again.
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-1">
        <CommentHeader a={a} />
        <button type="button" onClick={() => onSelect(null)} aria-label={t('comment.close')} title={t('comment.close')}
          className="ml-auto shrink-0 rounded px-1 text-sm leading-none text-gray-400 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-white">×</button>
      </div>
      <CommentBody a={a} canEdit={canEdit} author={author} onUpdate={onUpdate} onRemove={remove}
        // A comment with nothing in it yet (a note just placed, a highlight
        // clicked to say something about it) opens ready to type.
        autoFocus={canEdit && !a.contents && a.replies.length === 0} onDone={() => onSelect(null)} />
    </div>
  )
}
