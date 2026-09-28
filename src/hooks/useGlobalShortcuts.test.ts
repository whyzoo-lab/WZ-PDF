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
