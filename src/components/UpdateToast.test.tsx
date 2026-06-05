import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { UpdateToast } from './UpdateToast'

describe('UpdateToast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the version and fires onDownload when clicked', () => {
    const onDownload = vi.fn()
    render(<UpdateToast version="1.3.0" onDownload={onDownload} />)
    expect(screen.getByText(/v1\.3\.0/)).toBeTruthy()
    fireEvent.click(screen.getByTitle(/download|다운로드/i))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('can be dismissed manually', () => {
    const { container } = render(<UpdateToast version="1.3.0" onDownload={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /dismiss|닫기/i }))
    expect(container.querySelector('.wz-update-toast')).toBeNull()
  })

  it('auto-dismisses after the duration', () => {
    const { container } = render(<UpdateToast version="1.3.0" onDownload={() => {}} duration={5000} />)
    expect(container.querySelector('.wz-update-toast')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(container.querySelector('.wz-update-toast')).toBeNull()
  })
})
