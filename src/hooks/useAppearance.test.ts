import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { parseAppearance, useAppearance } from './useAppearance'

afterEach(() => {
  document.documentElement.classList.remove('dark')
  document.documentElement.removeAttribute('data-reading')
})

describe('appearance', () => {
  it('falls back to the defaults for anything it does not know', () => {
    expect(parseAppearance(null)).toEqual({ theme: 'light', reading: 'normal' })
    expect(parseAppearance({ theme: 'neon', reading: 'night' })).toEqual({ theme: 'light', reading: 'night' })
  })

  it('puts the theme and reading colours on <html>', () => {
    const { result } = renderHook(() => useAppearance())
    act(() => { result.current[1]({ theme: 'dark', reading: 'sepia' }) })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.getAttribute('data-reading')).toBe('sepia')
    act(() => { result.current[1]({ theme: 'light', reading: 'normal' }) })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.hasAttribute('data-reading')).toBe(false)
  })
})
