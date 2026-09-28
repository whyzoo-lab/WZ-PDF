import { describe, it, expect } from 'vitest'
import { allowsPermission } from './security'

describe('allowsPermission', () => {
  const APP = 'app://bundle/app.html'

  it('grants what the viewer itself uses, to the app renderer', () => {
    // Presentation mode: requestFullscreen, and the Escape key lock that makes
    // the two-step Esc work. Denying these left the slideshow in a window with
    // the min/max/close buttons over the slide.
    expect(allowsPermission('fullscreen', APP)).toBe(true)
    expect(allowsPermission('keyboardLock', APP)).toBe(true)
    // Ctrl+drag region OCR copies the recognized text.
    expect(allowsPermission('clipboard-sanitized-write', APP)).toBe(true)
    // The dev server only while developing.
    expect(allowsPermission('fullscreen', 'http://localhost:5173/app.html', { devServer: true })).toBe(true)
    expect(allowsPermission('fullscreen', 'http://localhost:5173/app.html')).toBe(false)
  })

  it('still refuses everything else', () => {
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'pointerLock', 'unknown']) {
      expect(allowsPermission(p, APP)).toBe(false)
    }
  })

  it('refuses even the allowed ones to any other origin', () => {
    expect(allowsPermission('fullscreen', 'https://evil.example/')).toBe(false)
    expect(allowsPermission('fullscreen', 'app://attacker/app.html')).toBe(false)
    expect(allowsPermission('fullscreen', '')).toBe(false)
  })
})
