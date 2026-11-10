import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Pages are centred in their scroller, and zoomed in they are wider than it.
 * Plain `center` then overflows both sides and the left side cannot be
 * scrolled to (scrollLeft stops at 0) — a 170 % page lost its first columns.
 * `safe center` (Tailwind `items-center-safe` / `justify-center-safe`) falls
 * back to the start edge when the content does not fit.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

const SCROLLERS: [string, RegExp][] = [
  ['./PdfViewer.tsx', /id="pdf-single-container"/],
  ['./SpreadView.tsx', /overflow-auto h-full/],
  ['./GridView.tsx', /overflow-auto h-full/],
]

describe('page layouts centre safely', () => {
  it.each(SCROLLERS)('%s', (file, marker) => {
    const line = read(file).split('\n').find(l => marker.test(l) && /className=/.test(l))
    expect(line, `scroller className in ${file}`).toBeTruthy()
    expect(line).not.toMatch(/\b(items|justify)-center(?!-safe)\b/)
    expect(line).toMatch(/(items|justify)-center-safe/)
  })

  it('PowerPoint slide layouts', () => {
    const src = read('../office/PptxView.tsx')
    const layout = src.slice(src.indexOf('const layoutClass'), src.indexOf('return', src.indexOf('const layoutClass')))
    expect(layout).not.toMatch(/\b(items|justify)-center(?!-safe)\b/)
  })

  it('Word pages', () => {
    const css = read('../../index.css')
    const docx = css.slice(css.indexOf('/* ── Word'), css.indexOf('/* ── Spreadsheets'))
    expect(docx).toMatch(/\.wz-docx-wrapper\.wz-docx-wrapper \{[^}]*align-items: safe center/)
    expect(docx).not.toMatch(/(justify-content|align-items): center/)
  })
})
