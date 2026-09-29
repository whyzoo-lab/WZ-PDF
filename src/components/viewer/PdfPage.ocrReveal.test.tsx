// The OCR reveal flash plays only for a result that arrives while the page is
// on screen. Pages are unmounted two screens away and mounted again on the way
// back, and that replayed the flash on every scroll after a whole-document OCR.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PdfPage } from './PdfPage'
import type { ViewerDoc } from '../../types/viewerDoc'
import type { OcrPageResult } from '../../types/ocr'

vi.mock('../../hooks/usePdfPage', () => ({
  usePdfPage: () => ({ pageData: { canvas: document.createElement('canvas'), width: 600, height: 800 }, isLoading: false }),
}))
vi.mock('react-konva', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return { Stage: Box, Layer: Box, Image: () => null, Line: () => null, Rect: () => null }
})

const doc = {} as ViewerDoc
const result = {
  words: [{ text: '계약서', x: 10, y: 10, width: 60, height: 12, confidence: 0.9 }],
} as unknown as OcrPageResult

const props = {
  pdfDoc: doc,
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

const revealed = (container: HTMLElement) => container.querySelectorAll('.wz-ocr-span.wz-ocr-reveal').length

describe('OCR reveal flash', () => {
  it('plays when recognition finishes while the page is shown', () => {
    const { container, rerender } = render(<PdfPage {...props} />)
    rerender(<PdfPage {...props} ocrResult={result} />)
    expect(container.querySelectorAll('.wz-ocr-span')).toHaveLength(1)
    expect(revealed(container)).toBe(1)
  })

  it('does not replay when a page that was already recognized mounts again', () => {
    const { container } = render(<PdfPage {...props} ocrResult={result} />)
    expect(container.querySelectorAll('.wz-ocr-span')).toHaveLength(1)
    expect(revealed(container)).toBe(0)
  })
})
