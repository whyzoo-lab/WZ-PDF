// A TIFF's directories (one per page), read from the few bytes that hold them.
//
// The page count and each page's size are in the image file directories
// (IFDs), a chain the header points into. They used to be found by reading the
// whole file and handing it to UTIF — the only way to count pages, it seemed.
// That is cheap for a fax scan and ruinous for an orthophoto: the folder in the
// report held 27 aerial images of 339 MB each (9684 x 11652, uncompressed RGB,
// one row per strip, the directory at the very end), and opening one read all
// 27 — 9 GB through IPC — before showing anything: 52 s. A directory is a few
// hundred bytes wherever it sits, so this follows the chain with range reads
// (two per single-page file) and never touches the pixels.
//
// Classic TIFF and BigTIFF, either byte order. Values an entry holds inline
// are decoded here; arrays (strip offsets, byte counts) are read on request
// with `tagValues`, since only drawing needs them.

/** Reads `length` bytes at `offset` (fewer only at the end of the file). */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>

export interface TiffEntry {
  type: number
  count: number
  /** File offset of the values, or -1 when they are inline. */
  offset: number
  /** The values, when they are inline; empty otherwise. */
  inline: number[]
}

export interface TiffDirectory {
  width: number
  height: number
  littleEndian: boolean
  bigTiff: boolean
  tags: Map<number, TiffEntry>
}

/** Bytes per value of each TIFF field type. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 }

/** More directories than any real file has; past it the chain is a loop or garbage. */
const MAX_DIRECTORIES = 4096
/** Entries in one directory; real files have 10–40. */
const MAX_ENTRIES = 4096
/** Read past the entry count in the same call, so one read usually covers a directory. */
const SPECULATIVE = 4096

class Reader {
  private dv: DataView
  private le: boolean
  constructor(b: Uint8Array, le: boolean) {
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    this.le = le
  }
  u8(o: number) { return this.dv.getUint8(o) }
  u16(o: number) { return this.dv.getUint16(o, this.le) }
  u32(o: number) { return this.dv.getUint32(o, this.le) }
  u64(o: number) {
    const v = this.dv.getBigUint64(o, this.le)
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TIFF offset out of range')
    return Number(v)
  }
  value(type: number, o: number): number {
    switch (TYPE_SIZE[type]) {
      case 1: return this.u8(o)
      case 2: return this.u16(o)
      case 4: return this.u32(o)
      case 8: return type === 16 || type === 17 ? this.u64(o) : this.u32(o)   // rationals: numerator
      default: return 0
    }
  }
}

async function readAtLeast(read: RangeReader, offset: number, length: number): Promise<Uint8Array> {
  const b = await read(offset, length)
  if (b.length < length) throw new Error('TIFF directory runs past the end of the file')
  return b.length > length ? b.subarray(0, length) : b
}

/**
 * Every directory in the main chain that has a width and height, in order —
 * the same set UTIF.decode returns and the app shows as pages.
 */
export async function readTiffDirectories(read: RangeReader): Promise<TiffDirectory[]> {
  const head = await readAtLeast(read, 0, 16).catch(async () => readAtLeast(read, 0, 8))
  const le = head[0] === 0x49 && head[1] === 0x49
  if (!le && !(head[0] === 0x4d && head[1] === 0x4d)) throw new Error('Not a TIFF')
  const h = new Reader(head, le)
  const magic = h.u16(2)
  const big = magic === 43
  if (!big && magic !== 42) throw new Error('Not a TIFF')
  if (big && head.length < 16) throw new Error('Truncated BigTIFF header')
  let next = big ? h.u64(8) : h.u32(4)

  const countSize = big ? 8 : 2
  const entrySize = big ? 20 : 12
  const nextSize = big ? 8 : 4
  const inlineBytes = big ? 8 : 4
  const seen = new Set<number>()
  const out: TiffDirectory[] = []

  while (next !== 0) {
    if (seen.has(next) || seen.size >= MAX_DIRECTORIES) break
    seen.add(next)
    // The count, and with luck the whole directory, in one read.
    let b = await read(next, countSize + SPECULATIVE)
    if (b.length < countSize) throw new Error('TIFF directory runs past the end of the file')
    let r = new Reader(b, le)
    const count = big ? r.u64(0) : r.u16(0)
    if (count > MAX_ENTRIES) throw new Error('TIFF directory is implausibly large')
    const need = countSize + count * entrySize + nextSize
    if (b.length < need) {
      b = await readAtLeast(read, next, need)
      r = new Reader(b, le)
    }
    const tags = new Map<number, TiffEntry>()
    for (let i = 0; i < count; i++) {
      const e = countSize + i * entrySize
      const tag = r.u16(e)
      const type = r.u16(e + 2)
      const n = big ? r.u64(e + 4) : r.u32(e + 4)
      const at = e + (big ? 12 : 8)
      const size = TYPE_SIZE[type]
      if (!size) continue                                   // unknown type: skip, as readers must
      if (n * size <= inlineBytes) {
        const inline: number[] = []
        for (let k = 0; k < n; k++) inline.push(r.value(type, at + k * size))
        tags.set(tag, { type, count: n, offset: -1, inline })
      } else {
        tags.set(tag, { type, count: n, offset: big ? r.u64(at) : r.u32(at), inline: [] })
      }
    }
    const width = tags.get(256)?.inline[0] ?? 0
    const height = tags.get(257)?.inline[0] ?? 0
    if (width > 0 && height > 0) out.push({ width, height, littleEndian: le, bigTiff: big, tags })
    const nextAt = countSize + count * entrySize
    next = big ? r.u64(nextAt) : r.u32(nextAt)
  }
  return out
}

/** All values of a tag (strip offsets, bits per sample, …); [] when absent. */
export async function tagValues(read: RangeReader, dir: TiffDirectory, tag: number): Promise<number[]> {
  const entry = dir.tags.get(tag)
  if (!entry) return []
  if (entry.offset < 0) return entry.inline
  const size = TYPE_SIZE[entry.type]
  if (entry.count > 16 * 1024 * 1024) throw new Error('TIFF tag is implausibly large')
  const b = await readAtLeast(read, entry.offset, entry.count * size)
  const r = new Reader(b, dir.littleEndian)
  const values = new Array<number>(entry.count)
  for (let k = 0; k < entry.count; k++) values[k] = r.value(entry.type, k * size)
  return values
}

/** A tag's first value, or `fallback`. */
export const tagValue = (dir: TiffDirectory, tag: number, fallback: number): number =>
  dir.tags.get(tag)?.inline[0] ?? fallback
