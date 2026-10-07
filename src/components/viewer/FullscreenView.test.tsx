import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FullscreenView } from './FullscreenView'
import type { ViewerDoc } from '../../types/viewerDoc'

vi.mock('./PdfPage', () => ({
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
} as unknown as ViewerDoc

const baseProps = {
  pdfDoc: mockDoc,
  kind: 'pdf' as const,
  numPages: 5,
  annotations: [],
  selectedId: null as null | string,
  layout: 'single' as const,
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

  describe('reading aloud', () => {
    it('turns to the page being read, each time it changes', () => {
      const { rerender } = render(<FullscreenView {...baseProps} followPage={null} />)
      expect(screen.getByTestId('page-1')).toBeInTheDocument()
      rerender(<FullscreenView {...baseProps} followPage={3} />)
      expect(screen.getByTestId('page-3')).toBeInTheDocument()
      rerender(<FullscreenView {...baseProps} followPage={4} />)
      expect(screen.getByTestId('page-4')).toBeInTheDocument()
    })

    it('lets the presenter page away between sentences on the same page', () => {
      const { rerender } = render(<FullscreenView {...baseProps} followPage={2} />)
      expect(screen.getByTestId('page-2')).toBeInTheDocument()
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      expect(screen.getByTestId('page-3')).toBeInTheDocument()
      // The next sentence is still on page 2: nothing pulls the view back.
      rerender(<FullscreenView {...baseProps} followPage={2} />)
      expect(screen.getByTestId('page-3')).toBeInTheDocument()
    })

    it('opens on the page being read when presenting starts mid-reading', () => {
      render(<FullscreenView {...baseProps} startPage={1} followPage={4} />)
      expect(screen.getByTestId('page-4')).toBeInTheDocument()
    })
  })

  describe('spread layout', () => {
    // Page 3 is a wide page: it is shown alone and pairing restarts after it.
    const spreads = [[1, 2], [3], [4, 5]]

    it('steps through rows, showing a wide page on its own', () => {
      render(<FullscreenView {...baseProps} layout="spread" spreads={spreads} />)
      expect(screen.getByTestId('page-1')).toBeInTheDocument()
      expect(screen.getByTestId('page-2')).toBeInTheDocument()
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      expect(screen.getByTestId('page-3')).toBeInTheDocument()
      expect(screen.queryByTestId('page-4')).not.toBeInTheDocument()
      fireEvent.keyDown(window, { key: 'ArrowRight' })
      expect(screen.getByTestId('page-4')).toBeInTheDocument()
      expect(screen.getByTestId('page-5')).toBeInTheDocument()
      fireEvent.keyDown(window, { key: 'ArrowLeft' })
      expect(screen.getByTestId('page-3')).toBeInTheDocument()
    })

    it('opens on the row that holds the start page', () => {
      render(<FullscreenView {...baseProps} layout="spread" spreads={spreads} startPage={5} />)
      expect(screen.getByTestId('page-4')).toBeInTheDocument()
      expect(screen.getByTestId('page-5')).toBeInTheDocument()
    })

    it('pairs pages plainly without sizes', () => {
      render(<FullscreenView {...baseProps} layout="spread" startPage={2} />)
      expect(screen.getByTestId('page-1')).toBeInTheDocument()
      expect(screen.getByTestId('page-2')).toBeInTheDocument()
    })
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

  it('calls onExit on Escape keydown (Electron-reliable exit path)', () => {
    const onExit = vi.fn()
    render(<FullscreenView {...baseProps} onExit={onExit} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onExit).toHaveBeenCalled()
  })

  it('Home 키로 첫 페이지로 이동', () => {
    render(<FullscreenView {...baseProps} />)
    // 먼저 3페이지로 이동
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('page-3')).toBeInTheDocument()
    // Home → 1페이지
    fireEvent.keyDown(window, { key: 'Home' })
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
  })

  it('End 키로 마지막 페이지로 이동', () => {
    render(<FullscreenView {...baseProps} />)
    fireEvent.keyDown(window, { key: 'End' })
    expect(screen.getByTestId('page-5')).toBeInTheDocument()
  })

  it('수평 스와이프: deltaX를 80 초과 누산하면 다음 페이지로 이동', () => {
    render(<FullscreenView {...baseProps} />)
    // deltaX 30씩 3번 → 누산 90 > 임계값 80 → 다음 페이지
    fireEvent.wheel(window, { deltaX: 30, deltaY: 0 })
    fireEvent.wheel(window, { deltaX: 30, deltaY: 0 })
    fireEvent.wheel(window, { deltaX: 30, deltaY: 0 })
    expect(screen.getByTestId('page-2')).toBeInTheDocument()
  })

  it('수평 스와이프: deltaX를 -80 미만 누산하면 이전 페이지로 이동', () => {
    render(<FullscreenView {...baseProps} />)
    // 먼저 2페이지로 이동
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByTestId('page-2')).toBeInTheDocument()
    // 왼쪽 스와이프 → 이전 페이지
    fireEvent.wheel(window, { deltaX: -30, deltaY: 0 })
    fireEvent.wheel(window, { deltaX: -30, deltaY: 0 })
    fireEvent.wheel(window, { deltaX: -30, deltaY: 0 })
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
  })
})
