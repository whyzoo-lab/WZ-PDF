// The pieces the tool rail and the edit rail are made of: one item model, the
// button that draws an item, the flyout menu an item opens, and the arithmetic
// that decides how many items fit before the rest go into "...".
//
// One model on purpose. The same items are drawn as a vertical rail on a
// desktop, a bottom bar on a phone and rows in the overflow menu; describing
// each control once is what keeps the three from drifting apart — the old
// toolbar kept an expanded and a collapsed copy of every control by hand.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface RailItem {
  id: string
  /** Items of one group sit together; a gap separates groups. */
  group?: string
  /** Accessible name and tooltip. */
  label: string
  /** Shown after the label in the tooltip, e.g. a shortcut. */
  hint?: string
  icon: ReactNode
  /** A short caption under the icon (edit rail: the glyphs are not self-explanatory). */
  caption?: string
  onClick?: () => void
  /** Opens a flyout instead of acting; `close` dismisses it. */
  menu?: (close: () => void) => ReactNode
  /** Which view am I in: a soft wash. */
  active?: boolean
  /** A tool that changes what the next click on the page does: the accent. */
  armed?: boolean
  /** On/off state worth amber (editing on, a password armed). */
  warn?: boolean
  /** Destructive (delete). */
  danger?: boolean
  disabled?: boolean
  /** Rendered as role="switch" with this state. */
  switchOn?: boolean
  pressed?: boolean
  /** Small text over the icon's corner (OCR progress). */
  badge?: string
}

/** A rail is either a column (desktop) or a row (the phone's bottom bar). */
export type RailAxis = 'column' | 'row'

const toneClass = (item: RailItem) =>
  item.danger ? 'bg-red-700 text-white hover:bg-red-600'
  : item.armed ? 'bg-blue-600 text-white'
  : item.warn ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
  : item.active ? 'bg-white/15 text-white'
  : 'text-gray-300 hover:bg-white/10 hover:text-white'

/** One rail control. A menu item opens its flyout beside the button. */
export function RailButton({ item, axis, menuOpen, onToggleMenu }: {
  item: RailItem
  axis: RailAxis
  menuOpen?: boolean
  /** A menu item was pressed; the button is where its flyout hangs. */
  onToggleMenu?: (anchor: HTMLElement) => void
}) {
  const tip = item.hint ? `${item.label} (${item.hint})` : item.label
  const size = item.caption ? 'w-12 h-12 flex-col gap-0.5 rounded-xl' : 'w-10 h-10 rounded-xl'
  return (
    <button
      type="button"
      role={item.switchOn !== undefined ? 'switch' : undefined}
      aria-checked={item.switchOn}
      aria-pressed={item.pressed}
      aria-haspopup={item.menu ? 'menu' : undefined}
      aria-expanded={item.menu ? !!menuOpen : undefined}
      aria-label={item.label}
      title={tip}
      disabled={item.disabled}
      onClick={item.menu ? e => onToggleMenu?.(e.currentTarget) : item.onClick}
      className={`relative flex shrink-0 items-center justify-center transition-colors disabled:opacity-35 disabled:pointer-events-none ${size} ${menuOpen ? 'bg-white/15 text-white' : toneClass(item)}`}
      data-axis={axis}
    >
      {/* Rail icons are drawn larger than the old bar's 16 px. */}
      <span className="flex [&>svg]:h-5 [&>svg]:w-5">{item.icon}</span>
      {item.caption && <span className="text-[10px] leading-none">{item.caption}</span>}
      {item.badge && (
        <span className="absolute -right-1 -top-1 rounded-full bg-blue-600 px-1 text-[9px] font-semibold leading-4 text-white tabular-nums" aria-hidden>
          {item.badge}
        </span>
      )}
    </button>
  )
}

/** Rows inside a flyout, sharing one look. */
export const MENU_ROW = 'w-full flex items-center gap-2.5 px-3 py-2 text-xs text-gray-200 hover:bg-gray-700 transition-colors text-left disabled:opacity-40'
export const MenuDivider = () => <div className="my-1 border-t border-gray-600" />

/**
 * A menu opened from a rail button: beside it on a column, above it on a row.
 * Portalled to <body> so no rail's overflow clips it; kept inside the window
 * (a menu from a button near the bottom opens upwards from where it fits).
 * Closes on a click outside it or its button, and on Escape.
 */
export function RailFlyout({ anchor, axis, onClose, children, label }: {
  anchor: HTMLElement
  axis: RailAxis
  onClose: () => void
  children: ReactNode
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const a = anchor.getBoundingClientRect()
    const w = el.offsetWidth, h = el.offsetHeight
    const margin = 6
    let left: number, top: number
    if (axis === 'column') {
      left = a.right + margin
      top = Math.min(a.top, window.innerHeight - h - margin)
    } else {
      left = Math.min(Math.max(margin, a.left + a.width / 2 - w / 2), window.innerWidth - w - margin)
      top = a.top - h - margin
    }
    setPos({ left: Math.max(margin, left), top: Math.max(margin, top) })
  }, [anchor, axis])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 9999 }}
      className="no-print min-w-[190px] max-h-[80vh] overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 py-1 shadow-xl"
    >
      {children}
    </div>,
    document.body,
  )
}
