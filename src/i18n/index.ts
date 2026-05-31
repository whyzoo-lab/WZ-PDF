/**
 * Lightweight i18n — zero dependencies.
 *
 * Language is chosen once at startup from the OS / browser locale:
 *   - Korean (`ko*`)  → Korean
 *   - everything else → English (default)
 *
 * There is no runtime language switcher by design (the spec is "detect OS
 * language"). If a switcher is needed later, expose `setLang` + a context
 * provider — the `messages` shape already supports it.
 */

import { en } from './en'
import { ko } from './ko'

export type Lang = 'en' | 'ko'
export type MessageKey = keyof typeof en

const DICTS: Record<Lang, Record<string, string>> = { en, ko }

function detectLang(): Lang {
  // navigator.language is present in both browser and Electron renderer.
  const raw =
    (typeof navigator !== 'undefined' &&
      (navigator.language || (navigator.languages && navigator.languages[0]))) ||
    'en'
  return raw.toLowerCase().startsWith('ko') ? 'ko' : 'en'
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
