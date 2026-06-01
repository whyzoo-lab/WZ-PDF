/**
 * Lightweight i18n — zero dependencies.
 *
 * Language is chosen once at startup, in priority order:
 *   1. `?lang=en` / `?lang=ko` URL query param (also persisted to localStorage)
 *   2. previously-persisted override in localStorage
 *   3. OS / browser locale — Korean (`ko*`) → Korean, else English
 *
 * The URL/localStorage override makes it easy to test or share a specific
 * language without changing OS settings, e.g. `…/?lang=en`.
 */

import { en } from './en'
import { ko } from './ko'

export type Lang = 'en' | 'ko'
export type MessageKey = keyof typeof en

const DICTS: Record<Lang, Record<string, string>> = { en, ko }
const STORAGE_KEY = 'wz-pdf-lang'

function normalize(value: string | null | undefined): Lang | null {
  if (!value) return null
  const v = value.toLowerCase()
  if (v.startsWith('ko')) return 'ko'
  if (v.startsWith('en')) return 'en'
  return null
}

function detectLang(): Lang {
  if (typeof window !== 'undefined') {
    // 1) URL ?lang= override — persist it so it survives navigation/reload.
    try {
      const param = new URLSearchParams(window.location.search).get('lang')
      const fromUrl = normalize(param)
      if (fromUrl) {
        localStorage.setItem(STORAGE_KEY, fromUrl)
        return fromUrl
      }
      // 2) Previously-persisted override.
      const fromStore = normalize(localStorage.getItem(STORAGE_KEY))
      if (fromStore) return fromStore
    } catch {
      // localStorage can throw in private mode / sandboxed iframes — ignore.
    }
  }
  // 3) OS / browser locale.
  const raw =
    (typeof navigator !== 'undefined' &&
      (navigator.language || (navigator.languages && navigator.languages[0]))) ||
    'en'
  return normalize(raw) ?? 'en'
}

export const LANG: Lang = detectLang()

/**
 * Translate a key. Supports `{name}`-style interpolation:
 *   t('export.pdfDone', { name: 'foo.pdf' })
 *
 * Falls back to English, then to the raw key, so a missing translation is
 * visible but never crashes.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const dict = DICTS[LANG]
  let str = dict[key] ?? en[key] ?? String(key)
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return str
}
