import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { OcrTextLayer } from './OcrTextLayer'
import type { OcrWord } from '../../types/ocr'

const words: OcrWord[] = [
  { text: 'alpha', score: 1, x: 10, y: 20, width: 40, height: 12, rotation: 0 },
  { text: 'beta',  score: 1, x: 10, y: 40, width: 30, height: 12, rotation: 0 },
]

describe('OcrTextLayer', () => {
  it('renders one span per word in order, positioned at x*scale', () => {
    const { container } = render(
      <OcrTextLayer words={words} scale={2} width={200} height={200} />,
    )
    const spans = container.querySelectorAll(':scope > div > span')
    expect(spans).toHaveLength(2)
    expect(spans[0].textContent).toBe('alpha')
    expect((spans[0] as HTMLElement).style.left).toBe('20px') // 10 * 2
    expect((spans[0] as HTMLElement).style.top).toBe('40px')  // 20 * 2
  })

  it('applies highlight classes by item index', () => {
    const { container } = render(
      <OcrTextLayer words={words} scale={1} width={200} height={200}
        highlights={[{ itemStart: 1, itemEnd: 1, active: true }]} />,
    )
    const spans = container.querySelectorAll<HTMLElement>(':scope > div > span')
    expect(spans[0].className).not.toMatch(/wz-search-hl/)
    expect(spans[1].className).toMatch(/wz-search-hl-active/)
  })

  it('renders nothing for an empty word list', () => {
    const { container } = render(<OcrTextLayer words={[]} scale={1} width={10} height={10} />)
    expect(container.querySelectorAll('span')).toHaveLength(0)
  })

  it('is selection-only without onEditCommit (double-click opens no editor)', () => {
    const { container } = render(<OcrTextLayer words={words} scale={1} width={200} height={200} />)
    fireEvent.doubleClick(container.querySelector(':scope > div > span')!)
    expect(container.querySelector('input')).toBeNull()
  })

  it('opens an inline editor in edit mode and commits with the word PDF bounds', () => {
    const onEditCommit = vi.fn()
    const { container } = render(
      <OcrTextLayer words={words} scale={2} width={200} height={200} onEditCommit={onEditCommit} />,
    )
    fireEvent.doubleClick(container.querySelector(':scope > div > span')!)
    const input = container.querySelector('input') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('alpha')               // seeded with the recognized text
    fireEvent.change(input, { target: { value: '알파' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    // Commit passes the word's PDF-point bounds straight through (no scaling).
    expect(onEditCommit).toHaveBeenCalledWith(
      expect.objectContaining({ text: '알파', x: 10, y: 20, width: 40, height: 12 }),
    )
    expect(container.querySelector('input')).toBeNull() // editor closes after commit
  })
})
