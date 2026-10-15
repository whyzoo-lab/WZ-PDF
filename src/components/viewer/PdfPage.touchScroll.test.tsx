// A finger swiped on a page must scroll the document. Konva calls
// preventDefault() on touchstart whenever the shape under the finger has its
// `preventDefault` attribute on — the default for every shape — and the page
// picture covers the whole page, so on a phone the document only scrolled when
// swiped in the grey margin. Drawing with the pen still has to hold the page.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PdfPage } from './PdfPage'
import type { ViewerDoc } from '../../types/viewerDoc'

const imageProps: Record<string, unknown>[] = []

vi.mock('../../hooks/usePdfPage', () => ({
  usePdfPage: () => ({ pageData: { canvas: document.createElement('canvas'), width: 600, height: 800 }, isLoading: false }),
}))
vi.mock('react-konva', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const Image = (p: Record<string, unknown>) => { imageProps.push(p); return null }
  return { Stage: Box, Layer: Box, Image, Line: () => null, Rect: () => null }
})

const props = {
  pdfDoc: {} as ViewerDoc,
  kind: 'pdf' as const,
  pageNumber: 1,
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

const lastPicture = () => imageProps[imageProps.length - 1]

describe('touch on the page picture', () => {
  it('leaves the touch to the browser, so a swipe scrolls', () => {
    render(<PdfPage {...props} />)
    expect(lastPicture().preventDefault).toBe(false)
  })

  it('leaves it to the browser with the stamp tool armed too', () => {
    render(<PdfPage {...props} activeMode="stamp" />)
    expect(lastPicture().preventDefault).toBe(false)
  })

  it('holds the page while drawing with the pen or the rectangle', () => {
    render(<PdfPage {...props} activeMode="pen" />)
    expect(lastPicture().preventDefault).toBe(true)
    render(<PdfPage {...props} activeMode="rectangle" />)
    expect(lastPicture().preventDefault).toBe(true)
  })
})
