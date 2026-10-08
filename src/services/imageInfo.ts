// Size and kind of an image from its first bytes — without decoding it.
//
// A folder of photos becomes one document, and the page list needs every
// page's size before any is drawn (a placeholder of the wrong shape would make
// the list jump as pages arrive). Decoding 300 photos to learn their sizes
// would mean reading and unpacking gigabytes; their headers are a few KB each.

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'tiff'

export interface ImageInfo {
  format: ImageFormat
  /** Size as displayed — after the EXIF rotation a camera wrote, if any. */
  width: number
  height: number
  /** EXIF orientation (1–8; 1 when absent). 5–8 swap width and height. */
  orientation: number
  /** May be animated (GIF, or WebP with the animation flag). */
  animated: boolean
}

export const IMAGE_MIME: Record<ImageFormat, string> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', tiff: 'image/tiff',
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
const u32le = (b: Uint8Array, i: number) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0)
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))

/** Which image format the bytes are, by signature. */
export function sniffImage(b: Uint8Array): ImageFormat | null {
  if (b.length < 12) return null
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (ascii(b, 0, 4) === 'GIF8') return 'gif'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp'
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return 'tiff'
  return null
}

/** EXIF orientation from a JPEG APP1 segment starting at `i` (the "Exif" mark). */
function exifOrientation(b: Uint8Array, i: number, end: number): number {
  const t = i + 6                         // TIFF header after "Exif\0\0"
  if (t + 8 > end) return 1
  const le = b[t] === 0x49
  const r16 = (o: number) => (le ? u16le(b, o) : u16be(b, o))
  const r32 = (o: number) => (le ? u32le(b, o) : u32be(b, o))
  const ifd = t + r32(t + 4)
  if (ifd + 2 > end) return 1
  const count = r16(ifd)
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > end) break
    if (r16(e) === 0x0112) {
      const v = r16(e + 8)
      return v >= 1 && v <= 8 ? v : 1
    }
  }
  return 1
}

function jpegInfo(b: Uint8Array): Omit<ImageInfo, 'format' | 'animated'> | null {
  let i = 2
  let orientation = 1
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]
    if (marker === 0xff) { i++; continue }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue }
    const len = u16be(b, i + 2)
    if (marker === 0xe1 && ascii(b, i + 4, 4) === 'Exif') orientation = exifOrientation(b, i + 4, Math.min(b.length, i + 2 + len))
    // Start-of-frame markers (C0–CF except DHT C4, JPG C8, DAC CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = u16be(b, i + 5)
      const width = u16be(b, i + 7)
      return { width, height, orientation }
    }
    i += 2 + len
  }
  return null
}

function webpInfo(b: Uint8Array): { width: number; height: number; animated: boolean } | null {
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8X' && b.length >= 30) {
    return {
      animated: (b[20] & 0x02) !== 0,
      width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    }
  }
  if (chunk === 'VP8 ' && b.length >= 30) {
    return { animated: false, width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (chunk === 'VP8L' && b.length >= 25) {
    const v = u32le(b, 21)
    return { animated: false, width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }
  }
  return null
}

/** TIFF: the first page's size (the full file is needed for the page count). */
function tiffInfo(b: Uint8Array): { width: number; height: number } | null {
  const le = b[0] === 0x49
  const r16 = (o: number) => (le ? u16le(b, o) : u16be(b, o))
  const r32 = (o: number) => (le ? u32le(b, o) : u32be(b, o))
  const ifd = r32(4)
  if (ifd + 2 > b.length) return null
  let width = 0, height = 0
  for (let k = 0; k < r16(ifd); k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > b.length) break
    const tag = r16(e), type = r16(e + 2)
    const value = type === 3 ? r16(e + 8) : r32(e + 8)
    if (tag === 256) width = value
    if (tag === 257) height = value
  }
  return width && height ? { width, height } : null
}

/**
 * Read an image's format and displayed size from its first bytes (64 KB is
 * plenty for anything but a JPEG with a large embedded thumbnail; null then
 * means "read more").
 */
export function imageInfo(head: Uint8Array): ImageInfo | null {
  const format = sniffImage(head)
  if (!format) return null
  let width = 0, height = 0, orientation = 1, animated = false
  switch (format) {
    case 'png':
      width = u32be(head, 16); height = u32be(head, 20); break
    case 'gif':
      width = u16le(head, 6); height = u16le(head, 8); animated = true; break
    case 'bmp':
      width = u32le(head, 18); height = Math.abs(u32le(head, 22) | 0); break
    case 'jpeg': {
      const j = jpegInfo(head)
      if (!j) return null
      ;({ width, height, orientation } = j)
      break
    }
    case 'webp': {
      const w = webpInfo(head)
      if (!w) return null
      ;({ width, height, animated } = w)
      break
    }
    case 'tiff': {
      const t = tiffInfo(head)
      if (!t) return null
      ;({ width, height } = t)
      break
    }
  }
  if (!width || !height) return null
  // Orientations 5–8 turn the picture a quarter: the decoder (which applies
  // EXIF rotation) hands back the other way round.
  if (orientation >= 5) [width, height] = [height, width]
  return { format, width, height, orientation, animated }
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff']

export function isImageName(name: string): boolean {
  const m = /\.([A-Za-z0-9]+)$/.exec(name)
  return !!m && IMAGE_EXTENSIONS.includes(m[1].toLowerCase())
}

/** Natural order for file names: "2.jpg" before "10.jpg", as Explorer sorts. */
export const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
