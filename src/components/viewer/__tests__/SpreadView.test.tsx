import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpreadView } from '../SpreadView'
import type { PDFDocumentProxy } from 'pdfjs-dist'

vi.mock('../PdfPage', () => ({
  PdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))

const mockDoc = {} as PDFDocumentProxy
const baseProps = {
  pdfDoc: mockDoc,
  zoom: 1,
  annotations: [],
  selectedId: null,
  activeMode: null as const,
  pendingStamp: null,
  pendingSignature: null,
  onAnnotationSelect: vi.fn(),
  onAnnotationUpdate: vi.fn(),
  onAnnotationAdd: vi.fn(),
}

describe('SpreadView', () => {
  it('renders all pages for even numPages', () => {
    render(<SpreadView {...baseProps} numPages={4} />)
    for (let i = 1; i <= 4; i++) {
      expect(screen.getByTestId(`page-${i}`)).toBeInTheDocument()
    }
  })

  it('renders all pages for odd numPages', () => {
    render(<SpreadView {...baseProps} numPages={5} />)
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`page-${i}`)).toBeInTheDocument()
    }
  })

  it('renders correct number of page pairs (rows) for even numPages', () => {
    const { container } = render(<SpreadView {...baseProps} numPages={4} />)
    // 4 pages → 2 rows
    const rows = container.querySelectorAll('[data-spread-row]')
    expect(rows).toHaveLength(2)
  })

  it('renders correct number of rows for odd numPages', () => {
    const { container } = render(<SpreadView {...baseProps} numPages={5} />)
    // 5 pages → 3 rows (last row has only page 5)
    const rows = container.querySelectorAll('[data-spread-row]')
    expect(rows).toHaveLength(3)
  })
})
