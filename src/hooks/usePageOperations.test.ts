import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePageOperations } from './usePageOperations'

describe('usePageOperations', () => {
  it('refuses a document that has bytes but no PDF to rewrite, and says why', async () => {
    // A HWP has bytes; handing them to pdf-lib failed with "No PDF header found".
    const onResult = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => usePageOperations({
      fileBytes: new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]).buffer,
      bytesUnavailable: 'PDF에서만 할 수 있습니다',
      documentPassword: null,
      onResult,
      onError,
    }))
    let done = true
    await act(async () => { done = await result.current.handleDeletePages([1]) })
    expect(done).toBe(false)
    expect(onResult).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(new Error('PDF에서만 할 수 있습니다'))
  })
})
