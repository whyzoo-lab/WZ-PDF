import { describe, it, expect, vi } from 'vitest'
import { stripDocExt, saveBlobTo, pickSaveTarget } from './download'

describe('stripDocExt', () => {
  it('strips every extension the app can open', () => {
    expect(stripDocExt('report.pdf')).toBe('report')
    expect(stripDocExt('report.hwp')).toBe('report')
    expect(stripDocExt('report.hwpx')).toBe('report')
    expect(stripDocExt('mail.eml')).toBe('mail')
    expect(stripDocExt('photo.JPG')).toBe('photo')
    expect(stripDocExt('scan.bmp')).toBe('scan')
  })
  it('leaves dots inside the name alone', () => {
    expect(stripDocExt('2026.07.report.pdf')).toBe('2026.07.report')
  })
  it('leaves an unknown extension in place rather than guessing', () => {
    expect(stripDocExt('archive.tar.gz')).toBe('archive.tar.gz')
  })
})

describe('saveBlobTo', () => {
  it('reports failure — and writes nothing — when the user cancelled', async () => {
    const clicked = vi.fn()
    const real = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = clicked
    const ok = await saveBlobTo({ kind: 'canceled' }, new Blob(['x']), 'a.txt')
    HTMLAnchorElement.prototype.click = real
    // The caller uses this to decide whether to claim "saved".
    expect(ok).toBe(false)
    expect(clicked).not.toHaveBeenCalled()
  })

  it('falls back to a download where there is no save picker', async () => {
    let name: string | null = null
    const real = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { name = this.download }
    const ok = await saveBlobTo({ kind: 'unsupported' }, new Blob(['x']), 'fallback.txt')
    HTMLAnchorElement.prototype.click = real
    expect(ok).toBe(true)
    expect(name).toBe('fallback.txt')
  })

  it('writes through the handle and only resolves once closed', async () => {
    const calls: string[] = []
    const handle = {
      createWritable: async () => ({
        write: async () => { calls.push('write') },
        close: async () => { calls.push('close') },
      }),
    } as unknown as FileSystemFileHandle
    const ok = await saveBlobTo({ kind: 'file', handle }, new Blob(['x']), 'a.txt')
    expect(ok).toBe(true)
    // close() is what flushes — the success toast must not fire before it.
    expect(calls).toEqual(['write', 'close'])
  })
})

describe('pickSaveTarget', () => {
  it('is "unsupported" (not an error) when the browser has no picker', async () => {
    const w = window as unknown as { showSaveFilePicker?: unknown }
    const had = w.showSaveFilePicker
    delete w.showSaveFilePicker
    expect((await pickSaveTarget('a.pdf', { description: 'PDF', accept: {} })).kind).toBe('unsupported')
    if (had) w.showSaveFilePicker = had
  })

  it('maps a dismissed dialog to "canceled" so no success is claimed', async () => {
    const w = window as unknown as { showSaveFilePicker?: unknown }
    const had = w.showSaveFilePicker
    w.showSaveFilePicker = () => Promise.reject(new DOMException('x', 'AbortError'))
    expect((await pickSaveTarget('a.pdf', { description: 'PDF', accept: {} })).kind).toBe('canceled')
    if (had) w.showSaveFilePicker = had; else delete w.showSaveFilePicker
  })
})
