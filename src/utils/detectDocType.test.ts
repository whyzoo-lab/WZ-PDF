import { describe, it, expect } from 'vitest'
import { detectDocType } from './detectDocType'

const buf = (...b: number[]) => new Uint8Array(b).buffer

describe('detectDocType', () => {
  it('detects PDF by %PDF magic', () => {
    expect(detectDocType('a.pdf', buf(0x25,0x50,0x44,0x46,0x2d))).toBe('pdf')
  })
  it('detects HWP binary by OLE2 magic', () => {
    expect(detectDocType('a.hwp', buf(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1))).toBe('hwp')
  })
  it('detects HWPX by zip magic + .hwpx extension', () => {
    expect(detectDocType('a.hwpx', buf(0x50,0x4B,0x03,0x04))).toBe('hwp')
  })
  it('does not treat a plain .zip as hwp', () => {
    expect(detectDocType('a.zip', buf(0x50,0x4B,0x03,0x04))).toBe('unknown')
  })
  it('falls back to extension when bytes are short', () => {
    expect(detectDocType('a.hwp', buf(0x00))).toBe('hwp')
  })
  it('returns unknown for unrelated content', () => {
    expect(detectDocType('a.txt', buf(0x68,0x69))).toBe('unknown')
  })
  it('magic bytes beat a wrong extension (OLE2 named .pdf → hwp)', () => {
    expect(detectDocType('weird.pdf', buf(0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1))).toBe('hwp')
  })
})
