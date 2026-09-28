import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'
import { useEditHistory, HISTORY_LIMIT } from './useEditHistory'

/** A counter with history, the way App wires annotations + file into it. */
function useCounter() {
  const [value, setValue] = useState(0)
  const history = useEditHistory(value, setValue)
  const change = (next: number) => { history.record(); setValue(next) }
  return { value, change, history }
}

describe('useEditHistory', () => {
  it('undoes and redoes changes in order', () => {
    const { result } = renderHook(() => useCounter())
    act(() => result.current.change(1))
    act(() => result.current.change(2))
    expect(result.current.history.canUndo).toBe(true)
    act(() => { result.current.history.undo() })
    expect(result.current.value).toBe(1)
    act(() => { result.current.history.undo() })
    expect(result.current.value).toBe(0)
    expect(result.current.history.canUndo).toBe(false)
    act(() => { result.current.history.redo() })
    expect(result.current.value).toBe(1)
    act(() => { result.current.history.redo() })
    expect(result.current.value).toBe(2)
    expect(result.current.history.canRedo).toBe(false)
  })

  it('a new change after undo discards what could have been redone', () => {
    const { result } = renderHook(() => useCounter())
    act(() => result.current.change(1))
    act(() => result.current.change(2))
    act(() => { result.current.history.undo() })
    act(() => result.current.change(5))
    expect(result.current.history.canRedo).toBe(false)
    act(() => { result.current.history.undo() })
    expect(result.current.value).toBe(1)
  })

  it('says when there is nothing to undo or redo', () => {
    const { result } = renderHook(() => useCounter())
    let undone = true, redone = true
    act(() => { undone = result.current.history.undo(); redone = result.current.history.redo() })
    expect([undone, redone]).toEqual([false, false])
    expect(result.current.value).toBe(0)
  })

  it('reset forgets the previous document', () => {
    const { result } = renderHook(() => useCounter())
    act(() => result.current.change(1))
    act(() => result.current.history.reset())
    expect(result.current.history.canUndo).toBe(false)
  })

  it(`keeps at most ${HISTORY_LIMIT} steps`, () => {
    const { result } = renderHook(() => useCounter())
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) act(() => result.current.change(i))
    let steps = 0
    act(() => { while (result.current.history.undo()) steps++ })
    expect(steps).toBe(HISTORY_LIMIT)
    expect(result.current.value).toBe(20)
  })
})
