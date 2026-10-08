import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import type { ViewerDoc } from '../types/viewerDoc'
import type { ViewMode } from '../types/viewModes'

function setup(viewMode: ViewMode = 'single', currentPage = 7) {
  const deps = {
    pdfDoc: {} as ViewerDoc,
    flowDoc: false,
    viewMode,
    appMode: 'viewer' as const,
    activeMode: null,
    annotations: [],
    selectedId: null,
    currentPage,
    setViewMode: vi.fn(),
    setShowSearch: vi.fn(),
    onEnterFullscreen: vi.fn(),
    fileInputRef: createRef<HTMLInputElement>(),
    removeAnnotation: vi.fn(),
    clearMarkups: vi.fn(),
    setActiveMode: vi.fn(),
    onRunOcr: vi.fn(),
    onRunOcrAll: vi.fn(),
    onUndo: undefined as (() => void) | undefined,
    onRedo: undefined as (() => void) | undefined,
    onSave: undefined as (() => void) | undefined,
  }
  const hook = renderHook((d: typeof deps) => useGlobalShortcuts(d), { initialProps: deps })
  return Object.assign(deps, { rerender: hook.rerender })
}

const press = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))

describe('presentation shortcuts', () => {
  it('F5 presents from the first page', () => {
    const d = setup('single', 7)
    press({ key: 'F5' })
    expect(d.onEnterFullscreen).toHaveBeenCalledWith(1)
  })

  it('Alt+F5 presents from the page being read', () => {
    const d = setup('single', 7)
    press({ key: 'F5', altKey: true })
    expect(d.onEnterFullscreen).toHaveBeenCalledWith(7)
  })

  it('uses the page in view at the moment of the key press', () => {
    const d = setup('single', 7)
    d.rerender({ ...d, currentPage: 12 })
    press({ key: 'F5', altKey: true })
    expect(d.onEnterFullscreen).toHaveBeenCalledWith(12)
  })

  it('does nothing while already presenting', () => {
    const d = setup('fullscreen', 7)
    press({ key: 'F5', altKey: true })
    expect(d.onEnterFullscreen).not.toHaveBeenCalled()
  })
})

describe('the keydown listener', () => {
  it('is registered once, not again on every render', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const d = setup('single', 1)
    const registered = () => add.mock.calls.filter(([type]) => type === 'keydown').length
    const first = registered()
    for (let page = 2; page < 20; page++) d.rerender({ ...d, currentPage: page, onRunOcr: vi.fn() })
    expect(registered()).toBe(first)
    add.mockRestore()
  })
})

describe('the stamp tool', () => {
  it('stays armed until Esc, which puts it down', () => {
    const d = setup('single', 1)
    d.rerender({ ...d, appMode: 'editor' as never, activeMode: 'stamp' as never })
    press({ key: 'Escape' })
    expect(d.setActiveMode).toHaveBeenCalledWith('select')
    expect(d.clearMarkups).not.toHaveBeenCalled()
  })

  it('keeps the stamp just placed selected after Esc, so Ctrl+C copies it', () => {
    const d = setup('single', 1)
    const selectAnnotation = vi.fn()
    d.rerender({ ...d, appMode: 'editor' as never, activeMode: 'stamp' as never, selectedId: 'st1' as never, selectAnnotation } as never)
    press({ key: 'Escape' })
    expect(selectAnnotation).toHaveBeenCalledWith('st1')
  })
})

describe('copy and paste of stamps', () => {
  it('Ctrl+C / Ctrl+X / Ctrl+V go to the stamp handlers', () => {
    const d = setup('single', 1)
    const onCopyAnnotation = vi.fn(() => true), onCutAnnotation = vi.fn(() => true), onPasteAnnotation = vi.fn(() => true)
    d.rerender({ ...d, onCopyAnnotation, onCutAnnotation, onPasteAnnotation } as never)
    press({ key: 'c', ctrlKey: true })
    press({ key: 'x', ctrlKey: true })
    press({ key: 'v', ctrlKey: true })
    expect(onCopyAnnotation).toHaveBeenCalledTimes(1)
    expect(onCutAnnotation).toHaveBeenCalledTimes(1)
    expect(onPasteAnnotation).toHaveBeenCalledTimes(1)
  })

  it('leaves Ctrl+C to the browser when there is no stamp to copy (copying text)', () => {
    const d = setup('single', 1)
    d.rerender({ ...d, onCopyAnnotation: () => false } as never)
    const event = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('undo and redo keys', () => {
  it('Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo', () => {
    const d = setup('single', 1)
    const onUndo = vi.fn(), onRedo = vi.fn()
    d.rerender({ ...d, onUndo, onRedo })
    press({ key: 'z', ctrlKey: true })
    press({ key: 'y', ctrlKey: true })
    press({ key: 'Z', ctrlKey: true, shiftKey: true })
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onRedo).toHaveBeenCalledTimes(2)
  })

  it('leaves Ctrl+Z to a text field being typed in', () => {
    const d = setup('single', 1)
    const onUndo = vi.fn()
    d.rerender({ ...d, onUndo })
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(onUndo).not.toHaveBeenCalled()
    input.remove()
  })
})

describe('a private (read-only) viewer', () => {
  const key = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    window.dispatchEvent(event)
    return event
  }

  it("swallows Ctrl+S and Ctrl+O instead of handing them to the browser's save and open", () => {
    const d = setup('single', 1)
    d.rerender({ ...d, readOnly: true } as never)
    expect(key({ key: 's', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(key({ key: 'o', ctrlKey: true }).defaultPrevented).toBe(true)
    // With the Korean IME on, the letter arrives as Hangul; the key code does not change.
    expect(key({ key: 'ㄴ', code: 'KeyS', ctrlKey: true }).defaultPrevented).toBe(true)
  })

  it('does not print when printing is not allowed', () => {
    const d = setup('single', 1)
    d.rerender({ ...d, readOnly: true, canPrint: false } as never)
    const printed = vi.fn()
    document.addEventListener('wz-print', printed)
    expect(key({ key: 'p', ctrlKey: true }).defaultPrevented).toBe(true)
    document.removeEventListener('wz-print', printed)
    expect(printed).not.toHaveBeenCalled()
  })

  it('runs no undo, stamp clipboard or markup tool, and opens no file on F2', () => {
    const d = setup('single', 1)
    const onUndo = vi.fn(), onRedo = vi.fn(), onCopyAnnotation = vi.fn(() => true), onCutAnnotation = vi.fn(() => true), onPasteAnnotation = vi.fn(() => true)
    const input = document.createElement('input')
    const click = vi.spyOn(input, 'click')
    d.rerender({ ...d, readOnly: true, onUndo, onRedo, onCopyAnnotation, onCutAnnotation, onPasteAnnotation, fileInputRef: { current: input } } as never)
    for (const k of ['z', 'y', 'c', 'x', 'v']) key({ key: k, ctrlKey: true })
    key({ key: '1' })
    key({ key: '2' })
    key({ key: 'F2' })
    expect(onUndo).not.toHaveBeenCalled()
    expect(onRedo).not.toHaveBeenCalled()
    expect(onCopyAnnotation).not.toHaveBeenCalled()
    expect(onCutAnnotation).not.toHaveBeenCalled()
    expect(onPasteAnnotation).not.toHaveBeenCalled()
    expect(d.setActiveMode).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })

  it('leaves Ctrl+C on selected text to the browser, and keeps the viewing keys', () => {
    const d = setup('single', 3)
    d.rerender({ ...d, readOnly: true } as never)
    expect(key({ key: 'c', ctrlKey: true }).defaultPrevented).toBe(false)
    key({ key: 'f', ctrlKey: true })
    key({ key: 'F5', altKey: true })
    expect(d.setShowSearch).toHaveBeenCalledWith(true)
    expect(d.onEnterFullscreen).toHaveBeenCalledWith(3)
  })
})

describe('Ctrl+S', () => {
  it('saves, even from inside a text field (the Markdown editor)', () => {
    const d = setup('single', 1)
    const onSave = vi.fn()
    d.rerender({ ...d, onSave })
    press({ key: 's', ctrlKey: true })
    const area = document.createElement('textarea')
    document.body.append(area)
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))
    area.remove()
    expect(onSave).toHaveBeenCalledTimes(2)
  })
})

describe('Esc while reading aloud', () => {
  it('pauses the voice and does nothing else', () => {
    const d = setup('single', 1)
    const onSpeechPause = vi.fn()
    d.rerender({ ...d, annotations: [{ id: 'p', type: 'pen', page: 1 }] as never, onSpeechPause } as never)
    press({ key: 'Escape' })
    expect(onSpeechPause).toHaveBeenCalledTimes(1)
    // The markup stays: the second Esc, with the voice paused, clears it.
    expect(d.clearMarkups).not.toHaveBeenCalled()
  })

  it('does what Esc otherwise does once the voice is paused', () => {
    const d = setup('single', 1)
    d.rerender({ ...d, annotations: [{ id: 'p', type: 'pen', page: 1 }] as never, onSpeechPause: undefined } as never)
    press({ key: 'Escape' })
    expect(d.clearMarkups).toHaveBeenCalled()
  })

  it('keeps the presentation open: the fullscreen view never sees that Esc', () => {
    const d = setup('fullscreen', 1)
    const onSpeechPause = vi.fn()
    d.rerender({ ...d, onSpeechPause } as never)
    const later = vi.fn()
    window.addEventListener('keydown', later)
    press({ key: 'Escape' })
    window.removeEventListener('keydown', later)
    expect(onSpeechPause).toHaveBeenCalled()
    expect(later).not.toHaveBeenCalled()
  })
})
