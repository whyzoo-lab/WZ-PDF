import { describe, it, expect } from 'vitest'
import { decodeText, escapeHtml, toBase64 } from './text'

describe('text helpers', () => {
  it('escapes everything that could end text or a double-quoted attribute', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(`&lt;a href=&quot;x&quot;&gt;&amp;'&lt;/a&gt;`)
  })

  it('reads UTF-8, and CP949 when the bytes are not valid UTF-8', () => {
    expect(decodeText(new TextEncoder().encode('한글').buffer as ArrayBuffer)).toBe('한글')
    expect(decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb]).buffer)).toBe('한글')
  })

  it('encodes a buffer larger than one argument list', () => {
    const bytes = new Uint8Array(0x8000 * 3 + 1).fill(65)
    expect(atob(toBase64(bytes))).toBe('A'.repeat(bytes.length))
  })
})
