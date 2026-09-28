import { describe, it, expect } from 'vitest'
import { buildHtmlExport } from './htmlExporter'
import { HTML_EXPORT_MAX_BYTES } from '../utils/constants'

describe('buildHtmlExport', () => {
  it('embeds exactly the PDF bytes, across many pieces', async () => {
    // Just over two 768 KB pieces, with a length that is not a multiple of 3.
    const bytes = new Uint8Array(2 * 768 * 1024 + 1001)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff
    const { blob, filename } = buildHtmlExport(bytes.buffer, '보고서.pdf')
    expect(filename).toBe('보고서.html')
    const html = await blob.text()
    const payload = /var d="([A-Za-z0-9+/=]*)";/.exec(html)?.[1]
    expect(payload).toBeDefined()
    // Compared as base64: equal strings mean equal bytes, and jsdom's atob
    // over ~2 MB is slow enough to time the test out under a full run.
    expect(payload).toBe(Buffer.from(bytes).toString('base64'))
    expect(html).toContain('<title>보고서</title>')
  })

  it('refuses a PDF too large for a browser to open this way', () => {
    const tooBig = { byteLength: HTML_EXPORT_MAX_BYTES + 1 } as ArrayBuffer
    expect(() => buildHtmlExport(tooBig, 'huge.pdf')).toThrow(/300MB/)
  })
})
