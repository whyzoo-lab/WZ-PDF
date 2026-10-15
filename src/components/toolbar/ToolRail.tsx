// A rail of tool icons: a column down the left of the window on a desktop, a
// row along the bottom on a phone. The main items run from the start; the
// pinned items (the edit switch, the padlock) sit at the far end. When the
// rail is too short for every main item, the last ones move into a "..."
// menu — the end of the list is what a reader reaches for least.

import { useCallback, useState, type ReactNode } from 'react'
import { RailButton, RailFlyout, MENU_ROW, MenuDivider, type RailAxis, type RailItem } from './rail'
import { itemsThatFit, useRailRoom } from './railLayout'
import { IconMore } from './icons'
import { t } from '../../i18n'

/** Each button and its gap, along the rail; a group separator. */
const STEP = 44
const CAPTION_STEP = 52
const GROUP_GAP = 9

export function ToolRail({ items, pinned = [], axis, head, label, shade = 'base' }: {
  items: RailItem[]
  pinned?: RailItem[]
  axis: RailAxis
  /** Above the items on a column (the logo). */
  head?: ReactNode
  label: string
  /** The edit rail sits a shade lighter than the tool rail beside it. */
  shade?: 'base' | 'raised'
}) {
  // The open flyout and the button it hangs from.
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const { ref: roomRef, room } = useRailRoom(axis)

  const step = (it: RailItem) => (it.caption ? CAPTION_STEP : STEP)
  const sizes = items.map((it, i) => step(it) + (i > 0 && it.group !== items[i - 1].group ? GROUP_GAP : 0))
  const shown = itemsThatFit(sizes, room, STEP)
  const visible = items.slice(0, shown)
  const hidden = items.slice(shown)

  const button = (item: RailItem) => (
    <RailButton
      key={item.id}
      item={item}
      axis={axis}
      menuOpen={open?.id === item.id}
      onToggleMenu={anchor => setOpen(o => (o?.id === item.id ? null : { id: item.id, anchor }))}
    />
  )
  const withGaps = (list: RailItem[]) => list.map((item, i) => (
    <div key={item.id} className={`flex ${axis === 'column' ? 'flex-col' : ''} items-center`}>
      {i > 0 && item.group !== list[i - 1].group && (
        <span aria-hidden className={axis === 'column' ? 'my-1 h-px w-6 bg-gray-700' : 'mx-1 h-6 w-px bg-gray-700'} />
      )}
      {button(item)}
    </div>
  ))

  const more: RailItem = {
    id: '__more', label: t('tool.more'), icon: <IconMore />,
    menu: done => <MoreMenu hidden={hidden} done={done} />,
  }
  const openItem = open ? [...items, ...pinned, more].find(i => i.id === open.id) : null
  const column = axis === 'column'

  return (
    <nav
      aria-label={label}
      className={`no-print flex shrink-0 text-white ${shade === 'raised' ? 'bg-gray-800' : 'bg-gray-900'} ${column ? 'w-[52px] flex-col items-center' : 'w-full flex-row items-center px-1 pt-1.5 wz-bottombar'}`}
    >
      {head}
      <div ref={roomRef} className={`flex min-h-0 min-w-0 flex-1 items-center gap-1 overflow-hidden ${column ? 'flex-col py-1' : 'flex-row px-1'}`}>
        {withGaps(visible)}
        {hidden.length > 0 && button(more)}
      </div>
      {pinned.length > 0 && (
        <div className={`flex items-center gap-1 ${column ? 'flex-col pb-2 pt-1' : 'flex-row pl-1'}`}>
          {pinned.map(button)}
        </div>
      )}
      {openItem?.menu && open && (
        <RailFlyout anchor={open.anchor} axis={axis} onClose={close} label={openItem.label}>
          {openItem.menu(close)}
        </RailFlyout>
      )}
    </nav>
  )
}

/** The rows of the "..." menu: plain items as rows, menu items inline under their name. */
function MoreMenu({ hidden, done }: { hidden: RailItem[]; done: () => void }) {
  return (
    <>
      {hidden.map((item, i) => (
        <div key={item.id}>
          {i > 0 && item.group !== hidden[i - 1].group && <MenuDivider />}
          {item.menu ? (
            <>
              <div className="px-3 pt-1.5 pb-0.5 text-[11px] text-gray-400">{item.label}</div>
              {item.menu(done)}
            </>
          ) : (
            <button
              role={item.switchOn !== undefined ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={item.switchOn}
              className={MENU_ROW}
              disabled={item.disabled}
              onClick={() => { item.onClick?.(); done() }}
            >
              {item.icon}<span className="flex-1">{item.label}</span>
              {item.hint && <kbd className="font-sans text-[11px] text-gray-400">{item.hint}</kbd>}
            </button>
          )}
        </div>
      ))}
    </>
  )
}
