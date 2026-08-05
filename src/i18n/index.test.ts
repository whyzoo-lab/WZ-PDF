import { describe, it, expect } from 'vitest'
import { canPersistOverride } from './index'

/**
 * The language override is persisted in `localStorage`, which is unusable on the
 * packaged app's custom origin: the FIRST access there blocks the renderer's
 * main thread for ~6 s while Chromium initialises DOM Storage for a non-http
 * scheme (measured on the packaged build — and specific to localStorage, since
 * sessionStorage and indexedDB.open cost milliseconds on the same origin).
 *
 * `LANG` is computed during module evaluation, so that freeze landed before the
 * first paint and the window sat empty for six seconds on every launch. This
 * predicate is what keeps the desktop origin off that path.
 */
describe('canPersistOverride', () => {
  it('allows storage on the web build', () => {
    expect(canPersistOverride('https:')).toBe(true)
    expect(canPersistOverride('http:')).toBe(true)   // dev server
  })

  it('refuses storage on the packaged desktop origin', () => {
    // The renderer is served from app://bundle in the packaged app.
    expect(canPersistOverride('app:')).toBe(false)
  })

  it('refuses storage on any other non-http scheme', () => {
    for (const protocol of ['file:', 'blob:', 'data:', 'chrome-extension:']) {
      expect(canPersistOverride(protocol)).toBe(false)
    }
  })

  it('refuses storage when the protocol is unknown', () => {
    expect(canPersistOverride(undefined)).toBe(false)
    expect(canPersistOverride('')).toBe(false)
  })
})
