import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdownDoc'

describe('renderMarkdown — document structure', () => {
  it('renders the usual block elements', async () => {
    const { html } = await renderMarkdown([
      '# Title', '', 'A paragraph with **bold** and `code`.', '',
      '- one', '- two', '', '> quoted', '', '```js', 'const a = 1', '```',
    ].join('\n'))
    expect(html).toContain('<h1')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<code>')
    expect(html).toContain('<li>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('const a = 1')
  })

  it('renders GFM tables', async () => {
    const { html } = await renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  it('builds an outline with ids that match the headings', async () => {
    const { outline, html } = await renderMarkdown('# One\n\n## Two\n\n### 한글 제목')
    expect(outline.map(o => [o.level, o.text])).toEqual([[1, 'One'], [2, 'Two'], [3, '한글 제목']])
    for (const entry of outline) expect(html).toContain(`id="${entry.id}"`)
    // Hangul must survive slugification, or the link would point nowhere.
    expect(outline[2].id).toContain('한글')
  })

  it('disambiguates repeated headings', async () => {
    const { outline } = await renderMarkdown('## Notes\n\n## Notes')
    expect(new Set(outline.map(o => o.id)).size).toBe(2)
  })

  it('takes the title from front matter, else the first H1', async () => {
    const fm = await renderMarkdown('---\ntitle: "My Doc"\ndate: 2026-01-01\n---\n\n# Ignored\n')
    expect(fm.title).toBe('My Doc')
    // …and the front matter itself must not be rendered as content.
    expect(fm.html).not.toContain('date:')

    const h1 = await renderMarkdown('# Just A Heading\n\ntext')
    expect(h1.title).toBe('Just A Heading')

    expect((await renderMarkdown('plain text')).title).toBeNull()
  })

  it('keeps task-list state without emitting form controls', async () => {
    const { html } = await renderMarkdown('- [x] done\n- [ ] todo')
    expect(html).not.toContain('<input')
    expect(html).toContain('is-done')
    expect(html).toContain('is-todo')
    expect(html).not.toContain('[x]')
  })
})

describe('renderMarkdown — hostile input', () => {
  it('drops embedded <script>', async () => {
    const { html } = await renderMarkdown('Hi\n\n<script>alert(1)</script>')
    expect(html.toLowerCase()).not.toContain('<script')
  })

  it('drops event handlers on raw HTML', async () => {
    const { html } = await renderMarkdown('<img src="x.png" onerror="alert(1)">')
    expect(html).not.toContain('onerror')
  })

  it('drops javascript: links', async () => {
    const { html } = await renderMarkdown('[click](javascript:alert(1))')
    expect(html.toLowerCase()).not.toContain('javascript:')
  })

  it('drops iframes and <style>', async () => {
    const { html } = await renderMarkdown('<iframe src="https://evil.test"></iframe><style>body{display:none}</style>')
    expect(html.toLowerCase()).not.toContain('<iframe')
    expect(html.toLowerCase()).not.toContain('<style')
  })

  it('sends outbound links away from the app but leaves anchors alone', async () => {
    const { html } = await renderMarkdown('[out](https://example.com)\n\n[in](#section)')
    expect(html).toContain('rel="noopener noreferrer"')
    // The outline relies on in-page anchors still behaving as anchors.
    expect(html).toMatch(/href="#section"(?![^>]*target)/)
  })

  it('allows images — a README\'s pictures are its content', async () => {
    const { html } = await renderMarkdown('![badge](https://img.shields.io/x.svg)')
    expect(html).toContain('https://img.shields.io/x.svg')
  })
})
