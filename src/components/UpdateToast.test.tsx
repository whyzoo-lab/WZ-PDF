import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UpdateToast } from './UpdateToast'

describe('UpdateToast', () => {
  it('shows the version and restarts to install it', () => {
    const onInstall = vi.fn()
    render(<UpdateToast version="1.21.0" onInstall={onInstall} />)
    expect(screen.getByText(/v1\.21\.0/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /restart|다시 시작/i }))
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it('says a dismissed update is installed on quit', () => {
    render(<UpdateToast version="1.21.0" onInstall={() => {}} />)
    expect(screen.getByText(/quit|close|닫을 때/i)).toBeTruthy()
  })

  it('can be put off', () => {
    const { container } = render(<UpdateToast version="1.21.0" onInstall={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /later|나중에/i }))
    expect(container.querySelector('.wz-update-toast')).toBeNull()
  })
})
