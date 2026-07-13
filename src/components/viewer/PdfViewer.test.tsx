import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PdfViewer } from './PdfViewer'
import type { ViewerDoc } from '../../types/viewerDoc'

vi.mock('./LazyPdfPage', () => ({
  LazyPdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))
vi.mock('./SpreadView', () => ({
  SpreadView: () => <div data-testid="spread-view" />,
}))
vi.mock('./GridView', () => ({
  GridView: () => <div data-testid="grid-view" />,
}))
vi.mock('./FullscreenView', () => ({
  FullscreenView: () => <div data-testid="fullscreen-view" />,
}))

const mockDoc = {} as ViewerDoc
const baseProps = {
  pdfDoc: mockDoc,
  kind: 'pdf' as const,
  numPages: 3,
  zoom: 1,
  rotation: 0,
  annotations: [],
  selectedId: null,
  activeMode: null,
  pendingStamp: null,
  pendingSignature: null,
  onAnnotationSelect: vi.fn(),
  onAnnotationUpdate: vi.fn(),
  onAnnotationAdd: vi.fn(),
  onGridPageClick: vi.fn(),
  onFullscreenExit: vi.fn(),
  onCurrentPageChange: vi.fn(),
  fullscreenLayout: 'single' as const,
}

describe('PdfViewer', () => {
  it('renders PdfPage components in single mode', () => {
    render(<PdfViewer {...baseProps} viewMode="single" />)
    expect(screen.getByTestId('page-1')).toBeInTheDocument()
    expect(screen.queryByTestId('spread-view')).not.toBeInTheDocument()
  })

  it('assigns id="pdf-page-N" to single mode page wrappers', () => {
    const { container } = render(<PdfViewer {...baseProps} viewMode="single" />)
    expect(container.querySelector('#pdf-page-1')).not.toBeNull()
    expect(container.querySelector('#pdf-page-2')).not.toBeNull()
  })

  it('renders SpreadView in spread mode', () => {
    render(<PdfViewer {...baseProps} viewMode="spread" />)
    expect(screen.getByTestId('spread-view')).toBeInTheDocument()
    expect(screen.queryByTestId('page-1')).not.toBeInTheDocument()
  })

  it('renders GridView in grid mode', () => {
    render(<PdfViewer {...baseProps} viewMode="grid" />)
    expect(screen.getByTestId('grid-view')).toBeInTheDocument()
  })

  it('renders FullscreenView in fullscreen mode', () => {
    render(<PdfViewer {...baseProps} viewMode="fullscreen" />)
    expect(screen.getByTestId('fullscreen-view')).toBeInTheDocument()
  })
})
