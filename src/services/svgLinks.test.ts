import { describe, it, expect } from 'vitest'
import { renderEmailHtml } from './emailHtml'
import { renderMarkdown } from './markdownDoc'

// Links must leave the app (a new window → the OS browser), never navigate it.
// Both sanitisers rewrote `a[href]` only, and an SVG anchor carries its target
// in `xlink:href` — so it survived DOMPurify untouched and, clicked, navigated
// the main window itself.
const SVG_LINK = '<svg><a xlink:href="http://localhost:5173/y"><text>click</text></a></svg>'

function anchors(html: string) {
  return Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a'))
}

describe('SVG anchors in documents', () => {
  it('mail: an SVG link opens outside the app', () => {
    const [a] = anchors(renderEmailHtml(SVG_LINK, true).html)
    expect(a).toBeDefined()
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
  })

  it('Markdown: an SVG link opens outside the app, or does not survive at all', async () => {
    const { html } = await renderMarkdown(`before\n\n${SVG_LINK}\n`)
    for (const a of anchors(html)) expect(a.getAttribute('target')).toBe('_blank')
  })

  // An image map is a link as well, and DOMPurify keeps map / area / usemap.
  it('Markdown: an image-map area opens outside the app, or does not survive at all', async () => {
    const map = '<img src="x.png" usemap="#m"><map name="m"><area shape="rect" coords="0,0,9,9" href="https://example.com/"></map>'
    const { html } = await renderMarkdown(`before\n\n${map}\n`)
    const areas = Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('area'))
    for (const area of areas) {
      expect(area.getAttribute('target')).toBe('_blank')
      expect(area.getAttribute('rel')).toContain('noopener')
    }
  })

  it('Markdown: in-page anchors still stay in the page', async () => {
    const [a] = anchors((await renderMarkdown('[top](#intro)\n')).html)
    expect(a).toBeDefined()
    expect(a.getAttribute('target')).toBeNull()
  })
})
