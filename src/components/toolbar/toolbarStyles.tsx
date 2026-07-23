// Shared toolbar visual tokens + spacer. Extracted from ActionBar.tsx.
//
// Visual language: Chrome's PDF toolbar — flat, quiet, no chrome around a
// control until you touch it. Buttons are round ghost targets, not boxes, and
// groups are separated by empty space rather than by rules.

// Single shared icon-button size so every toolbar control hits the same grid.
// rounded-full (not `rounded`) is what stops the bar reading as a row of tiles.
export const BTN_BASE =
  'flex items-center justify-center w-9 h-9 rounded-full transition-colors shrink-0'

// Idle: no background at all — the icon alone. A soft wash appears on hover.
export const BTN_IDLE = 'text-gray-300 hover:bg-white/10 hover:text-white'

// Selected: a soft neutral wash. Used for "which view am I in" state, which
// should read as current without shouting over everything else.
export const BTN_ACTIVE = 'bg-white/15 text-white'

// Armed: a drawing tool is active, so the next click on the page DRAWS. That is
// a mode change with consequences, so it keeps a saturated accent — a neutral
// wash here would make an armed pen look the same as the current view mode.
export const BTN_ARMED = 'bg-blue-600 text-white'

// Group separator. Deliberately whitespace, not a rule: the old 1px dividers
// (8 of them) were most of the toolbar's visual noise.
export const Sep = () => <div className="w-2 shrink-0" aria-hidden />
