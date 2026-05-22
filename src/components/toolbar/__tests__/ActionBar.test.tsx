import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionBar } from '../ActionBar'
import type { AppMode, ViewMode } from '../../../types/viewModes'

const defaultProps = {
  hasPdf: true,
  appMode: 'viewer' as AppMode,
  viewMode: 'single' as ViewMode,
  onUpload: vi.fn(),
  onExport: vi.fn(),
  isExporting: false,
  onAppModeChange: vi.fn(),
  onViewModeChange: vi.fn(),
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

  it('hides Export PDF button in viewer mode', () => {
    render(<ActionBar {...defaultProps} appMode="viewer" hasPdf={true} />)
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
  })

  it('shows Export PDF button in editor mode', () => {
    render(<ActionBar {...defaultProps} appMode="editor" hasPdf={true} />)
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
  })
})
