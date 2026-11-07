import { afterEach, describe, expect, it, vi } from 'vitest'
import { DECODE_IN_WORKER_BYTES, decodeTextOffThread } from './textDecode'

const cp949 = (n: number) => {
  // '한글' in CP949, repeated.
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) out.set([0xc7, 0xd1, 0xb1, 0xdb], i * 4)
  return out.buffer
}

describe('decodeTextOffThread', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('decodes a small file in place, UTF-8 or CP949', async () => {
    expect(await decodeTextOffThread(new TextEncoder().encode('한글').buffer as ArrayBuffer)).toBe('한글')
    expect(await decodeTextOffThread(cp949(1))).toBe('한글')
  })

  it('sends a large file to a worker and keeps the caller\'s bytes', async () => {
    const posted: unknown[] = []
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      terminated = false
      postMessage(m: unknown) {
        posted.push(m)
        queueMicrotask(() => this.onmessage?.({ data: { text: 'from worker' } }))
      }
      terminate() { this.terminated = true }
    }
    vi.stubGlobal('Worker', FakeWorker)
    const bytes = cp949(DECODE_IN_WORKER_BYTES / 4 + 1)
    expect(await decodeTextOffThread(bytes)).toBe('from worker')
    expect(posted).toEqual([bytes])
    expect(bytes.byteLength).toBeGreaterThan(DECODE_IN_WORKER_BYTES)
  })

  it('decodes in place when the worker cannot start', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('refused') } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const text = await decodeTextOffThread(cp949(DECODE_IN_WORKER_BYTES / 4 + 1))
    expect(text.slice(0, 4)).toBe('한글한글')
    expect(warn).toHaveBeenCalled()
  })
})
