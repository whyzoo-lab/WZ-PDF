// Theme and reading colours (src/hooks/useAppearance.ts), kept in
// userData/appearance.json, and the window-button colours that go with the
// theme. The renderer reads them through IPC because localStorage freezes the
// packaged app on first access.

import fs from 'fs'
import path from 'path'

export interface StoredAppearance { theme: 'light' | 'dark' | 'system'; reading: 'normal' | 'sepia' | 'night' }

export function parseStoredAppearance(v: unknown): StoredAppearance {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    theme: o.theme === 'dark' || o.theme === 'system' ? o.theme : 'light',
    reading: o.reading === 'sepia' || o.reading === 'night' ? o.reading : 'normal',
  }
}

export function readAppearance(userData: string): StoredAppearance {
  try {
    return parseStoredAppearance(JSON.parse(fs.readFileSync(path.join(userData, 'appearance.json'), 'utf8')))
  } catch {
    return parseStoredAppearance(null)
  }
}

export function writeAppearance(userData: string, value: unknown): StoredAppearance {
  const clean = parseStoredAppearance(value)
  fs.writeFileSync(path.join(userData, 'appearance.json'), JSON.stringify(clean))
  return clean
}

/** The title bar's colour (--wz-canvas) and the window buttons' symbols, per theme. */
export function titleBarColors(dark: boolean): { color: string; symbolColor: string } {
  return dark ? { color: '#2a2c31', symbolColor: '#e5e7eb' } : { color: '#e6e7ea', symbolColor: '#374151' }
}
