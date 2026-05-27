import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionBar } from '../ActionBar'
import type { AppMode, ViewMode } from '../../../types/viewModes'

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
  onPrint: vi.fn(),
  onAppModeChange: vi.fn(),
  onViewModeChange: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onZoomReset: vi.fn(),
  onRotate: vi.fn(),
  onModeChange: vi.fn(),
  onStampSelect: vi.fn(),
  onSignatureClick: vi.fn(),
  onWatermarkClick: vi.fn(),
  onDeleteSelected: vi.fn(),
  onExportPdf: vi.fn(),
  onExportHtml: vi.fn(),
  onExportImages: vi.fn(),
  onExportExe: vi.fn(),
}

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
    expect(spreadBtn.className).toContain('bg-blue-600')
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

  it('calls onAppModeChange("editor") when Editor button clicked', () => {
    render(<ActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /^editor$/i }))
    expect(defaultProps.onAppModeChange).toHaveBeenCalledWith('editor')
  })

  it('calls onAppModeChange("viewer") when Viewer button clicked', () => {
    render(<ActionBar {...defaultProps} appMode="editor" />)
    fireEvent.click(screen.getByRole('button', { name: /^viewer$/i }))
    expect(defaultProps.onAppModeChange).toHaveBeenCalledWith('viewer')
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
    expect(screen.getByRole('button', { name: /stamp/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /signature/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /watermark/i })).toBeInTheDocument()
  })

  it('hides editor tools in viewer mode', () => {
    render(<ActionBar {...defaultProps} appMode="viewer" />)
    expect(screen.queryByRole('button', { name: /stamp/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /signature/i })).not.toBeInTheDocument()
  })

  it('shows Delete button in editor mode when selectedId is set', () => {
    render(<ActionBar {...defaultProps} appMode="editor" selectedId="ann-1" />)
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('hides Delete button when no annotation is selected', () => {
    render(<ActionBar {...defaultProps} appMode="editor" selectedId={null} />)
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('calls onZoomIn when + button is clicked', () => {
    render(<ActionBar {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }))
    expect(defaultProps.onZoomIn).toHaveBeenCalled()
  })

  it('displays zoom percentage', () => {
    render(<ActionBar {...defaultProps} zoom={1.5} />)
    expect(screen.getByRole('button', { name: /reset zoom/i })).toHaveTextContent('150%')
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
    expect(screen.getByText('PDF 저장')).toBeInTheDocument()
    expect(screen.getByText('HTML Viewer')).toBeInTheDocument()
    expect(screen.getByText('이미지 저장')).toBeInTheDocument()
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
    fireEvent.click(screen.getByText('PDF 저장'))
    expect(onExportPdf).toHaveBeenCalled()
    expect(screen.queryByText('HTML Viewer')).not.toBeInTheDocument()
  })

  it('calls onExportHtml and closes menu when HTML option clicked', () => {
    const onExportHtml = vi.fn()
    render(<ActionBar {...defaultProps} onExportHtml={onExportHtml} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByText('HTML Viewer'))
    expect(onExportHtml).toHaveBeenCalled()
  })

  it('calls onExportImages and closes menu when Images option clicked', () => {
    const onExportImages = vi.fn()
    render(<ActionBar {...defaultProps} onExportImages={onExportImages} />)
    fireEvent.click(screen.getByRole('button', { name: /export/i }))
    fireEvent.click(screen.getByText('이미지 저장'))
    expect(onExportImages).toHaveBeenCalled()
  })

  it('disables Export button while exporting', () => {
    render(<ActionBar {...defaultProps} isExporting={true} />)
    expect(screen.getByRole('button', { name: /내보내는 중/i })).toBeDisabled()
  })
})
