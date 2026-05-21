import { describe, it, expect } from 'vitest'
import { base64ToUint8Array } from '../pdfExporter'

describe('base64ToUint8Array', () => {
  it('converts a base64 data URL to Uint8Array', () => {
    // "hello" in base64 is "aGVsbG8="
    const dataUrl = 'data:text/plain;base64,aGVsbG8='
    const result = base64ToUint8Array(dataUrl)
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(5)
    expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]) // "hello"
  })
  it('handles PNG data URL prefix correctly', () => {
    const dataUrl = 'data:image/png;base64,aGVsbG8='
    const result = base64ToUint8Array(dataUrl)
    expect(result.length).toBe(5)
  })
})
