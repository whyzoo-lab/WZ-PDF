import { describe, it, expect } from 'vitest'
import { sanitizeDocxCss } from './docxDoc'
import { renderEmailHtml } from './emailHtml'
import { renderMarkdown } from './markdownDoc'
import { htmlToText } from '../../mcp/src/docText'

/** What a crafted document used to get past the readers. */

describe('Word stylesheet scoping', () => {
  it.each([
    'body:has(.wz-docx) button { display: none }',
    '.wz-docx ~ * { display: none }',
    '.wz-docx + * { display: none }',
    ':not(.wz-docx) button { display: none }',
    'button[x=".wz-docx"] { display: none }',
    ':is(.wz-docx, body) button { display: none }',
  ])('drops %s', css => {
    expect(sanitizeDocxCss(css)).toBe('')
  })

  it('keeps what docx-preview writes', () => {
    const css = sanitizeDocxCss('.wz-docx p { color: red }\nsection.wz-docx > article { margin: 0 }')
    expect(css).toContain('.wz-docx p')
    expect(css).toContain('article')
  })
})

describe('mail tracking pixels', () => {
  it('sees url( through CSS escapes', () => {
    const { html, blockedImages } = renderEmailHtml('<p style="background:u\\72l(https://evil.example/p.png)">x</p>')
    expect(blockedImages).toBe(1)
    expect(html).not.toContain('evil.example')
  })
})

describe('repeated Markdown headings', () => {
  it('numbers them as GitHub does, without rescanning', async () => {
    const small = await renderMarkdown('# a\n\n# a\n\n# a-2\n\n# a\n')
    expect(small.outline.map(h => h.id)).toEqual(['a', 'a-2', 'a-2-2', 'a-3'])

    const many = '# a\n\n'.repeat(20_000)
    const started = performance.now()
    const doc = await renderMarkdown(many)
    expect(doc.outline).toHaveLength(20_000)
    expect(new Set(doc.outline.map(h => h.id)).size).toBe(20_000)
    expect(performance.now() - started).toBeLessThan(10_000)
  })
})

describe('mail body to text', () => {
  it('drops hidden elements and tags, and stays linear on unclosed ones', () => {
    expect(htmlToText('<style>p{}</style><p>본문 <b>굵게</b></p>')).toBe('본문 굵게')
    const started = performance.now()
    htmlToText('<style '.repeat(40_000))
    htmlToText('<'.repeat(100_000))
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('keeps text after an element that never closes', () => {
    expect(htmlToText('앞 <script> 뒤')).toContain('앞')
  })
})
