import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { ViewerDoc } from '../../types/viewerDoc'

// A stand-in for pdfjs's TextLayer that builds the DOM by pdfjs's own rules
// (pdf.mjs `#processItems` / `#appendText`): a marked-content marker opens a
// wrapper <span> and gets no text element; every item with a `str` gets an
// element in `textDivs`, attached only when the string is non-empty; `hasEOL`
// appends a <br>. Those rules are what made "nth child span" the wrong element.
vi.mock('pdfjs-dist', () => ({
  TextLayer: class {
    textDivs: HTMLElement[] = []
    private items: Array<{ str?: string; hasEOL?: boolean; type?: string }>
    private container: HTMLElement
    constructor({ textContentSource, container }: { textContentSource: { items: never[] }; container: HTMLElement }) {
      this.items = textContentSource.items
      this.container = container
    }
    async render() {
      let parent = this.container
      for (const item of this.items) {
        if (item.str === undefined) {
          if (item.type?.startsWith('beginMarkedContent')) {
            const wrapper = document.createElement('span')
            wrapper.className = 'markedContent'
            parent.append(wrapper)
            parent = wrapper
          } else if (item.type === 'endMarkedContent') {
            parent = parent.parentElement as HTMLElement
          }
          continue
        }
        const div = document.createElement('span')
        div.textContent = item.str
        this.textDivs.push(div)
        if (item.str !== '') parent.append(div)
        if (item.hasEOL) parent.append(document.createElement('br'))
      }
    }
  },
}))

const { PdfTextLayer } = await import('./PdfTextLayer')

// String items (what search indexes): 0 'Intro', 1 '', 2 'the cat', 3 'sat on', 4 'the mat'
const ITEMS = [
  { type: 'beginMarkedContent', tag: 'H1' },
  { str: 'Intro', hasEOL: true },
  { type: 'endMarkedContent' },
  { str: '', hasEOL: true },
  { type: 'beginMarkedContentProps', tag: 'P' },
  { str: 'the cat', hasEOL: false },
  { str: 'sat on', hasEOL: true },
  { type: 'endMarkedContent' },
  { str: 'the mat', hasEOL: false },
]

function doc(): ViewerDoc {
  return {
    getPage: vi.fn(async () => ({
      getTextContent: async () => ({ items: ITEMS }),
      getViewport: () => ({ width: 100, height: 100, scale: 1, rotation: 0 }),
    })),
  } as unknown as ViewerDoc
}

describe('PdfTextLayer search highlights', () => {
  it('highlights the element for the matched text item, not the nth child span', async () => {
    const { container } = render(
      <PdfTextLayer pdfDoc={doc()} pageNumber={1} scale={1} rotation={0} width={100} height={100}
        highlights={[
          { itemStart: 2, itemEnd: 2, active: false, index: 0 },
          { itemStart: 4, itemEnd: 4, active: true, index: 1 },
        ]} />,
    )
    await waitFor(() => expect(container.querySelector('.wz-search-hl-active')).not.toBeNull())
    const hl = [...container.querySelectorAll('.wz-search-hl')].map(e => e.textContent)
    expect(hl).toEqual(['the cat', 'the mat'])
    expect(container.querySelector('.wz-search-hl-active')!.textContent).toBe('the mat')
  })

  it('scrolls the active match into view once, however often highlights re-apply', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    const highlights = [{ itemStart: 4, itemEnd: 4, active: true, index: 3 }]
    const { container, rerender } = render(
      <PdfTextLayer pdfDoc={doc()} pageNumber={1} scale={1} rotation={0} width={100} height={100} highlights={highlights} />,
    )
    await waitFor(() => expect(container.querySelector('.wz-search-hl-active')).not.toBeNull())
    const d = spy.mock.calls.length
    expect(d).toBe(1)
    rerender(<PdfTextLayer pdfDoc={doc()} pageNumber={1} scale={1} rotation={0} width={100} height={100} highlights={[...highlights]} />)
    expect(spy.mock.calls.length).toBe(1)
    spy.mockRestore()
  })
})
