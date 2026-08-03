import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFlowSearch } from './useFlowSearch'
import { FLOW_PRINT_ATTR } from '../services/htmlPrint'

/**
 * The hook finds matches in whatever is marked as the printable document, so
 * the fixture is just that: a piece of live DOM.
 *
 * jsdom has no CSS Custom Highlight API, which is deliberate coverage — the
 * hook must degrade to "finds and counts, can't paint" rather than throw.
 */
function mount(html: string) {
  const host = document.createElement('div')
  host.innerHTML = `<article ${FLOW_PRINT_ATTR}>${html}</article>`
  document.body.appendChild(host)
  return host
}

describe('useFlowSearch', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { vi.restoreAllMocks() })

  it('finds every occurrence, case-insensitively', () => {
    mount('<p>Contract review</p><p>the contract is signed</p>')
    const { result } = renderHook(() => useFlowSearch(true))

    act(() => { result.current.run('CONTRACT') })
    expect(result.current.total).toBe(2)
  })

  it('matches Korean text', () => {
    mount('<h1>연계키 생성 원리</h1><p>연계키는 식별값이다.</p>')
    const { result } = renderHook(() => useFlowSearch(true))

    act(() => { result.current.run('연계키') })
    expect(result.current.total).toBe(2)
  })

  it('finds a match split across inline markup', () => {
    // Bold splits "본문" into two text nodes; a reader still sees one word.
    mount('<p>본<strong>문</strong>입니다</p>')
    const { result } = renderHook(() => useFlowSearch(true))

    act(() => { result.current.run('본문') })
    expect(result.current.total).toBe(1)
  })

  it('does not match across a block boundary', () => {
    // "…보호합니다." ends one paragraph and "개요…" starts the next. Without a
    // separator between blocks these would concatenate into a phantom match.
    mount('<p>개인정보를 보호합니다.</p><p>개요 문단.</p>')
    const { result } = renderHook(() => useFlowSearch(true))

    act(() => { result.current.run('보호합니다.개요') })
    expect(result.current.total).toBe(0)
  })

  it('ignores script and style text', () => {
    mount('<style>.secret { color: red }</style><p>본문</p>')
    const { result } = renderHook(() => useFlowSearch(true))

    act(() => { result.current.run('secret') })
    expect(result.current.total).toBe(0)
  })

  it('cycles forward and backward, wrapping at both ends', () => {
    mount('<p>a</p><p>a</p><p>a</p>')
    const { result } = renderHook(() => useFlowSearch(true))

    act(() => { result.current.run('a') })
    expect(result.current.activeIndex).toBe(0)

    act(() => { result.current.next() })
    expect(result.current.activeIndex).toBe(1)

    act(() => { result.current.prev() })
    act(() => { result.current.prev() })
    expect(result.current.activeIndex).toBe(2)   // wrapped past the start

    act(() => { result.current.next() })
    expect(result.current.activeIndex).toBe(0)   // wrapped past the end
  })

  it('resets on an empty query', () => {
    mount('<p>본문</p>')
    const { result } = renderHook(() => useFlowSearch(true))

    act(() => { result.current.run('본문') })
    expect(result.current.total).toBe(1)

    act(() => { result.current.run('   ') })
    expect(result.current.total).toBe(0)
    expect(result.current.activeIndex).toBe(0)
  })

  it('finds nothing while disabled', () => {
    mount('<p>본문</p>')
    const { result } = renderHook(() => useFlowSearch(false))

    act(() => { result.current.run('본문') })
    expect(result.current.total).toBe(0)
  })

  it('finds nothing when no document is on screen', () => {
    const { result } = renderHook(() => useFlowSearch(true))

    act(() => { result.current.run('본문') })
    expect(result.current.total).toBe(0)
  })

  it('searches the envelope as well as the body', () => {
    // Mail: subject and headers sit inside the same marked article, so a
    // reader searching for a sender finds them.
    mount('<header><h1>계약 부문</h1><dd>hong@example.com</dd></header><p>본문</p>')
    const { result } = renderHook(() => useFlowSearch(true))

    act(() => { result.current.run('hong@example.com') })
    expect(result.current.total).toBe(1)
  })
})
