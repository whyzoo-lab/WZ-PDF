import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { printFlowDoc, FLOW_PRINT_ATTR } from './htmlPrint'

/** What the print stylesheet keys off, captured at the moment print() fires. */
interface Snapshot {
  rootMounted: boolean
  printing: boolean
  flowPrinting: boolean
  pageMargin: boolean
  clonedHtml: string
}

let snapshot: Snapshot | null = null

function stubPrint(impl?: () => void) {
  window.print = vi.fn(() => {
    const root = document.getElementById('wz-print-root')
    snapshot = {
      rootMounted: !!root,
      printing: document.body.hasAttribute('data-wz-printing'),
      flowPrinting: document.body.hasAttribute('data-wz-flow-printing'),
      pageMargin: Array.from(document.head.querySelectorAll('style'))
        .some(s => s.textContent?.includes('@page') && s.textContent.includes('mm')),
      clonedHtml: root?.innerHTML ?? '',
    }
    impl?.()
  })
}

function mountDoc(inner: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = `<article ${FLOW_PRINT_ATTR}>${inner}</article>`
  document.body.appendChild(host)
  return host
}

describe('printFlowDoc', () => {
  beforeEach(() => {
    snapshot = null
    document.body.innerHTML = ''
    document.head.querySelectorAll('style').forEach(s => s.remove())
    stubPrint()
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('does nothing when no document is marked printable', async () => {
    expect(await printFlowDoc()).toBe(false)
    expect(window.print).not.toHaveBeenCalled()
  })

  it('prints a clone of the marked element, not the element itself', async () => {
    const host = mountDoc('<h1>제목</h1><p>본문</p>')
    const original = host.firstElementChild!

    expect(await printFlowDoc()).toBe(true)
    expect(snapshot?.clonedHtml).toContain('제목')
    expect(snapshot?.clonedHtml).toContain('본문')
    // The live document must be left exactly where it was — the print root got
    // a copy, so nothing the user is reading is moved or re-parented.
    expect(original.isConnected).toBe(true)
    expect(original.parentElement).toBe(host)
  })

  it('marks the body so the print stylesheet hides the app shell', async () => {
    mountDoc('<p>본문</p>')
    await printFlowDoc()
    expect(snapshot?.rootMounted).toBe(true)
    expect(snapshot?.printing).toBe(true)
    expect(snapshot?.flowPrinting).toBe(true)
  })

  it('overrides the zero page margin that the rasterised path needs', async () => {
    mountDoc('<p>본문</p>')
    await printFlowDoc()
    expect(snapshot?.pageMargin).toBe(true)
  })

  it('leaves nothing behind afterwards', async () => {
    mountDoc('<p>본문</p>')
    await printFlowDoc()
    expect(document.getElementById('wz-print-root')).toBeNull()
    expect(document.body.hasAttribute('data-wz-printing')).toBe(false)
    expect(document.body.hasAttribute('data-wz-flow-printing')).toBe(false)
    expect(document.head.querySelector('style')).toBeNull()
  })

  it('cleans up even when the print dialog throws', async () => {
    mountDoc('<p>본문</p>')
    stubPrint(() => { throw new Error('no printer') })

    // The app shell is hidden at this point, so a throw that skipped cleanup
    // would strand the user on a blank window.
    await expect(printFlowDoc()).rejects.toThrow('no printer')
    expect(document.getElementById('wz-print-root')).toBeNull()
    expect(document.body.hasAttribute('data-wz-printing')).toBe(false)
    expect(document.head.querySelector('style')).toBeNull()
  })

  it('still prints when an image cannot be decoded', async () => {
    mountDoc('<img src="broken.png" alt=""><p>본문</p>')
    const img = document.querySelector('img')!
    // Rejecting decode is the normal outcome for an image that failed to load.
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: () => Promise.reject(new Error('decode failed')),
    })
    try {
      expect(await printFlowDoc()).toBe(true)
      expect(snapshot?.clonedHtml).toContain('본문')
    } finally {
      Reflect.deleteProperty(HTMLImageElement.prototype, 'decode')
      img.remove()
    }
  })
})
