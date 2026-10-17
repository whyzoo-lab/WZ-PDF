import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDraftCommit } from './useDraftCommit'

afterEach(() => { vi.useRealTimers() })

describe('useDraftCommit', () => {
  it('stores once per pause, not per letter', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const { result } = renderHook(() => useDraftCommit('', commit, 500))
    act(() => { result.current.onChange('김') })
    act(() => { result.current.onChange('김철') })
    act(() => { result.current.onChange('김철수') })
    expect(result.current.shown).toBe('김철수')
    expect(commit).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(500) })
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('김철수')
  })

  it('stores at once when the field is left, and keeps what was typed on unmount', () => {
    const commit = vi.fn()
    const { result, unmount } = renderHook(() => useDraftCommit('', commit))
    act(() => { result.current.onChange('a') })
    act(() => { result.current.flush() })
    expect(commit).toHaveBeenLastCalledWith('a')
    act(() => { result.current.onChange('ab') })
    unmount()
    expect(commit).toHaveBeenLastCalledWith('ab')
  })

  it('shows a change made elsewhere (an undo)', () => {
    const { result, rerender } = renderHook(({ v }) => useDraftCommit(v, () => {}), { initialProps: { v: 'x' } })
    act(() => { result.current.onChange('xy') })
    rerender({ v: 'restored' })
    expect(result.current.shown).toBe('restored')
  })
})
