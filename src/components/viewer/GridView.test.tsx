import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GridView } from './GridView'
import type { ViewerDoc } from '../../types/viewerDoc'

vi.mock('./LazyPdfPage', () => ({
  LazyPdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))

const mockDoc = {} as ViewerDoc

describe('GridView', () => {
  it('renders all page thumbnails', () => {
    render(<GridView pdfDoc={mockDoc} kind="pdf" numPages={5} annotations={[]} onPageClick={vi.fn()} />)
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`page-${i}`)).toBeInTheDocument()
    }
  })

  it('calls onPageClick with the correct page number when a thumbnail is clicked', () => {
    const onPageClick = vi.fn()
    render(<GridView pdfDoc={mockDoc} kind="pdf" numPages={3} annotations={[]} onPageClick={onPageClick} />)
    fireEvent.click(screen.getByRole('button', { name: /go to page 2/i }))
    expect(onPageClick).toHaveBeenCalledWith(2)
  })

  it('calls onPageClick with page 1 when first thumbnail is clicked', () => {
    const onPageClick = vi.fn()
    render(<GridView pdfDoc={mockDoc} kind="pdf" numPages={3} annotations={[]} onPageClick={onPageClick} />)
    fireEvent.click(screen.getByRole('button', { name: /go to page 1/i }))
    expect(onPageClick).toHaveBeenCalledWith(1)
  })

  it('sizes columns to the typical page and lets a wide page span two', async () => {
    // Pages 1-3 A4 portrait, page 2 A3 landscape.
    const sizes = [[595, 842], [1191, 842], [595, 842], [595, 842]]
    const doc = {
      numPages: 4,
      getPage: vi.fn(async (n: number) => ({
        getViewport: () => ({ width: sizes[n - 1][0], height: sizes[n - 1][1], scale: 1 }),
      })),
    } as unknown as ViewerDoc
    const { container } = render(<GridView pdfDoc={doc} kind="pdf" numPages={4} annotations={[]} onPageClick={vi.fn()} />)
    const grid = container.firstElementChild as HTMLElement
    // A4 at the grid's scale (1.5 x 0.3): 595 x 0.45 = 268 px, as many as fit.
    await waitFor(() => expect(grid.style.gridTemplateColumns).toBe('repeat(auto-fill, 268px)'))
    const wide = screen.getByRole('button', { name: /go to page 2/i })
    expect(wide.style.gridColumn).toBe('span 2')
    expect(screen.getByRole('button', { name: /go to page 3/i }).style.gridColumn).toBe('')
  })
})
