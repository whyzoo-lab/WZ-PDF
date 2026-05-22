import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FullscreenView } from '../FullscreenView'
import type { PDFDocumentProxy } from 'pdfjs-dist'

vi.mock('../PdfPage', () => ({
  PdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))

const mockRequestFullscreen = vi.fn().mockResolvedValue(undefined)
const mockExitFullscreen = vi.fn().mockResolvedValue(undefined)

const mockDoc = {
  getPage: vi.fn().mockResolvedValue({
    getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
  }),
} as unknown as PDFDocumentProxy

const baseProps = {
  pdfDoc: mockDoc,
  numPages: 5,
  annotations: [],
  selectedId: null as null | string,
  onAnnotationSelect: vi.fn(),
  onAnnotationUpdate: vi.fn(),
  onExit: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()

  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    value: mockRequestFullscreen,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(document, 'exitFullscreen', {
    value: mockExitFullscreen,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(document, 'fullscreenElement', {
    value: null,
    writable: true,
    configurable: true,
  })
})

describe('FullscreenView', () => {
  it('requests fullscreen on mount', () => {
    render(<FullscreenView {...baseProps} />)
    expect(mockRequestFullscreen).toHaveBeenCalled()
  })

  it('shows page 1 on initial render', () => {
    render(<FullscreenView {...baseProps} />)
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
  })

  it('shows page overlay with "1 / 5"', () => {
    render(<FullscreenView {...baseProps} />)
    expect(screen.getByText(/1\s*\/\s*5/)).toBeInTheDocument()
  })

  it('navigates to page 2 on ArrowRight', () => {
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('page-2')).toBeInTheDocument()
  })

  it('navigates to page 2 on PageDown', () => {
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(screen.getByTestId('page-2')).toBeInTheDocument()
  })

  it('does not navigate before page 1 on ArrowLeft', () => {
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
  })

  it('does not navigate past last page on ArrowRight', () => {
    render(<FullscreenView {...baseProps} numPages={1} />)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
  })

  it('calls onExit when fullscreenchange fires with no fullscreenElement', () => {
    const onExit = vi.fn()
    render(<FullscreenView {...baseProps} onExit={onExit} />)
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(onExit).toHaveBeenCalled()
  })

  it('does not call onExit on unmount-triggered fullscreenchange', () => {
    const onExit = vi.fn()
    const { unmount } = render(<FullscreenView {...baseProps} onExit={onExit} />)
    unmount()
    // fullscreenchange may fire after unmount; onExit should NOT be called again
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(onExit).not.toHaveBeenCalled()
  })
})
