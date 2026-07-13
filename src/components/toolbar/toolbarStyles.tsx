// Shared toolbar visual tokens + separator. Extracted from ActionBar.tsx.

// Single shared icon-button size so every toolbar control hits the same grid.
export const BTN_BASE = 'flex items-center justify-center w-9 h-9 rounded transition-all'
export const BTN_IDLE = 'text-gray-300 hover:bg-gray-700 hover:text-white'
export const BTN_ACTIVE = 'bg-blue-600 text-white shadow-sm'

// Vertical divider between toolbar clusters.
export const Sep = () => <div className="w-px h-5 bg-gray-600 mx-0.5 shrink-0 self-center" />
