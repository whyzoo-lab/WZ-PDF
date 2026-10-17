import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CommentsPanel } from './CommentsPanel'
import { commentMatches, sortComments } from './commentFormat'
import type { CommentAnnotation } from '../../types/annotation'
import { t } from '../../i18n'

const base = { rotation: 0, author: '김철수', createdAt: 0, replies: [] as CommentAnnotation['replies'], width: 20, height: 20 }
const list: CommentAnnotation[] = [
  { ...base, id: 'b', type: 'note', page: 2, x: 10, y: 10, color: '#fc0', contents: '둘째 쪽 메모' },
  { ...base, id: 'a', type: 'highlight', page: 1, x: 10, y: 300, color: '#ff0', contents: '', text: '계약 기간은 1년', rects: [{ x: 10, y: 300, width: 100, height: 12 }] },
  { ...base, id: 'c', type: 'underline', page: 1, x: 10, y: 50, color: '#00f', contents: '확인', text: '갑', rects: [{ x: 10, y: 50, width: 20, height: 12 }], done: true,
    replies: [{ id: 'r', author: '이영희', contents: '반영함', createdAt: 0 }] },
]

describe('sortComments / commentMatches', () => {
  it('orders by page, then down the page', () => {
    expect(sortComments(list).map(a => a.id)).toEqual(['c', 'a', 'b'])
  })

  it('matches the marked text, the thread and the author', () => {
    const [b, a, c] = list
    expect(commentMatches(a, '계약')).toBe(true)
    expect(commentMatches(c, '반영')).toBe(true)
    expect(commentMatches(c, '영희')).toBe(true)
    expect(commentMatches(b, '계약')).toBe(false)
  })
})

describe('CommentsPanel', () => {
  const props = {
    comments: list, selectedId: null, canEdit: false, author: '나',
    onAuthorChange: () => {}, onGo: vi.fn(), onUpdate: vi.fn(), onRemove: vi.fn(),
  }

  it('groups by page and goes to a comment when clicked', () => {
    const onGo = vi.fn()
    render(<CommentsPanel {...props} onGo={onGo} />)
    expect(screen.getByRole('heading', { name: t('comment.page', { n: 1 }) })).toBeTruthy()
    expect(screen.getByRole('heading', { name: t('comment.page', { n: 2 }) })).toBeTruthy()
    fireEvent.click(screen.getByText('둘째 쪽 메모'))
    expect(onGo).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })

  it('filters by status and search', () => {
    render(<CommentsPanel {...props} />)
    fireEvent.click(screen.getByRole('radio', { name: t('comment.filter.done') }))
    expect(screen.queryByText('둘째 쪽 메모')).toBeNull()
    expect(screen.getByText('확인')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: t('comment.filter.all') }))
    fireEvent.change(screen.getByPlaceholderText(t('comment.search')), { target: { value: '없는말' } })
    expect(screen.getByText(t('comment.noMatch'))).toBeTruthy()
  })

  it('opens the selected one with its thread, and a reply is added with the author', () => {
    const onUpdate = vi.fn()
    render(<CommentsPanel {...props} selectedId="c" canEdit onUpdate={onUpdate} />)
    expect(screen.getByText('반영함')).toBeTruthy()
    const box = screen.getByPlaceholderText(t('comment.replyPlaceholder'))
    fireEvent.change(box, { target: { value: '고마워요' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onUpdate).toHaveBeenCalledWith('c', expect.objectContaining({
      replies: [expect.objectContaining({ id: 'r' }), expect.objectContaining({ author: '나', contents: '고마워요' })],
    }))
  })

  it('offers nothing to change when not editing', () => {
    render(<CommentsPanel {...props} selectedId="c" />)
    expect(screen.queryByPlaceholderText(t('comment.replyPlaceholder'))).toBeNull()
    expect(screen.queryByRole('button', { name: t('comment.delete') })).toBeNull()
  })
})
