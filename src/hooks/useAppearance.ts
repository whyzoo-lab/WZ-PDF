// Theme (light / dark / follow the system) and reading colours, applied to
// <html> and remembered.
//
// After PdfCraft's view settings (Apache-2.0/MIT): the dark theme darkens the
// chrome and the page background but keeps pages white, and "reading colours"
// change how pages look on screen without touching the document — a sepia
// paper, or a night page with light text. Here the page raster is filtered in
// CSS (index.css, `data-reading`), so stamps and signatures on their own
// layers keep their colours.
//
// Stored through the main process in the desktop app (userData/appearance.json)
// — never localStorage there: its first access freezes the packaged app for
// ~6 s (see "Startup cost" in CLAUDE.md). The web build uses localStorage.

import { useCallback, useEffect, useState } from 'react'
import { canPersistOverride } from '../i18n'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ReadingColors = 'normal' | 'sepia' | 'night'
export interface Appearance { theme: ThemeChoice; reading: ReadingColors }

export const DEFAULT_APPEARANCE: Appearance = { theme: 'light', reading: 'normal' }
const STORAGE_KEY = 'wz-appearance'

export function parseAppearance(v: unknown): Appearance {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    theme: o.theme === 'dark' || o.theme === 'system' ? o.theme : 'light',
    reading: o.reading === 'sepia' || o.reading === 'night' ? o.reading : 'normal',
  }
}

const darkQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null)

/** Whether the chrome should be dark for this choice right now. */
export function isDark(theme: ThemeChoice): boolean {
  return theme === 'dark' || (theme === 'system' && !!darkQuery()?.matches)
}

function applyToDocument(a: Appearance): void {
  const root = document.documentElement
  const dark = isDark(a.theme)
  root.classList.toggle('dark', dark)
  if (a.reading === 'normal') root.removeAttribute('data-reading')
  else root.setAttribute('data-reading', a.reading)
  // The window's own buttons sit on the title bar; their colours follow.
  window.electronAPI?.setTitleBarTheme?.(dark)
}

export function useAppearance(): [Appearance, (next: Appearance) => void] {
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_APPEARANCE)

  // Load once.
  useEffect(() => {
    const api = window.electronAPI
    if (api?.appearanceGet) {
      api.appearanceGet().then(v => setAppearanceState(parseAppearance(v)), () => {})
      return
    }
    if (!canPersistOverride(window.location.protocol)) return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from storage on mount
      if (raw) setAppearanceState(parseAppearance(JSON.parse(raw)))
    } catch { /* private mode, damaged value: defaults */ }
  }, [])

  // Apply, and follow the system while "system" is chosen.
  useEffect(() => {
    applyToDocument(appearance)
    if (appearance.theme !== 'system') return
    const q = darkQuery()
    if (!q) return
    const on = () => applyToDocument(appearance)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [appearance])

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next)
    const api = window.electronAPI
    if (api?.appearanceSet) { void api.appearanceSet(next).catch(() => {}); return }
    if (!canPersistOverride(window.location.protocol)) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }, [])

  return [appearance, setAppearance]
}
