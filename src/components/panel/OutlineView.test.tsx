import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OutlineView } from './OutlineView'
import type { OutlineNode } from '../../services/pdfOutline'

const nodes: OutlineNode[] = [
  { title: 'Chapter 1', page: 1, children: [
    { title: 'Section 1.1', page: 2, children: [{ title: 'Budget table', page: 3, children: [] }] },
  ] },
  { title: 'Chapter 2', page: 5, children: [] },
]

describe('OutlineView', () => {
  it('opens the top level and keeps deeper entries closed', () => {
    render(<OutlineView nodes={nodes} currentPage={1} onGo={() => {}} />)
    expect(screen.getByText('Section 1.1')).toBeInTheDocument()
    expect(screen.queryByText('Budget table')).not.toBeInTheDocument()
  })

  it('keeps the parents of a match visible while filtering', () => {
    render(<OutlineView nodes={nodes} currentPage={1} onGo={() => {}} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'budget' } })
    expect(screen.getByText('Budget table')).toBeInTheDocument()
    expect(screen.getByText('Section 1.1')).toBeInTheDocument()
    expect(screen.getByText('Chapter 1')).toBeInTheDocument()
    expect(screen.queryByText('Chapter 2')).not.toBeInTheDocument()
  })

  it('goes to an entry\'s page and marks where the reader is', () => {
    const onGo = vi.fn()
    render(<OutlineView nodes={nodes} currentPage={6} onGo={onGo} />)
    fireEvent.click(screen.getByText('Chapter 2'))
    expect(onGo).toHaveBeenCalledWith(5)
    expect(screen.getByText('Chapter 2').closest('[role=treeitem]')).toHaveAttribute('aria-selected', 'true')
  })

  it('expands everything on request', () => {
    render(<OutlineView nodes={nodes} currentPage={1} onGo={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /expand all/i }))
    expect(screen.getByText('Budget table')).toBeInTheDocument()
  })
})
