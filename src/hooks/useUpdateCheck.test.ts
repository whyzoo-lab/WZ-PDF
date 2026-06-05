import { describe, it, expect } from 'vitest'
import { isNewerVersion } from './useUpdateCheck'

describe('isNewerVersion', () => {
  it('detects a newer patch / minor / major', () => {
    expect(isNewerVersion('1.2.2', '1.2.1')).toBe(true)
    expect(isNewerVersion('1.3.0', '1.2.9')).toBe(true)
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true)
  })

  it('is false for equal or older versions', () => {
    expect(isNewerVersion('1.2.1', '1.2.1')).toBe(false)
    expect(isNewerVersion('1.2.0', '1.2.1')).toBe(false)
    expect(isNewerVersion('1.1.9', '1.2.0')).toBe(false)
  })

  it('handles differing segment counts', () => {
    expect(isNewerVersion('1.2', '1.2.0')).toBe(false)
    expect(isNewerVersion('1.2.0.1', '1.2.0')).toBe(true)
  })

  it('treats non-numeric segments as 0', () => {
    expect(isNewerVersion('1.2.x', '1.2.0')).toBe(false)
  })
})
