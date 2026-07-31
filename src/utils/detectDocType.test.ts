import { describe, it, expect } from 'vitest'
import { detectDocType, classifyDocFile } from './detectDocType'

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

describe('detectDocType — images', () => {
  it('detects PNG by magic even when the name lies', () => {
    expect(detectDocType('actually.txt', buf(0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A))).toBe('image')
  })
  it('detects JPEG by magic', () => {
    expect(detectDocType('a.jpg', buf(0xFF,0xD8,0xFF,0xE0))).toBe('image')
  })
  it('detects GIF by magic', () => {
    expect(detectDocType('a.gif', buf(0x47,0x49,0x46,0x38,0x39,0x61))).toBe('image')
  })
  it('detects BMP by magic', () => {
    expect(detectDocType('a.bmp', buf(0x42,0x4D,0x46,0x00))).toBe('image')
  })
  it('detects WEBP only when the RIFF payload says WEBP', () => {
    const riff = [0x52,0x49,0x46,0x46, 0,0,0,0]
    expect(detectDocType('a.webp', buf(...riff, 0x57,0x45,0x42,0x50))).toBe('image')
    // Same RIFF container, different payload (e.g. .wav) must not be an image.
    expect(detectDocType('a.wav', buf(...riff, 0x57,0x41,0x56,0x45))).toBe('unknown')
  })
  it('falls back to the extension when bytes are inconclusive', () => {
    expect(detectDocType('a.png', buf(0x00))).toBe('image')
    expect(detectDocType('a.webp', buf(0x00))).toBe('image')
  })
  it('keeps PDF/HWP winning over an image extension', () => {
    expect(detectDocType('trick.png', buf(0x25,0x50,0x44,0x46))).toBe('pdf')
  })
})

describe('classifyDocFile', () => {
  const f = (name: string, type = '') => new File([new Uint8Array([0])], name, { type })
  it('accepts images for upload/drop', () => {
    expect(classifyDocFile(f('a.png')).isImage).toBe(true)
    expect(classifyDocFile(f('a.bmp')).supported).toBe(true)
    expect(classifyDocFile(f('shot', 'image/jpeg')).isImage).toBe(true)
  })
  it('still rejects unrelated files', () => {
    expect(classifyDocFile(f('a.exe')).supported).toBe(false)
  })
})
