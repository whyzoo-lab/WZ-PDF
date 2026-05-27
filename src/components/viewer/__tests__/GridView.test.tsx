import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GridView } from '../GridView'
import type { PDFDocumentProxy } from 'pdfjs-dist'

vi.mock('../LazyPdfPage', () => ({
  LazyPdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))

const mockDoc = {} as PDFDocumentProxy

describe('GridView', () => {
  it('renders all page thumbnails', () => {
    render(<GridView pdfDoc={mockDoc} numPages={5} annotations={[]} onPageClick={vi.fn()} />)
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`page-${i}`)).toBeInTheDocument()
    }
  })

  it('calls onPageClick with the correct page number when a thumbnail is clicked', () => {
    const onPageClick = vi.fn()
    render(<GridView pdfDoc={mockDoc} numPages={3} annotations={[]} onPageClick={onPageClick} />)
    fireEvent.click(screen.getByRole('button', { name: /go to page 2/i }))
    expect(onPageClick).toHaveBeenCalledWith(2)
  })

  it('calls onPageClick with page 1 when first thumbnail is clicked', () => {
    const onPageClick = vi.fn()
    render(<GridView pdfDoc={mockDoc} numPages={3} annotations={[]} onPageClick={onPageClick} />)
    fireEvent.click(screen.getByRole('button', { name: /go to page 1/i }))
    expect(onPageClick).toHaveBeenCalledWith(1)
  })
})
