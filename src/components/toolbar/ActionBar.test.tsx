import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActionBar, type ActionBarProps } from './ActionBar'

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
