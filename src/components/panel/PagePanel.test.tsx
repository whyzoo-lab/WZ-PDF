// src/components/panel/PagePanel.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PagePanel, type PagePanelProps } from './PagePanel'

// Thumbnails come from a canvas render, which jsdom has nothing to do; the
// panel only needs them to be strings.
vi.mock('../../hooks/useThumbnails', () => ({
  useThumbnails: (_doc: unknown, numPages: number) =>
    Array.from({ length: numPages }, (_, i) => `data:image/png;base64,page${i + 1}`),
}))

const onSavePages = vi.fn()

function panel(props: Partial<PagePanelProps> = {}) {
  const all: PagePanelProps = {
    pdfDoc: {} as PagePanelProps['pdfDoc'],
    numPages: 3,
    currentPage: 1,
    isOperating: false,
    onScrollToPage: vi.fn(),
    onDeletePages: vi.fn(),
    onInsertBlankPage: vi.fn(),
    onInsertFromPdf: vi.fn(),
    onReorderPages: vi.fn(),
    onSavePages,
    ...props,
  }
  return render(<PagePanel {...all} />)
}

const thumb = (n: number) => screen.getByAltText(`Page ${n}`).parentElement!

beforeEach(() => { onSavePages.mockClear() })

describe('saving a selection of pages', () => {
  it('offers the menu in read-only mode too', () => {
    // Extracting pages writes a new file and leaves the open document alone,
    // so it has nothing to do with edit permission — requiring editor mode was
    // only ever an accident of where the menu was added.
    panel({ readOnly: true })
    fireEvent.contextMenu(thumb(2))
    expect(screen.getByRole('menuitem')).toBeTruthy()
  })

  it('saves the page that was right-clicked when nothing is selected', () => {
    panel({ readOnly: true })
    fireEvent.contextMenu(thumb(2))
    fireEvent.click(screen.getByRole('menuitem'))
    expect(onSavePages).toHaveBeenCalledWith([2])
  })

  it('keeps a multi-page selection and hands it over in document order', () => {
    panel({ readOnly: true })
    fireEvent.click(thumb(3))
    fireEvent.click(thumb(1), { ctrlKey: true })
    fireEvent.contextMenu(thumb(1))
    fireEvent.click(screen.getByRole('menuitem'))
    // Clicked 3 then 1; the file should still come out 1 then 3.
    expect(onSavePages).toHaveBeenCalledWith([1, 3])
  })

  it('still hides the editing toolbar in read-only mode', () => {
    // Read-only got looser for one menu item, not for everything.
    const { container } = panel({ readOnly: true })
    expect(container.querySelector('input[type=file]')).toBeNull()
  })

  it('has no menu at all when the document is not a PDF', () => {
    panel({ readOnly: true, onSavePages: undefined })
    fireEvent.contextMenu(thumb(1))
    expect(screen.queryByRole('menuitem')).toBeNull()
  })
})
