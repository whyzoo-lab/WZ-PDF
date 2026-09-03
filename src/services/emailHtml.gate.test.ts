import { describe, it, expect } from 'vitest'
import { renderEmailHtml } from './emailHtml'

/**
 * The remote-image gate exists so opening a message does not tell the sender
 * it was opened. Each case here is a way a message could load something from
 * the network *past* a gate that only looked at `<img src="http…">`.
 */
const gated = (html: string) => renderEmailHtml(html, false)
// A withheld image keeps its URL in `data-wz-blocked-src`, which is not a
// loading attribute — only a bare src/poster/href counts.
const loads = (html: string) => /(?:^|[\s"'])(?:src|poster|href|xlink:href)=/i.test(html)

describe('remote image gate — URL forms the old prefix test missed', () => {
  it.each([
    'http:evil.example/p.png',
    'http:/evil.example/p.png',
    'http:\\\\evil.example/p.png',
    'HTTPS://evil.example/p.png',
  ])('withholds %s', src => {
    const out = gated(`<img src="${src}">`)
    expect(out.blockedImages).toBe(1)
    expect(loads(out.html)).toBe(false)
  })

  it('leaves an inlined cid part (data:image) alone', () => {
    const out = gated('<img src="data:image/png;base64,iVBORw0KGgo=">')
    expect(out.blockedImages).toBe(0)
    expect(out.html).toContain('data:image/png')
  })
})

describe('remote image gate — elements other than <img>', () => {
  it.each([
    ['video poster', '<video poster="https://t.example/p.png"></video>'],
    ['source src', '<video><source src="https://t.example/a.mp4"></video>'],
    ['audio src', '<audio src="https://t.example/a.mp3"></audio>'],
    ['svg image href', '<svg><image href="https://t.example/p.png"/></svg>'],
  ])('withholds %s', (_label, html) => {
    const out = gated(html)
    expect(out.blockedImages).toBeGreaterThan(0)
    expect(out.html).not.toContain('t.example')
  })

  it('drops an inline style that would fetch', () => {
    const out = gated('<div style="background:url(https://t.example/p.png)">x</div>')
    expect(out.html).not.toContain('t.example')
    expect(out.blockedImages).toBe(1)
  })

  it('keeps an inline style that does not fetch', () => {
    const out = gated('<div style="color:red">x</div>')
    expect(out.html).toContain('color:')
  })
})

describe('when the reader opts in', () => {
  it('lets every kind of remote reference load', () => {
    const out = renderEmailHtml(
      '<img src="https://t.example/p.png"><video poster="https://t.example/q.png"></video>', true)
    expect(out.blockedImages).toBe(0)
    expect(out.html).toContain('https://t.example/p.png')
    expect(out.html).toContain('https://t.example/q.png')
  })
})

describe('data: on links', () => {
  it('does not survive on <a href>', () => {
    // A data:text/html link is a page; images are the only place data: belongs.
    const out = gated('<a href="data:text/html,<script>1</script>">x</a>')
    expect(out.html).not.toContain('data:text/html')
  })
})
