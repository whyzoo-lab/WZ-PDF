import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { SearchBar } from './SearchBar'

function setup() {
  const props = {
    total: 5, activeIndex: 0, isSearching: false,
    onChange: vi.fn(), onNext: vi.fn(), onPrev: vi.fn(), onClose: vi.fn(),
  }
  const utils = render(<SearchBar {...props} />)
  const input = utils.container.querySelector('input') as HTMLInputElement
  return { ...props, input }
}

describe('SearchBar', () => {
  afterEach(() => { vi.useRealTimers() })

  it('Enter moves to the next match once the typed search has run', () => {
    vi.useFakeTimers()
    const { input, onChange, onNext } = setup()
    fireEvent.change(input, { target: { value: 'the' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(onChange).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNext).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('Shift+Enter moves to the previous match once the typed search has run', () => {
    vi.useFakeTimers()
    const { input, onChange, onPrev } = setup()
    fireEvent.change(input, { target: { value: 'the' } })
    act(() => { vi.advanceTimersByTime(300) })

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('Enter while the debounce is pending runs the search now, then navigates', () => {
    vi.useFakeTimers()
    const { input, onChange, onNext } = setup()
    fireEvent.change(input, { target: { value: 'the' } })

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onNext).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(300) })
    expect(onChange).toHaveBeenCalledTimes(1) // the cancelled debounce does not fire again

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})
