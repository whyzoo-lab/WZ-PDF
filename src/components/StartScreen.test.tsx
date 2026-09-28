import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StartScreen } from './StartScreen'

const RECENT = [
  { path: 'C:\\docs\\계약서.pdf', openedAt: 2 },
  { path: 'C:\\docs\\memo.md', openedAt: 1 },
]

function withRecent(list = RECENT) {
  const api = {
    recentFiles: vi.fn(async () => list),
    removeRecentFile: vi.fn(async (p: string) => list.filter(r => r.path !== p)),
    clearRecentFiles: vi.fn(async () => []),
  }
  vi.stubGlobal('electronAPI', api)
  return api
}

afterEach(() => { vi.unstubAllGlobals() })

describe('StartScreen', () => {
  it('has a real button that opens the file picker', () => {
    const onOpenFile = vi.fn()
    render(<StartScreen onOpenFile={onOpenFile} onOpenRecent={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /파일 열기|Open a file/ }))
    expect(onOpenFile).toHaveBeenCalledTimes(1)
  })

  it('lists recent documents by name, and opens one by path', async () => {
    withRecent()
    const onOpenRecent = vi.fn(async () => true)
    render(<StartScreen onOpenFile={vi.fn()} onOpenRecent={onOpenRecent} />)
    fireEvent.click(await screen.findByText('계약서.pdf'))
    expect(onOpenRecent).toHaveBeenCalledWith('C:\\docs\\계약서.pdf')
    expect(screen.getByText('memo.md')).toBeInTheDocument()
  })

  it('drops a document that can no longer be opened', async () => {
    const api = withRecent()
    render(<StartScreen onOpenFile={vi.fn()} onOpenRecent={async () => false} />)
    fireEvent.click(await screen.findByText('계약서.pdf'))
    await waitFor(() => expect(screen.queryByText('계약서.pdf')).toBeNull())
    expect(api.removeRecentFile).toHaveBeenCalledWith('C:\\docs\\계약서.pdf')
  })

  it('clears the list on request', async () => {
    const api = withRecent()
    render(<StartScreen onOpenFile={vi.fn()} onOpenRecent={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /목록 지우기|Clear list/ }))
    await waitFor(() => expect(screen.queryByText('memo.md')).toBeNull())
    expect(api.clearRecentFiles).toHaveBeenCalled()
  })

  it('shows no list outside the desktop app', () => {
    render(<StartScreen onOpenFile={vi.fn()} onOpenRecent={vi.fn()} />)
    expect(screen.queryByRole('heading')).toBeNull()
  })
})
