import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Toolbar } from '../Toolbar'
import type { AppMode, ViewMode } from '../../../types/viewModes'

const defaultProps = {
  activeMode: null as const,
  selectedId: null as null | string,
  zoom: 1,
  hasPdf: true,
  appMode: 'editor' as AppMode,
  viewMode: 'single' as ViewMode,
  onModeChange: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onZoomReset: vi.fn(),
  onDeleteSelected: vi.fn(),
  onStampSelect: vi.fn(),
  onSignatureClick: vi.fn(),
  onWatermarkClick: vi.fn(),
}

describe('Toolbar', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows Stamp button in editor mode', () => {
    render(<Toolbar {...defaultProps} appMode="editor" />)
    expect(screen.getByRole('button', { name: /stamp/i })).toBeInTheDocument()
  })

  it('hides Stamp button in viewer mode', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" />)
    expect(screen.queryByRole('button', { name: /stamp/i })).not.toBeInTheDocument()
  })

  it('hides Signature button in viewer mode', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" />)
    expect(screen.queryByRole('button', { name: /signature/i })).not.toBeInTheDocument()
  })

  it('hides Watermark button in viewer mode', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" />)
    expect(screen.queryByRole('button', { name: /watermark/i })).not.toBeInTheDocument()
  })

  it('shows Select button in viewer mode', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" />)
    expect(screen.getByRole('button', { name: /select/i })).toBeInTheDocument()
  })

  it('hides Delete button in viewer mode even when selectedId is set', () => {
    render(<Toolbar {...defaultProps} appMode="viewer" selectedId="ann-1" />)
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })

  it('shows ZoomControls in single mode', () => {
    render(<Toolbar {...defaultProps} viewMode="single" />)
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument()
  })

  it('hides ZoomControls in grid mode', () => {
    render(<Toolbar {...defaultProps} viewMode="grid" />)
    expect(screen.queryByRole('button', { name: /zoom in/i })).not.toBeInTheDocument()
  })
})
