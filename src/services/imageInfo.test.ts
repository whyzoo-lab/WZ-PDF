import { describe, it, expect } from 'vitest'
import { imageInfo, isImageName, naturalCompare, sniffImage } from './imageInfo'

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap(p => (typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p)))
const be16 = (n: number) => [n >> 8, n & 255]
const be32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]
const le16 = (n: number) => [n & 255, n >> 8]
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]

const png = (w: number, h: number) => bytes([0x89], 'PNG\r\n', [0x1a, 0x0a], be32(13), 'IHDR', be32(w), be32(h), [8, 6, 0, 0, 0])

/** A JPEG with an EXIF orientation tag (big-endian TIFF) and a SOF0. */
function jpeg(w: number, h: number, orientation: number | null) {
  const app1: number[] = []
  if (orientation !== null) {
    const tiff = [...bytes('MM', [0, 0x2a], be32(8)), ...be16(1), ...be16(0x0112), ...be16(3), ...be32(1), ...be16(orientation), 0, 0, ...be32(0)]
    const body = [...bytes('Exif', [0, 0]), ...tiff]
    app1.push(0xff, 0xe1, ...be16(body.length + 2), ...body)
  }
  const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(h), ...be16(w), 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]
  return bytes([0xff, 0xd8], app1, sof, [0xff, 0xd9])
}

describe('imageInfo', () => {
  it('reads PNG, GIF and BMP sizes', () => {
    expect(imageInfo(png(640, 480))).toMatchObject({ format: 'png', width: 640, height: 480, animated: false })
    expect(imageInfo(bytes('GIF89a', le16(320), le16(200), [0, 0, 0, 0, 0, 0]))).toMatchObject({ format: 'gif', width: 320, height: 200, animated: true })
    const bmp = bytes('BM', le32(0), le32(0), le32(54), le32(40), le32(800), le32(600 >>> 0), le16(1), le16(24))
    expect(imageInfo(bmp)).toMatchObject({ format: 'bmp', width: 800, height: 600 })
  })

  it('reads a top-down BMP (negative height) as positive', () => {
    const bmp = bytes('BM', le32(0), le32(0), le32(54), le32(40), le32(100), le32(-50 >>> 0), le16(1), le16(24))
    expect(imageInfo(bmp)).toMatchObject({ width: 100, height: 50 })
  })

  it('reads a JPEG size and turns it by its EXIF orientation', () => {
    expect(imageInfo(jpeg(4000, 3000, null))).toMatchObject({ format: 'jpeg', width: 4000, height: 3000, orientation: 1 })
    expect(imageInfo(jpeg(4000, 3000, 1))).toMatchObject({ width: 4000, height: 3000, orientation: 1 })
    // A phone held upright: stored landscape, shown portrait.
    expect(imageInfo(jpeg(4000, 3000, 6))).toMatchObject({ width: 3000, height: 4000, orientation: 6 })
  })

  it('reads WebP (lossy, lossless, extended with animation)', () => {
    const vp8 = bytes('RIFF', le32(0), 'WEBP', 'VP8 ', le32(0), [0, 0, 0, 0x9d, 0x01, 0x2a], le16(300), le16(150))
    expect(imageInfo(vp8)).toMatchObject({ format: 'webp', width: 300, height: 150 })
    const bits = (300 - 1) | ((150 - 1) << 14)
    const vp8l = bytes('RIFF', le32(0), 'WEBP', 'VP8L', le32(0), [0x2f], le32(bits))
    expect(imageInfo(vp8l)).toMatchObject({ width: 300, height: 150 })
    const vp8x = bytes('RIFF', le32(0), 'WEBP', 'VP8X', le32(10), [0x02, 0, 0, 0], [299 & 255, 299 >> 8, 0], [149, 0, 0])
    expect(imageInfo(vp8x)).toMatchObject({ width: 300, height: 150, animated: true })
  })

  it('reads the first page of a TIFF', () => {
    const tiff = bytes('II', le16(42), le32(8), le16(2),
      le16(256), le16(3), le32(1), le16(1200), le16(0),
      le16(257), le16(4), le32(1), le32(1700),
      le32(0))
    expect(imageInfo(tiff)).toMatchObject({ format: 'tiff', width: 1200, height: 1700 })
  })

  it('knows nothing of other bytes', () => {
    expect(sniffImage(bytes('%PDF-1.7 and more'))).toBeNull()
    expect(imageInfo(bytes('just some text here'))).toBeNull()
  })
})

describe('names', () => {
  it('knows image extensions, TIFF included', () => {
    expect(isImageName('scan.TIF')).toBe(true)
    expect(isImageName('photo.jpeg')).toBe(true)
    expect(isImageName('notes.pdf')).toBe(false)
  })

  it('sorts as Explorer does, numbers by value', () => {
    expect(['10.jpg', '2.jpg', '1.jpg', 'B.png', 'a.png'].sort(naturalCompare)).toEqual(['1.jpg', '2.jpg', '10.jpg', 'a.png', 'B.png'])
  })
})
