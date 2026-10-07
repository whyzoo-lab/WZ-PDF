import { describe, it, expect, afterEach, vi } from 'vitest'
import { officeJobToPdf, type PdfJob } from './officePdf'

/** What a job puts in the page, so a test can see when it is printed. */
function job(label: string, pieces = 1): PdfJob {
  return {
    css: '@page { margin: 0 }',
    pieces,
    piece: i => {
      const el = document.createElement('div')
      el.textContent = `${label}-${i}`
      return el
    },
  }
}

describe('officeJobToPdf', () => {
  afterEach(() => {
    delete (window as { electronAPI?: unknown }).electronAPI
    vi.restoreAllMocks()
  })

  it('prints one layout at a time, and leaves the page as it found it', async () => {
    // Two saves started together once printed both documents into each PDF:
    // printToPDF prints the whole page, and both layouts were in it.
    const seen: string[] = []
    const printToPdf = vi.fn(async () => {
      const roots = document.querySelectorAll('#wz-print-root')
      seen.push(Array.from(roots).map(r => r.textContent).join('+'))
      await new Promise(r => setTimeout(r, 5))
      return new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer
    })
    ;(window as unknown as { electronAPI: unknown }).electronAPI = { printToPdf }

    await Promise.all([officeJobToPdf(job('deck')), officeJobToPdf(job('memo'))])
    expect(seen).toEqual(['deck-0', 'memo-0'])
    expect(document.querySelector('#wz-print-root')).toBeNull()
    expect(document.body.hasAttribute('data-wz-printing')).toBe(false)
  })

  it('says it needs the desktop app rather than doing nothing', async () => {
    await expect(officeJobToPdf(job('x'))).rejects.toThrow(/desktop app/)
  })
})
