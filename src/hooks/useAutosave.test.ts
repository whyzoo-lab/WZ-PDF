import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutosave, canAutosave, AUTOSAVE_MS, type AutosaveState } from './useAutosave'
import { IMAGE_SET_MIME } from '../types/viewerDoc'
import type { Annotation } from '../types/annotation'

const pdf = (name = 'a.pdf') => new File(['%PDF-1.7 test'], name)
const stamp = { id: 's1', type: 'stamp', page: 1, x: 1, y: 1, width: 10, height: 10, rotation: 0, src: 'data:,' } as unknown as Annotation

let save: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  save = vi.fn(async () => {})
  remove = vi.fn(async () => {})
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { recoverySave: save, recoveryRemove: remove }
})
afterEach(() => {
  vi.useRealTimers()
  delete (window as unknown as { electronAPI?: unknown }).electronAPI
})

function setup(initial: AutosaveState) {
  const keyRef = { current: 'key-00000001' }
  const hook = renderHook(({ s }) => useAutosave(s, keyRef), { initialProps: { s: initial } })
  return { ...hook, keyRef }
}
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_MS) }) }

describe('useAutosave', () => {
  it('writes nothing while there is nothing unsaved', async () => {
    const f = pdf()
    setup({ file: f, openedFile: f, unsaved: false, encrypted: false, annotations: [], markdownText: () => null })
    await tick()
    expect(save).not.toHaveBeenCalled()
  })

  it('writes the bytes once and then only what changed', async () => {
    const f = pdf()
    const base: AutosaveState = { file: f, openedFile: f, path: 'C:\\docs\\a.pdf', unsaved: true, encrypted: false, annotations: [stamp], markdownText: () => null }
    const { rerender } = setup(base)
    await tick()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toMatchObject({ key: 'key-00000001', name: 'a.pdf', path: 'C:\\docs\\a.pdf', modified: false, annotations: [stamp] })
    expect(save.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer)

    await tick()                                   // nothing changed
    expect(save).toHaveBeenCalledTimes(1)

    rerender({ s: { ...base, annotations: [stamp, { ...stamp, id: 's2' } as Annotation] } })
    await tick()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][1]).toBeNull()       // same file: bytes not sent again
  })

  it('sends the edited bytes, marked modified, after a page edit', async () => {
    const opened = pdf()
    const edited = pdf()
    setup({ file: edited, openedFile: opened, unsaved: true, encrypted: false, annotations: [], markdownText: () => null })
    await tick()
    expect(save.mock.calls[0][0]).toMatchObject({ modified: true })
    expect(save.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer)
  })

  it('removes the entry once the changes are saved', async () => {
    const f = pdf()
    const base: AutosaveState = { file: f, openedFile: f, unsaved: true, encrypted: false, annotations: [stamp], markdownText: () => null }
    const { rerender } = setup(base)
    await tick()
    rerender({ s: { ...base, unsaved: false } })
    expect(remove).toHaveBeenCalledWith('key-00000001')
  })

  it('keeps the Markdown being edited', async () => {
    const f = new File(['# title'], 'note.md')
    setup({ file: f, openedFile: f, unsaved: true, encrypted: false, annotations: [], markdownText: () => '# title\n\nnew line' })
    await tick()
    expect(save.mock.calls[0][0]).toMatchObject({ markdownText: '# title\n\nnew line' })
  })
})

describe('canAutosave', () => {
  it('never writes an encrypted document or an edited picture collection', () => {
    const f = pdf()
    expect(canAutosave({ file: f, openedFile: f, encrypted: true })).toBe(false)
    const manifest = new File(['{}'], 'pics', { type: IMAGE_SET_MIME })
    expect(canAutosave({ file: manifest, openedFile: pdf('x.png'), encrypted: false })).toBe(false)
    expect(canAutosave({ file: f, openedFile: f, encrypted: false })).toBe(true)
  })
})
