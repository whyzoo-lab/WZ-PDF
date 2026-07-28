import { describe, it, expect } from 'vitest'
import { renderEmailHtml, renderEmailText } from './emailHtml'

describe('renderEmailHtml — hostile input', () => {
  it('drops <script>', () => {
    const { html } = renderEmailHtml('<p>hi</p><script>alert(1)</script>')
    expect(html).toContain('hi')
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html).not.toContain('alert(1)')
  })

  it('drops inline event handlers', () => {
    const { html } = renderEmailHtml('<img src="data:image/png;base64,AAA" onerror="alert(1)">')
    expect(html).not.toContain('onerror')
  })

  it('drops javascript: URLs', () => {
    const { html } = renderEmailHtml('<a href="javascript:alert(1)">x</a>')
    expect(html.toLowerCase()).not.toContain('javascript:')
  })

  it('drops framing and embedding tags', () => {
    const { html } = renderEmailHtml(
      '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="y">',
    )
    expect(html.toLowerCase()).not.toContain('<iframe')
    expect(html.toLowerCase()).not.toContain('<object')
    expect(html.toLowerCase()).not.toContain('<embed')
  })

  it('drops <style> and <link> so a message cannot restyle the app', () => {
    const { html } = renderEmailHtml(
      '<style>body{display:none}</style><link rel="stylesheet" href="https://evil.test/a.css"><p>ok</p>',
    )
    expect(html.toLowerCase()).not.toContain('<style')
    expect(html.toLowerCase()).not.toContain('<link')
    expect(html).toContain('ok')
  })

  it('drops forms', () => {
    const { html } = renderEmailHtml('<form action="https://evil.test"><input name="pw"></form>')
    expect(html.toLowerCase()).not.toContain('<form')
    expect(html.toLowerCase()).not.toContain('<input')
  })

  it('keeps inline style attributes (that is where email formatting lives)', () => {
    const { html } = renderEmailHtml('<p style="color:#c00;font-weight:bold">red</p>')
    expect(html).toContain('style=')
    expect(html).toContain('red')
  })
})

describe('renderEmailHtml — remote images', () => {
  const tracker = '<img src="https://tracker.test/pixel.gif?id=42">'

  it('withholds remote images by default and reports the count', () => {
    const { html, blockedImages } = renderEmailHtml(tracker)
    expect(blockedImages).toBe(1)
    // The URL is deliberately kept in a data- attribute so the reader can opt
    // in later; what must be gone is the live src that would fetch it.
    expect(html).not.toMatch(/\ssrc\s*=/)
    expect(html).toContain('data-wz-blocked-src')
  })

  it('loads them only when explicitly asked', () => {
    const { html, blockedImages } = renderEmailHtml(tracker, true)
    expect(blockedImages).toBe(0)
    expect(html).toContain('https://tracker.test/pixel.gif?id=42')
  })

  it('treats protocol-relative URLs as remote', () => {
    const { blockedImages } = renderEmailHtml('<img src="//tracker.test/p.gif">')
    expect(blockedImages).toBe(1)
  })

  it('always keeps data: images — those are the mail\'s own inlined parts', () => {
    const { html, blockedImages } = renderEmailHtml('<img src="data:image/png;base64,AAAA">')
    expect(blockedImages).toBe(0)
    expect(html).toContain('data:image/png;base64,AAAA')
  })
})

describe('renderEmailHtml — links', () => {
  it('sends links out of the app instead of navigating it', () => {
    const { html } = renderEmailHtml('<a href="https://example.com">go</a>')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('keeps mailto links usable', () => {
    const { html } = renderEmailHtml('<a href="mailto:a@b.com">mail</a>')
    expect(html).toContain('mailto:a@b.com')
  })
})

describe('renderEmailText', () => {
  it('escapes markup so plain text can never become markup', () => {
    expect(renderEmailText('<script>alert(1)</script>')).not.toContain('<script')
    expect(renderEmailText('a & b')).toContain('&amp;')
  })

  it('linkifies bare URLs', () => {
    expect(renderEmailText('see https://example.com now')).toContain('<a href="https://example.com"')
  })
})
