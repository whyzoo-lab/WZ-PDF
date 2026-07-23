import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionBar, type ActionBarProps } from './ActionBar'
import type { AppMode, ViewMode } from '../../types/viewModes'

// ── Fixtures ──────────────────────────────────────────────────────────────
// Two fixtures kept intentionally: `baseProps(over)` returns fresh `noop`
// handlers (OCR suite, spy only on the handler under test), while
// `defaultProps` is a stable object of vi.fn()s asserted directly.
function baseProps(over: Partial<ActionBarProps>): ActionBarProps {
  const noop = () => {}
  return {
    hasPdf: true,
    appMode: 'editor', viewMode: 'single', zoom: 1, rotation: 0, activeMode: null,
    selectedId: null, isExporting: false, numPages: 3, currentPage: 1, isPanelOpen: false,
    onTogglePanel: noop, onUpload: noop, onOpenUrl: noop, onExportPdf: noop, onExportHtml: noop,
    onExportImages: noop, onExportExe: noop, onPrint: noop, onAppModeChange: noop,
    onViewModeChange: noop, onZoomIn: noop, onZoomOut: noop, onZoomReset: noop, onZoomSet: noop, onRotate: noop,
    onModeChange: noop, onStampSelect: noop, onSignatureClick: noop, onWatermarkClick: noop,
    onDeleteSelected: noop, onResetMarkups: noop, hasMarkups: false,
    onRunOcr: noop, onRunOcrAll: noop, onCancelOcr: noop, isOcrRunning: false, ocrProgress: null,
    ...over,
  } as ActionBarProps
}

const defaultProps = {
  hasPdf: true,
  appMode: 'viewer' as AppMode,
  viewMode: 'single' as ViewMode,
  zoom: 1,
  rotation: 0,
  activeMode: null,
  selectedId: null as null | string,
  isPanelOpen: false,
  onTogglePanel: vi.fn(),
  isExporting: false,
  numPages: 1,
  currentPage: 1,
  onUpload: vi.fn(),
  onOpenUrl: vi.fn(),
  onPrint: vi.fn(),
  onAppModeChange: vi.fn(),
  onViewModeChange: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onZoomReset: vi.fn(),
  onZoomSet: vi.fn(),
  onRotate: vi.fn(),
  onModeChange: vi.fn(),
  onStampSelect: vi.fn(),
  onSignatureClick: vi.fn(),
  onWatermarkClick: vi.fn(),
  onDeleteSelected: vi.fn(),
  onResetMarkups: vi.fn(),
  hasMarkups: false,
  onRunOcr: vi.fn(),
  onRunOcrAll: vi.fn(),
  onCancelOcr: vi.fn(),
  isOcrRunning: false,
  ocrProgress: null,
  onExportPdf: vi.fn(),
  onExportHtml: vi.fn(),
  onExportImages: vi.fn(),
  onExportExe: vi.fn(),
}

describe('ActionBar OCR control', () => {
  it('fires onRunOcr for the current page', () => {
    const onRunOcr = vi.fn()
    render(<ActionBar {...baseProps({ onRunOcr })} />)
    fireEvent.click(screen.getByRole('button', { name: /OCR \(current page\)|OCR \(현재 페이지\)/i }))
    expect(onRunOcr).toHaveBeenCalledTimes(1)
  })

  it('disables the OCR control while running', () => {
    render(<ActionBar {...baseProps({ isOcrRunning: true })} />)
    expect(screen.getByRole('button', { name: /OCR \(current page\)|OCR \(현재 페이지\)/i })).toBeDisabled()
  })

  it('shows a cancel button during a whole-doc run and fires onCancelOcr', () => {
    const onCancelOcr = vi.fn()
    render(<ActionBar {...baseProps({ ocrProgress: { done: 2, total: 10 }, isOcrRunning: true, onCancelOcr })} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel OCR|OCR 취소/i }))
    expect(onCancelOcr).toHaveBeenCalledTimes(1)
  })
})

describe('ActionBar', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows view mode buttons when hasPdf is true', () => {
    render(<ActionBar {...defaultProps} />)
    expect(screen.getByRole('button', { name: /single page/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /spread/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /grid/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument()
  })

  it('hides view mode buttons when hasPdf is false', () => {
    render(<ActionBar {...defaultProps} hasPdf={false} />)
    expect(screen.queryByRole('button', { name: /single page/i })).not.toBeInTheDocument()
  })

  it('highlights the active view mode button', () => {
    render(<ActionBar {...defaultProps} viewMode="spread" />)
    const spreadBtn = screen.getByRole('button', { name: /spread/i })
    // Active = soft tint (BTN_ACTIVE), not a saturated filled square.
    expect(spreadBtn.className).toContain('bg-white/15')
  })

  it('does not highlight inactive view mode buttons', () => {
    render(<ActionBar {...defaultProps} viewMode="spread" />)
    const singleBtn = screen.getByRole('button', { name: /single page/i })
    expect(singleBtn.className).not.toContain('bg-blue-600')
  })

  it('calls onViewModeChange with correct mode when view button clicked', () => {
    render(<ActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /spread/i }))
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('spread')
  })

  // Editing is a single on/off lock (role="switch"), not two destinations:
  // locked = read-only viewer, unlocked = editor.
  it('unlocks editing when the lock switch is turned on', () => {
    render(<ActionBar {...defaultProps} appMode="viewer" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(defaultProps.onAppModeChange).toHaveBeenCalledWith('editor')
  })

  it('locks back to viewer when the lock switch is turned off', () => {
    render(<ActionBar {...defaultProps} appMode="editor" />)
    fireEvent.click(screen.getByRole('switch'))
    expect(defaultProps.onAppModeChange).toHaveBeenCalledWith('viewer')
  })

  it('reflects the current mode in the lock switch state', () => {
    const { rerender } = render(<ActionBar {...defaultProps} appMode="editor" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    rerender(<ActionBar {...defaultProps} appMode="viewer" />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('shows Upload PDF button always', () => {
    render(<ActionBar {...defaultProps} hasPdf={false} />)
    expect(screen.getByRole('button', { name: /open/i })).toBeInTheDocument()
  })

  it('shows zoom controls in single mode', () => {
    render(<ActionBar {...defaultProps} viewMode="single" />)
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument()
  })

  it('hides zoom controls in grid mode', () => {
    render(<ActionBar {...defaultProps} viewMode="grid" />)
    expect(screen.queryByRole('button', { name: /zoom in/i })).not.toBeInTheDocument()
  })

  it('shows editor tools (Stamp, Signature, Watermark) in editor mode', () => {
    render(<ActionBar {...defaultProps} appMode="editor" />)
    // Anchored so they don't collide with the "Editor mode — stamp / sign /
    // watermark" toggle button's accessible name.
    expect(screen.getByRole('button', { name: /^stamp$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^signature$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^watermark$/i })).toBeInTheDocument()
  })

  it('hides editor tools in viewer mode', () => {
    render(<ActionBar {...defaultProps} appMode="viewer" />)
    expect(screen.queryByRole('button', { name: /^stamp$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^signature$/i })).not.toBeInTheDocument()
  })

  it('shows Delete button in editor mode when selectedId is set', () => {
    render(<ActionBar {...defaultProps} appMode="editor" selectedId="ann-1" />)
    expect(screen.getByRole('button', { name: /delete selected/i })).toBeInTheDocument()
  })

  it('hides Delete button when no annotation is selected', () => {
    render(<ActionBar {...defaultProps} appMode="editor" selectedId={null} />)
    expect(screen.queryByRole('button', { name: /delete selected/i })).not.toBeInTheDocument()
  })

  it('calls onZoomIn when + button is clicked', () => {
    render(<ActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
    expect(defaultProps.onZoomIn).toHaveBeenCalled()
  })

  it('displays the current zoom in the editable field', () => {
    render(<ActionBar {...defaultProps} zoom={1.5} />)
    expect(screen.getByRole('textbox', { name: /zoom level/i })).toHaveValue('150')
  })

  it('commits a typed zoom via onZoomSet on Enter', () => {
    const onZoomSet = vi.fn()
    render(<ActionBar {...defaultProps} zoom={1} onZoomSet={onZoomSet} />)
    const field = screen.getByRole('textbox', { name: /zoom level/i })
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: '175' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onZoomSet).toHaveBeenCalledWith(1.75)
  })

  // ── Export dropdown ─────────────────────────────────────────────────────

  it('shows Export button when hasPdf is true', () => {
    render(<ActionBar {...defaultProps} hasPdf={true} />)
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
  })

  it('hides Export button when hasPdf is false', () => {
    render(<ActionBar {...defaultProps} hasPdf={false} />)
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
  })

  it('opens Export menu on click and shows PDF/HTML/Images options', () => {
    render(<ActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByText('Save PDF')).toBeInTheDocument()
    expect(screen.getByText('Save HTML')).toBeInTheDocument()
    expect(screen.getByText('Save Images')).toBeInTheDocument()
  })

  it('shows EXE Viewer option when onExportExe is provided', () => {
    render(<ActionBar {...defaultProps} onExportExe={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByText('EXE Viewer')).toBeInTheDocument()
  })

  it('hides EXE Viewer option when onExportExe is not provided', () => {
    render(<ActionBar {...defaultProps} onExportExe={undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.queryByText('EXE Viewer')).not.toBeInTheDocument()
  })

  it('calls onExportPdf and closes menu when PDF option clicked', () => {
    const onExportPdf = vi.fn()
    render(<ActionBar {...defaultProps} onExportPdf={onExportPdf} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByText('Save PDF'))
    expect(onExportPdf).toHaveBeenCalled()
    expect(screen.queryByText('Save HTML')).not.toBeInTheDocument()
  })

  it('calls onExportHtml and closes menu when HTML option clicked', () => {
    const onExportHtml = vi.fn()
    render(<ActionBar {...defaultProps} onExportHtml={onExportHtml} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByText('Save HTML'))
    expect(onExportHtml).toHaveBeenCalled()
  })

  it('calls onExportImages and closes menu when Images option clicked', () => {
    const onExportImages = vi.fn()
    render(<ActionBar {...defaultProps} onExportImages={onExportImages} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByText('Save Images'))
    expect(onExportImages).toHaveBeenCalled()
  })

  it('disables Export button while exporting', () => {
    render(<ActionBar {...defaultProps} isExporting={true} />)
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled()
  })

  it('shows the eraser only when markups exist', () => {
    const { rerender } = render(<ActionBar {...defaultProps} hasMarkups={false} />)
    expect(screen.queryByRole('button', { name: /clear markups/i })).not.toBeInTheDocument()
    rerender(<ActionBar {...defaultProps} hasMarkups={true} />)
    expect(screen.getByRole('button', { name: /clear markups/i })).toBeInTheDocument()
  })

  it('calls onResetMarkups when Reset button clicked', () => {
    const onResetMarkups = vi.fn()
    render(<ActionBar {...defaultProps} hasMarkups={true} onResetMarkups={onResetMarkups} />)
    fireEvent.click(screen.getByRole('button', { name: /clear markups/i }))
    expect(onResetMarkups).toHaveBeenCalled()
  })

  it('hides Reset button in fullscreen mode', () => {
    render(<ActionBar {...defaultProps} hasMarkups={true} viewMode="fullscreen" />)
    expect(screen.queryByRole('button', { name: /clear markups/i })).not.toBeInTheDocument()
  })
})
