import { describe, it, expect, vi, beforeEach } from 'vitest'

const { initMock, FakeHwpDocument } = vi.hoisted(() => {
  const initMock = vi.fn().mockResolvedValue(undefined)
  class FakeHwpDocument {
    data: Uint8Array
    constructor(data: Uint8Array) { this.data = data }
    pageCount() { return 3 }
    free() {}
  }
  return { initMock, FakeHwpDocument }
})

vi.mock('@rhwp/core', () => ({ default: (...a: unknown[]) => initMock(...a), HwpDocument: FakeHwpDocument }))

import { loadHwp, __resetHwpForTests } from './hwpEngine'

beforeEach(() => { initMock.mockClear(); __resetHwpForTests() })

describe('hwpEngine', () => {
  it('inits the WASM once and constructs HwpDocument from bytes', async () => {
    const a = await loadHwp(new Uint8Array([1, 2, 3]).buffer)
    const b = await loadHwp(new Uint8Array([4]).buffer)
    expect(initMock).toHaveBeenCalledTimes(1)         // init runs once, reused
    expect((a as unknown as InstanceType<typeof FakeHwpDocument>).pageCount()).toBe(3)
    expect((b as unknown as InstanceType<typeof FakeHwpDocument>).data[0]).toBe(4)
  })
})
