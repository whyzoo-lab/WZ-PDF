import { describe, it, expect, vi } from 'vitest'
import {
  EAGER_DOCUMENT_MAX_BYTES, isLargeDocument, isRangedFile, readAll, readRange,
  type RangedFile,
} from './documentSource'

const ranged = (size: number, bytes = new Uint8Array(0)): RangedFile => ({
  name: 'big.pdf',
  size,
  type: '',
  readRange: vi.fn(async (begin: number, end: number) => bytes.slice(begin, end)),
})

describe('which documents are held whole', () => {
  it('holds a document up to the limit', () => {
    expect(isLargeDocument({ size: EAGER_DOCUMENT_MAX_BYTES })).toBe(false)
  })

  it('pages in anything past it', () => {
    // The 1.38 GB PDF that prompted this; 500 MB was also the old hard refusal.
    expect(isLargeDocument({ size: EAGER_DOCUMENT_MAX_BYTES + 1 })).toBe(true)
    expect(isLargeDocument({ size: 1_449_839_003 })).toBe(true)
  })
})

describe('reading a range', () => {
  it('reads just the slice of a File', async () => {
    const f = new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], 'x.pdf')
    expect([...await readRange(f, 2, 5)]).toEqual([2, 3, 4])
  })

  it('asks a ranged file for exactly the range', async () => {
    const f = ranged(2 * 1024 ** 3, new Uint8Array([9, 8, 7, 6]))
    expect([...await readRange(f, 1, 3)]).toEqual([8, 7])
    expect(f.readRange).toHaveBeenCalledWith(1, 3)
  })

  it('reads a ranged file whole only when asked to', async () => {
    const f = ranged(4, new Uint8Array([1, 2, 3, 4]))
    const all = new Uint8Array(await readAll(f))
    expect([...all]).toEqual([1, 2, 3, 4])
    expect(f.readRange).toHaveBeenCalledWith(0, 4)
  })

  it('tells a File from a ranged file', () => {
    expect(isRangedFile(new File([], 'a.pdf'))).toBe(false)
    expect(isRangedFile(ranged(1))).toBe(true)
  })
})
