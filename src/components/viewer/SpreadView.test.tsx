import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpreadView } from './SpreadView'
import type { ViewerDoc } from '../../types/viewerDoc'

vi.mock('./LazyPdfPage', () => ({
  LazyPdfPage: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`page-${pageNumber}`} />
  ),
}))

const mockDoc = {} as ViewerDoc
const baseProps = {
  pdfDoc: mockDoc,
  kind: 'pdf' as const,
  zoom: 1,
  annotations: [],
  selectedId: null,
  activeMode: null,
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

  it('lays out the rows it is given (a wide page alone)', () => {
    const { container } = render(<SpreadView {...baseProps} numPages={5} spreads={[[1, 2], [3], [4, 5]]} />)
    const rows = Array.from(container.querySelectorAll('[data-spread-row]'))
    expect(rows.map(r => r.children.length)).toEqual([2, 1, 2])
  })

  it('renders correct number of rows for odd numPages', () => {
    const { container } = render(<SpreadView {...baseProps} numPages={5} />)
    // 5 pages → 3 rows (last row has only page 5)
    const rows = container.querySelectorAll('[data-spread-row]')
    expect(rows).toHaveLength(3)
  })

  it('puts a blank page beside a page left without a partner, but not beside a wide page', () => {
    // 1-2 pair, 3 alone before the A3 page 4, 5 alone at the end.
    const A4 = { width: 595, height: 842 }
    const sizes = [A4, A4, A4, { width: 1191, height: 842 }, A4]
    const { container } = render(
      <SpreadView {...baseProps} numPages={5} spreads={[[1, 2], [3], [4], [5]]} pageSizes={sizes} />,
    )
    const rows = Array.from(container.querySelectorAll('[data-spread-row]'))
    expect(rows.map(r => r.querySelector('[data-spread-blank]') !== null)).toEqual([false, true, false, true])
    // The blank page is the size of the page it partners (A4 at 1.5 x zoom 1).
    const blank = rows[1].querySelector<HTMLElement>('[data-spread-blank]')!
    expect(blank.style.width).toBe('892.5px')
    expect(blank.style.height).toBe('1263px')
  })
})
