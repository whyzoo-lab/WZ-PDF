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

/**
 * Is `localStorage` safe to touch on this origin?
 *
 * On the packaged app's custom `app://` origin the **first** `localStorage`
 * access blocks the renderer's main thread for ~6 seconds while Chromium
 * initialises DOM Storage for a non-http scheme. Measured on the packaged
 * build: first `getItem` 5940 ms, every later call 0 ms — and it is specific to
 * localStorage, since `sessionStorage` (15 ms) and `indexedDB.open` (37 ms) are
 * fine on the same origin.
 *
 * `LANG` is computed while this module is evaluated, so that freeze landed
 * *before the first paint*: the window sat empty for six seconds on every
 * launch, showing neither the app nor even app.html's own boot shell. Deferring
 * the read would not have helped — the cost is in the first access whenever it
 * happens, so it would just move the freeze somewhere the user is already
 * interacting.
 *
 * The override is a browser affordance anyway: it is set by `?lang=`, and the
 * desktop app loads `app://bundle/app.html` with no query string, so nothing
 * can ever write it there. Skipping storage off-http therefore costs the
 * desktop build nothing and keeps the web build's behaviour identical.
 */
export function canPersistOverride(protocol: string | undefined): boolean {
  return protocol === 'http:' || protocol === 'https:'
}

function normalize(value: string | null | undefined): Lang | null {
  if (!value) return null
  const v = value.toLowerCase()
  if (v.startsWith('ko')) return 'ko'
  if (v.startsWith('en')) return 'en'
  return null
}

function detectLang(): Lang {
  if (typeof window !== 'undefined') {
    const persist = canPersistOverride(window.location.protocol)

    // 1) URL ?lang= override. Read first, and without touching storage, so the
    //    startup path carries no synchronous I/O at all.
    const fromUrl = normalize(new URLSearchParams(window.location.search).get('lang'))
    if (fromUrl) {
      // Persist it so it survives navigation/reload. Kept in its own try: a
      // storage failure must not discard the language the user just asked for.
      if (persist) {
        try { localStorage.setItem(STORAGE_KEY, fromUrl) } catch { /* private mode */ }
      }
      return fromUrl
    }

    // 2) Previously-persisted override.
    if (persist) {
      try {
        const fromStore = normalize(localStorage.getItem(STORAGE_KEY))
        if (fromStore) return fromStore
      } catch { /* private mode / sandboxed iframe */ }
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

// Declare the language on the document itself. A screen reader picks its
// pronunciation rules from `lang`, and the shipped HTML says `en` — so every
// Korean string in the UI, and every Korean word in a PDF's text layer, was
// being read to blind users with English phonetics. Set here rather than in the
// HTML because the language is decided here, and it is one attribute write on
// an element that already exists: nothing is fetched and nothing is measured.
if (typeof document !== 'undefined') document.documentElement.lang = LANG

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
