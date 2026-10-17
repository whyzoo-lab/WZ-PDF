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
    flowDoc: false,
    appMode: 'editor', viewMode: 'single', zoom: 1, rotation: 0, activeMode: null,
    selectedId: null, isExporting: false, numPages: 3, currentPage: 1, isPanelOpen: false,
    onTogglePanel: noop, onUpload: noop, onOpenUrl: noop, onExportPdf: noop, onPassword: noop, onExportHtml: noop,
    onExportImages: noop, onExportExe: noop, onPrint: noop, onAppModeChange: noop,
    onViewModeChange: noop, onZoomIn: noop, onZoomOut: noop, onZoomReset: noop, onZoomSet: noop, onFitWidth: noop, onRotate: noop, onRotateLeft: noop,
    onModeChange: noop, onStampSelect: noop, onSignatureClick: noop, onWatermarkClick: noop,
    onDeleteSelected: noop, onResetMarkups: noop, hasMarkups: false,
    onRunOcr: noop, onRunOcrAll: noop, onCancelOcr: noop, isOcrRunning: false, ocrProgress: null,
    ...over,
  } as ActionBarProps
}

const defaultProps = {
  hasPdf: true,
  flowDoc: false,
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
  onFitWidth: vi.fn(),
  onRotate: vi.fn(),
  onRotateLeft: vi.fn(),
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
  onPassword: vi.fn(),
  onExportHtml: vi.fn(),
  onExportImages: vi.fn(),
  onExportExe: vi.fn(),
}

// OCR is one rail button with a menu: this page, the whole document, and
// cancel while a run is under way.
const openOcr = () => fireEvent.click(screen.getByRole('button', { name: /Recognize text \(OCR\)/i }))

describe('ActionBar OCR control', () => {
  it('runs the current page from the menu', () => {
    const onRunOcr = vi.fn()
    render(<ActionBar {...baseProps({ onRunOcr })} />)
    openOcr()
    fireEvent.click(screen.getByRole('menuitem', { name: /Recognize this page/i }))
    expect(onRunOcr).toHaveBeenCalledTimes(1)
  })

  it('cannot start another run while one is running', () => {
    render(<ActionBar {...baseProps({ isOcrRunning: true })} />)
    openOcr()
    expect(screen.getByRole('menuitem', { name: /Recognize this page/i })).toBeDisabled()
  })

  it('offers the range as a menu: this page or the whole document', () => {
    const onRunOcr = vi.fn()
    const onRunOcrAll = vi.fn()
    render(<ActionBar {...baseProps({ onRunOcr, onRunOcrAll })} />)
    expect(screen.queryByText('ALL')).toBeNull()
    openOcr()
    fireEvent.click(screen.getByRole('menuitem', { name: /whole document/i }))
    expect(onRunOcrAll).toHaveBeenCalledTimes(1)
    expect(onRunOcr).not.toHaveBeenCalled()
  })

  it('shows progress on the button and cancels from the menu', () => {
    const onCancelOcr = vi.fn()
    render(<ActionBar {...baseProps({ ocrProgress: { done: 2, total: 10 }, isOcrRunning: true, onCancelOcr })} />)
    expect(screen.getByRole('button', { name: /Recognize text \(OCR\)/i })).toHaveTextContent('2/10')
    openOcr()
    fireEvent.click(screen.getByRole('menuitem', { name: /Cancel OCR/i }))
    expect(onCancelOcr).toHaveBeenCalledTimes(1)
  })
})

describe('ActionBar', () => {
  beforeEach(() => { vi.clearAllMocks() })

  // The page layouts are one rail button with a menu; fullscreen is its own.
  const openLayout = () => fireEvent.click(screen.getByRole('button', { name: /page layout/i }))

  it('offers the page layouts and fullscreen when a page document is open', () => {
    render(<ActionBar {...defaultProps} />)
    openLayout()
    expect(screen.getByRole('menuitemradio', { name: /single page/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /spread/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /grid/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /fullscreen/i })).toBeInTheDocument()
  })

  it('hides the page layouts when nothing is open', () => {
    render(<ActionBar {...defaultProps} hasPdf={false} />)
    expect(screen.queryByRole('button', { name: /page layout/i })).not.toBeInTheDocument()
  })

  it('marks the current layout in the menu', () => {
    render(<ActionBar {...defaultProps} viewMode="spread" />)
    openLayout()
    expect(screen.getByRole('menuitemradio', { name: /spread/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: /single page/i })).toHaveAttribute('aria-checked', 'false')
  })

  it('changes the layout and closes the menu', () => {
    render(<ActionBar {...defaultProps} />)
    openLayout()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /spread/i }))
    expect(defaultProps.onViewModeChange).toHaveBeenCalledWith('spread')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes a menu on Escape and on a click outside it', () => {
    render(<ActionBar {...defaultProps} />)
    openLayout()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    openLayout()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows the file name and the page counter in the title bar', () => {
    render(<ActionBar {...defaultProps} fileName="report.pdf" numPages={12} currentPage={3} />)
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByLabelText('Page 3 of 12')).toHaveTextContent('3 / 12')
  })

  it('opens the find bar from the rail', () => {
    const onFind = vi.fn()
    render(<ActionBar {...defaultProps} onFind={onFind} />)
    fireEvent.click(screen.getByRole('button', { name: /^find$/i }))
    expect(onFind).toHaveBeenCalled()
  })

  it('lays the document out inside the chrome', () => {
    render(<ActionBar {...defaultProps}><p>the document</p></ActionBar>)
    expect(screen.getByText('the document')).toBeInTheDocument()
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

  it('shows the open button even with nothing open', () => {
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

  it('lists saved stamps under "My stamps", to use again or remove', () => {
    const seal = { id: 's1', name: 'Company seal', src: 'data:image/png;base64,AA==', width: 72, height: 72, createdAt: 1 }
    const onSavedStampSelect = vi.fn()
    const onSavedStampRemove = vi.fn()
    render(<ActionBar {...defaultProps} appMode="editor" savedStamps={[seal]}
      onSavedStampSelect={onSavedStampSelect} onSavedStampRemove={onSavedStampRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /^stamp$/i }))
    expect(screen.getByText('My stamps')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /remove the company seal stamp/i }))
    expect(onSavedStampRemove).toHaveBeenCalledWith('s1')
    fireEvent.click(screen.getByText('Company seal'))
    expect(onSavedStampSelect).toHaveBeenCalledWith(seal)
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

  it('offers fit-width beside the zoom controls', () => {
    // Chrome's PDF viewer opens at fit-width; this app deliberately fits the
    // whole page so a one-page document does not open with a scrollbar, so the
    // sharper view has to be reachable in one click.
    const onFitWidth = vi.fn()
    render(<ActionBar {...defaultProps} onFitWidth={onFitWidth} />)
    fireEvent.click(screen.getByLabelText(/너비 맞춤|Fit width/))
    expect(onFitWidth).toHaveBeenCalled()
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

  // ── Save menu ───────────────────────────────────────────────────────────
  // One rail button; Save as PDF is first, then the other formats.
  const openSave = () => fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

  it('shows the save button when a document is open', () => {
    render(<ActionBar {...defaultProps} hasPdf={true} />)
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()
  })

  it('hides the save button when nothing is open', () => {
    render(<ActionBar {...defaultProps} hasPdf={false} />)
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
  })

  it('opens the save menu with PDF first, then HTML and images', () => {
    render(<ActionBar {...defaultProps} />)
    openSave()
    expect(screen.getAllByRole('menuitem')[0]).toHaveTextContent('Save as PDF')
    expect(screen.getByText('Save HTML')).toBeInTheDocument()
    expect(screen.getByText('Save Images')).toBeInTheDocument()
  })

  it('shows EXE Viewer option when onExportExe is provided', () => {
    render(<ActionBar {...defaultProps} onExportExe={vi.fn()} />)
    openSave()
    expect(screen.getByText('Export as EXE')).toBeInTheDocument()
  })

  it('offers the file itself, named by its extension', () => {
    const onSaveOriginal = vi.fn()
    render(<ActionBar {...defaultProps} onSaveOriginal={onSaveOriginal} originalExt=".pptx" />)
    openSave()
    expect(screen.getByText('.pptx')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Save original file'))
    expect(onSaveOriginal).toHaveBeenCalled()
  })

  it('keeps "Save as PDF" in the menu for a PDF, since there is no separate save button now', () => {
    render(<ActionBar {...defaultProps} onSaveOriginal={vi.fn()} originalExt=".pdf" pdfIsOriginal />)
    openSave()
    expect(screen.getByText('Save original file')).toBeInTheDocument()
    expect(screen.getByText('Save as PDF')).toBeInTheDocument()
  })

  it('gives a reflowing document the same save menu, without the page-only formats', () => {
    render(<ActionBar {...defaultProps} hasPdf={false} flowDoc onExportHtml={undefined} onExportImages={undefined}
      onSaveOriginal={vi.fn()} onExportExe={vi.fn()} />)
    openSave()
    expect(screen.getByText('Save original file')).toBeInTheDocument()
    expect(screen.getByText('Save as PDF')).toBeInTheDocument()
    expect(screen.getByText('Export as EXE')).toBeInTheDocument()
    expect(screen.queryByText('Save HTML')).not.toBeInTheDocument()
  })

  it('hides EXE Viewer option when onExportExe is not provided', () => {
    render(<ActionBar {...defaultProps} onExportExe={undefined} />)
    openSave()
    expect(screen.queryByText('Export as EXE')).not.toBeInTheDocument()
  })

  it('calls onExportPdf and closes menu when PDF option clicked', () => {
    const onExportPdf = vi.fn()
    render(<ActionBar {...defaultProps} onExportPdf={onExportPdf} />)
    openSave()
    fireEvent.click(screen.getByText('Save as PDF'))
    expect(onExportPdf).toHaveBeenCalled()
    expect(screen.queryByText('Save HTML')).not.toBeInTheDocument()
  })

  it('calls onExportHtml when HTML option clicked', () => {
    const onExportHtml = vi.fn()
    render(<ActionBar {...defaultProps} onExportHtml={onExportHtml} />)
    openSave()
    fireEvent.click(screen.getByText('Save HTML'))
    expect(onExportHtml).toHaveBeenCalled()
  })

  it('offers "save as booklet" in the save menu when given a handler', () => {
    const onExportSpreads = vi.fn()
    render(<ActionBar {...defaultProps} onExportSpreads={onExportSpreads} />)
    openSave()
    fireEvent.click(screen.getByText('Save as booklet'))
    expect(onExportSpreads).toHaveBeenCalled()
  })

  it('leaves "save as booklet" out without a handler', () => {
    render(<ActionBar {...defaultProps} />)
    openSave()
    expect(screen.queryByText('Save as booklet')).not.toBeInTheDocument()
  })

  it('calls onExportImages when Images option clicked', () => {
    const onExportImages = vi.fn()
    render(<ActionBar {...defaultProps} onExportImages={onExportImages} />)
    openSave()
    fireEvent.click(screen.getByText('Save Images'))
    expect(onExportImages).toHaveBeenCalled()
  })

  it('disables the save button while exporting', () => {
    render(<ActionBar {...defaultProps} isExporting={true} />)
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
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

describe('ActionBar command palette', () => {
  it('opens with Ctrl+K, finds a command by name and runs it with Enter', () => {
    const onRotate = vi.fn()
    render(<ActionBar {...baseProps({ onRotate })} />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'rotate right' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onRotate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('moves with the arrow keys and closes on Escape', () => {
    const onZoomIn = vi.fn(), onZoomOut = vi.fn()
    render(<ActionBar {...baseProps({ onZoomIn, onZoomOut })} />)
    fireEvent.click(screen.getByRole('button', { name: /command search/i }))
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'zoom' } })
    const options = screen.getAllByRole('option').map(o => o.textContent)
    expect(options[0]).toMatch(/zoom in/i)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onZoomOut).toHaveBeenCalledTimes(1)
    expect(onZoomIn).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('offers only what the open document has', () => {
    render(<ActionBar {...baseProps({ hasPdf: false })} />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rotate' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
