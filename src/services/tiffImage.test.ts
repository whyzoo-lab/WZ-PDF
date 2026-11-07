// TIFFs are counted and drawn without reading what is not needed — the
// orthophoto case: hundreds of MB of uncompressed strips with the directory at
// the very end of the file.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readTiffDirectories, tagValues } from './tiffDir'
import { samplePositions, tiffDirectoriesOf, tiffPageImage } from './tiffImage'
import type { ImageSource } from './imageSources'

beforeAll(() => {
  // jsdom has no ImageData.
  if (typeof globalThis.ImageData === 'undefined') {
    class FakeImageData {
      data: Uint8ClampedArray
      width: number
      height: number
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data
        this.width = width
        this.height = height
      }
    }
    vi.stubGlobal('ImageData', FakeImageData)
  }
})

interface Page {
  width: number
  height: number
  spp?: number
  photometric?: number
  compression?: number
  /** pixel (x, y) → its samples */
  pixel: (x: number, y: number) => number[]
}

/**
 * A little-endian classic TIFF: pixel strips (one row each) first, every
 * directory after them, as GIS tools write orthophotos.
 */
function buildTiff(pages: Page[]): Uint8Array {
  const chunks: number[] = [0x49, 0x49, 42, 0, 0, 0, 0, 0]
  const pixelsAt: number[][] = []
  for (const p of pages) {
    const spp = p.spp ?? 3
    const rows: number[] = []
    for (let y = 0; y < p.height; y++) {
      rows.push(chunks.length)
      for (let x = 0; x < p.width; x++) chunks.push(...p.pixel(x, y).slice(0, spp))
    }
    pixelsAt.push(rows)
  }
  const u16 = (v: number) => [v & 255, v >> 8]
  const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]
  const at = (o: number, bytes: number[]) => bytes.forEach((b, i) => { chunks[o + i] = b })
  let prevNext = 4
  pages.forEach((p, i) => {
    const spp = p.spp ?? 3
    const rowBytes = p.width * spp
    // Arrays go before the directory that points at them.
    const bitsAt = chunks.length
    for (let s = 0; s < spp; s++) chunks.push(...u16(8))
    const offsAt = chunks.length
    pixelsAt[i].forEach(o => chunks.push(...u32(o)))
    const countsAt = chunks.length
    pixelsAt[i].forEach(() => chunks.push(...u32(rowBytes)))
    if (chunks.length % 2) chunks.push(0)
    const ifd = chunks.length
    at(prevNext, u32(ifd))
    const entries: [number, number, number, number][] = [
      [256, 4, 1, p.width], [257, 4, 1, p.height],
      [258, 3, spp, spp === 1 ? 8 : spp === 2 ? 8 | (8 << 16) : bitsAt],
      [259, 3, 1, p.compression ?? 1], [262, 3, 1, p.photometric ?? (spp >= 3 ? 2 : 1)],
      [273, 4, p.height, p.height === 1 ? pixelsAt[i][0] : offsAt], [277, 3, 1, spp], [278, 4, 1, 1],
      [279, 4, p.height, p.height === 1 ? rowBytes : countsAt], [284, 3, 1, 1],
    ]
    chunks.push(...u16(entries.length))
    for (const [tag, type, count, value] of entries) chunks.push(...u16(tag), ...u16(type), ...u32(count), ...u32(value))
    prevNext = chunks.length
    chunks.push(0, 0, 0, 0)
  })
  return new Uint8Array(chunks)
}

/** A source over bytes that records what was read. */
function sourceOf(bytes: Uint8Array) {
  const reads = { whole: 0, ranged: 0 }
  const src: ImageSource = {
    id: `t${Math.random()}`,
    name: 'test.tif',
    tiff: true,
    read: async () => { reads.whole += bytes.length; return bytes.slice().buffer },
    head: async n => bytes.slice(0, n),
    range: async (o, l) => { reads.ranged += Math.min(l, bytes.length - o); return bytes.slice(o, o + l) },
  }
  return { src, reads }
}

const gradient: Page['pixel'] = (x, y) => [x % 256, y % 256, 100]

describe('TIFF directories', () => {
  it('are found at the end of the file without reading the pixels', async () => {
    const bytes = buildTiff([{ width: 300, height: 200, pixel: gradient }])
    const { src, reads } = sourceOf(bytes)
    const dirs = await tiffDirectoriesOf(src)
    expect(dirs.map(d => [d.width, d.height])).toEqual([[300, 200]])
    expect(reads.whole).toBe(0)
    expect(reads.ranged).toBeLessThan(5000)        // header + directory, not 180 KB of pixels
  })

  it('count every page of a multi-page file', async () => {
    const bytes = buildTiff([
      { width: 10, height: 4, pixel: gradient },
      { width: 7, height: 3, spp: 1, pixel: () => [9] },
      { width: 5, height: 5, pixel: gradient },
    ])
    const dirs = await readTiffDirectories(async (o, l) => bytes.slice(o, o + l))
    expect(dirs.map(d => [d.width, d.height])).toEqual([[10, 4], [7, 3], [5, 5]])
    expect(await tagValues(async (o, l) => bytes.slice(o, o + l), dirs[0], 273)).toHaveLength(4)
  })

  it('stop at a chain that loops back on itself', async () => {
    const bytes = buildTiff([{ width: 4, height: 2, pixel: gradient }])
    // Point the directory's "next" at itself.
    const dv = new DataView(bytes.buffer)
    const ifd = dv.getUint32(4, true)
    const count = dv.getUint16(ifd, true)
    dv.setUint32(ifd + 2 + count * 12, ifd, true)
    const dirs = await readTiffDirectories(async (o, l) => bytes.slice(o, o + l))
    expect(dirs).toHaveLength(1)
  })

  it('reject what is not a TIFF', async () => {
    await expect(readTiffDirectories(async () => new TextEncoder().encode('%PDF-1.7 nonsense'))).rejects.toThrow()
  })
})

describe('sampling', () => {
  it('is a plain box when the picture is at most four times larger', () => {
    expect(samplePositions(8, 2)).toEqual({ n: 4, at: Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7]) })
    expect(samplePositions(5, 5)).toEqual({ n: 1, at: Int32Array.from([0, 1, 2, 3, 4]) })
  })

  it('spreads four samples over a larger area', () => {
    const { n, at } = samplePositions(100, 1)
    expect(n).toBe(4)
    expect([...at]).toEqual([12, 37, 62, 87])
  })

  it('clusters adjacent rows when asked, so one read covers them', () => {
    const { at } = samplePositions(100, 2, true)
    expect([...at]).toEqual([23, 24, 25, 26, 73, 74, 75, 76])
  })
})

describe('drawing a TIFF page', () => {
  it('decodes uncompressed RGB straight from the strips, at the size asked', async () => {
    const bytes = buildTiff([{ width: 8, height: 4, pixel: (x, y) => [x * 10, y * 10, 200] }])
    const { src } = sourceOf(bytes)
    const img = await tiffPageImage(src, 0, 4, 2)
    expect([img.width, img.height]).toEqual([4, 2])
    // Output (0,0) averages x 0–1, y 0–1: R 5, G 5.
    expect([...img.data.slice(0, 4)]).toEqual([5, 5, 200, 255])
    // Output (3,1) averages x 6–7, y 2–3: R 65, G 25.
    expect([...img.data.slice((1 * 4 + 3) * 4, (1 * 4 + 3) * 4 + 4)]).toEqual([65, 25, 200, 255])
  })

  it('keeps every pixel at full size', async () => {
    const bytes = buildTiff([{ width: 3, height: 2, pixel: (x, y) => [x, y, 7] }])
    const img = await tiffPageImage(sourceOf(bytes).src, 0, 100, 100)
    expect([img.width, img.height]).toEqual([3, 2])
    expect([...img.data.slice(4 * 4, 4 * 4 + 4)]).toEqual([1, 1, 7, 255])
  })

  it('reads grey, inverting WhiteIsZero', async () => {
    const bytes = buildTiff([
      { width: 2, height: 1, spp: 1, photometric: 1, pixel: x => [x ? 200 : 10] },
      { width: 2, height: 1, spp: 1, photometric: 0, pixel: x => [x ? 200 : 10] },
    ])
    const { src } = sourceOf(bytes)
    expect([...(await tiffPageImage(src, 0, 2, 1)).data]).toEqual([10, 10, 10, 255, 200, 200, 200, 255])
    expect([...(await tiffPageImage(src, 1, 2, 1)).data]).toEqual([245, 245, 245, 255, 55, 55, 55, 255])
  })

  it('reads only the rows a small rendering samples', async () => {
    const bytes = buildTiff([{ width: 40, height: 2000, pixel: gradient }])
    const { src, reads } = sourceOf(bytes)
    const img = await tiffPageImage(src, 0, 4, 20)       // a thumbnail
    expect([img.width, img.height]).toEqual([4, 20])
    expect(reads.whole).toBe(0)
    // 20 rows x 4 samples of 120 bytes, plus directories and strip tables.
    expect(reads.ranged).toBeLessThan(bytes.length * 0.15)
    // Output row 0 covers rows 0–99 and samples 48–51 around its middle.
    // (Green is the row number: 49.5, which a clamped array rounds to even.)
    expect(img.data[1]).toBe(50)
  })

  it('reads the file whole for a large rendering, once across zooms', async () => {
    const bytes = buildTiff([{ width: 40, height: 200, pixel: gradient }])
    const { src, reads } = sourceOf(bytes)
    await tiffPageImage(src, 0, 20, 100)
    await tiffPageImage(src, 0, 30, 150)
    expect(reads.whole).toBe(bytes.length)
  })
})
