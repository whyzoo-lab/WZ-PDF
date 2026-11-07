// TIFF pages, decoded at the size they are drawn.
//
// Chromium has no TIFF decoder, so pages were decoded with UTIF at full size,
// turned into RGBA, put on a canvas as big as the picture and drawn from there
// into the page raster. For a 9684 x 11652 orthophoto that is 339 MB of strips
// copied, 451 MB of RGBA and a 451 MB canvas — to fill a fitted page about
// 750 x 900 px. Two paths now go straight from the file to pixels of the size
// asked for:
//
// - **Uncompressed, 8-bit, interleaved strips** (what GIS and survey tools
//   write for orthophotos and what scanners write uncompressed) are sampled
//   directly from the file. Each output pixel averages up to SAMPLES x SAMPLES
//   source pixels spread over the area it covers — a box filter when the
//   picture is at most four times larger, a supersample beyond. When the
//   result is small (a thumbnail, the page grid) only the rows it samples are
//   read, by range: a thumbnail of the orthophoto reads ~8 MB, not 339 MB.
// - **Everything else** (CCITT fax, LZW, JPEG-in-TIFF, tiles, 16-bit, palette
//   …) is still UTIF's, which knows all of them; its RGBA is sampled the same
//   way instead of going through a full-size canvas.

import type { ImageSource } from './imageSources'
import { readTiffDirectories, tagValue, tagValues, type TiffDirectory } from './tiffDir'

type Utif = typeof import('utif2')
let utif: Promise<Utif> | null = null
/** The TIFF decoder, loaded the first time it is needed (CommonJS module). */
export const loadUtif = (): Promise<Utif> =>
  (utif ??= import('utif2').then(m => ((m as unknown as { default?: Utif }).default ?? m)))

// ── Directories ───────────────────────────────────────────────────────────

const directories = new Map<string, Promise<TiffDirectory[]>>()

/** A TIFF's pages (directories), read by range and cached per source. */
export function tiffDirectoriesOf(src: ImageSource): Promise<TiffDirectory[]> {
  let p = directories.get(src.id)
  if (!p) {
    p = readTiffDirectories((o, l) => src.range(o, l))
    directories.set(src.id, p)
    p.catch(() => directories.delete(src.id))
  }
  return p
}

// ── Whole files ───────────────────────────────────────────────────────────
// A zoom re-renders the page, and the read cache (imageSources) will not hold a
// file of hundreds of MB; without this every zoom step read the orthophoto
// again. The last two files are kept, within a budget — one orthophoto, since
// the opened file's own bytes are held by the app as well.

const HELD_BUDGET = 512 * 1024 * 1024
const held: { id: string; bytes: ArrayBuffer; ifds?: ReturnType<Utif['decode']> }[] = []

async function wholeFile(src: ImageSource): Promise<(typeof held)[number]> {
  const i = held.findIndex(h => h.id === src.id)
  if (i >= 0) {
    const [hit] = held.splice(i, 1)
    held.unshift(hit)
    return hit
  }
  const hit = { id: src.id, bytes: await src.read() }
  held.unshift(hit)
  let total = 0
  for (let k = 0; k < held.length; k++) {
    total += held[k].bytes.byteLength
    if (k > 0 && (k >= 2 || total > HELD_BUDGET)) { held.length = k; break }
  }
  return hit
}

// ── Sampling ──────────────────────────────────────────────────────────────

/** Source pixels averaged per output pixel, along each axis. */
const SAMPLES = 4

/** Rows of a picture as bytes: where row `y` starts in `data`, `spp` bytes a pixel. */
interface PixelRows {
  data: Uint8Array
  rowStart: (y: number) => number
  /** 1 grey, 2 grey + alpha, 3 RGB, 4 RGBA. */
  spp: number
  /** WhiteIsZero grey (photometric 0). */
  invert: boolean
}

/**
 * Where each output position samples, `n` source positions per output one,
 * spread evenly over the stretch it covers (or `cluster`ed around its middle,
 * so that the rows of one output row are adjacent in the file).
 */
export function samplePositions(src: number, out: number, cluster = false): { n: number; at: Int32Array } {
  const step = src / out
  const n = Math.max(1, Math.min(SAMPLES, Math.ceil(step - 1e-9)))
  const at = new Int32Array(out * n)
  for (let o = 0; o < out; o++) {
    for (let j = 0; j < n; j++) {
      const v = cluster
        ? Math.floor((o + 0.5) * step - n / 2) + j
        : Math.floor((o + (j + 0.5) / n) * step)
      at[o * n + j] = Math.min(src - 1, Math.max(0, v))
    }
  }
  return { n, at }
}

/** Average the samples into an RGBA image `outW` x `outH`. */
function resample(rows: PixelRows, width: number, height: number, outW: number, outH: number, ys = samplePositions(height, outH)): ImageData {
  const xs = samplePositions(width, outW)
  const out = new Uint8ClampedArray(outW * outH * 4)
  const { data, spp, invert } = rows
  const colOff = new Int32Array(xs.at.length)
  for (let i = 0; i < xs.at.length; i++) colOff[i] = xs.at[i] * spp
  const area = xs.n * ys.n
  const starts = new Int32Array(ys.n)
  for (let oy = 0; oy < outH; oy++) {
    for (let j = 0; j < ys.n; j++) starts[j] = rows.rowStart(ys.at[oy * ys.n + j])
    let o = oy * outW * 4
    for (let ox = 0; ox < outW; ox++, o += 4) {
      let r = 0, g = 0, b = 0, a = 0
      for (let j = 0; j < ys.n; j++) {
        const s = starts[j]
        for (let i = 0; i < xs.n; i++) {
          const p = s + colOff[ox * xs.n + i]
          if (spp >= 3) {
            r += data[p]; g += data[p + 1]; b += data[p + 2]
            a += spp === 4 ? data[p + 3] : 255
          } else {
            const v = data[p]
            r += v; g += v; b += v
            a += spp === 2 ? data[p + 1] : 255
          }
        }
      }
      if (invert) { r = 255 * area - r; g = 255 * area - g; b = 255 * area - b }
      out[o] = r / area; out[o + 1] = g / area; out[o + 2] = b / area; out[o + 3] = a / area
    }
  }
  return new ImageData(out, outW, outH)
}

// ── Uncompressed strips, straight from the file ───────────────────────────

/** Past this share of the picture's bytes, reading it whole beats reading rows. */
const RANGED_SHARE = 0.25
/** Most range reads one rendering may make (one per output row, clustered). */
const MAX_RANGED_ROWS = 640

interface StripLayout { spp: number; invert: boolean; rowBytes: number; rowsPerStrip: number; offsets: number[]; counts: number[] }

const layouts = new WeakMap<TiffDirectory, Promise<StripLayout | null>>()

/** The strip layout, when this page is one the direct path can read; null otherwise. */
function stripLayout(src: ImageSource, dir: TiffDirectory): Promise<StripLayout | null> {
  let p = layouts.get(dir)
  if (!p) {
    p = (async () => {
      const read = (o: number, l: number) => src.range(o, l)
      if (tagValue(dir, 259, 1) !== 1) return null              // compressed
      if (dir.tags.has(322) || dir.tags.has(324)) return null   // tiled
      const spp = tagValue(dir, 277, 1)
      const photometric = tagValue(dir, 262, -1)
      if (spp < 1 || spp > 4) return null
      if (spp > 1 && tagValue(dir, 284, 1) !== 1) return null   // planar
      if (photometric === 2 ? spp < 3 : !(photometric === 0 || photometric === 1) || spp > 2) return null
      if (tagValue(dir, 339, 1) !== 1) return null              // not unsigned integers
      const bits = await tagValues(read, dir, 258)
      if (bits.length === 0 ? true : bits.some(b => b !== 8)) return null
      const rowsPerStrip = Math.max(1, Math.min(tagValue(dir, 278, dir.height), dir.height))
      const [offsets, counts] = await Promise.all([tagValues(read, dir, 273), tagValues(read, dir, 279)])
      const rowBytes = dir.width * spp
      const strips = Math.ceil(dir.height / rowsPerStrip)
      if (offsets.length < strips || counts.length < strips) return null
      // Every strip must hold its rows, or the "row" bytes would be something else.
      for (let s = 0; s < strips; s++) {
        const rows = Math.min(rowsPerStrip, dir.height - s * rowsPerStrip)
        if (counts[s] < rows * rowBytes) return null
      }
      return { spp, invert: photometric === 0, rowBytes, rowsPerStrip, offsets, counts }
    })()
    layouts.set(dir, p)
  }
  return p
}

const rowOffset = (l: StripLayout, y: number) =>
  l.offsets[Math.floor(y / l.rowsPerStrip)] + (y % l.rowsPerStrip) * l.rowBytes

async function stripsImage(src: ImageSource, dir: TiffDirectory, l: StripLayout, outW: number, outH: number): Promise<ImageData> {
  const ranged = outH <= MAX_RANGED_ROWS && samplePositions(dir.height, outH).n * outH < dir.height * RANGED_SHARE
  if (!ranged) {
    const bytes = new Uint8Array((await wholeFile(src)).bytes)
    const last = rowOffset(l, dir.height - 1) + l.rowBytes
    if (last > bytes.length) throw new Error(`${src.name}: the picture is cut short`)
    return resample({ data: bytes, rowStart: y => rowOffset(l, y), spp: l.spp, invert: l.invert }, dir.width, dir.height, outW, outH)
  }
  // A small rendering: read only the rows sampled, a few adjacent rows per
  // output row so each is one read.
  const ys = samplePositions(dir.height, outH, true)
  const wanted = [...new Set(ys.at)].sort((a, b) => a - b)
  const slot = new Map<number, number>()
  wanted.forEach((y, i) => slot.set(y, i))
  const data = new Uint8Array(wanted.length * l.rowBytes)
  // Runs of rows that follow each other in the file are read together.
  const runs: { first: number; n: number }[] = []
  for (const y of wanted) {
    const run = runs[runs.length - 1]
    if (run && run.first + run.n === y && rowOffset(l, y) === rowOffset(l, run.first) + run.n * l.rowBytes) run.n++
    else runs.push({ first: y, n: 1 })
  }
  await Promise.all(runs.map(async run => {
    const bytes = await src.range(rowOffset(l, run.first), run.n * l.rowBytes)
    if (bytes.length < run.n * l.rowBytes) throw new Error(`${src.name}: the picture is cut short`)
    data.set(bytes.subarray(0, run.n * l.rowBytes), slot.get(run.first)! * l.rowBytes)
  }))
  return resample({ data, rowStart: y => slot.get(y)! * l.rowBytes, spp: l.spp, invert: l.invert }, dir.width, dir.height, outW, outH, ys)
}

// ── Everything else, through UTIF ─────────────────────────────────────────
// The parsed directories are kept with the held file, so paging through a
// multi-page fax does not parse it again.

async function utifDirectories(src: ImageSource) {
  const UTIF = await loadUtif()
  const hit = await wholeFile(src)
  hit.ifds ??= UTIF.decode(hit.bytes).filter(ifd => ifd.t256 && ifd.t257)
  return { UTIF, hit, ifds: hit.ifds }
}

async function utifImage(src: ImageSource, page: number, outW: number, outH: number): Promise<ImageData> {
  const { UTIF, hit, ifds } = await utifDirectories(src)
  const ifd = ifds[page]
  if (!ifd) throw new Error(`${src.name}: no page ${page + 1}`)
  UTIF.decodeImage(hit.bytes, ifd)
  const rgba = UTIF.toRGBA8(ifd)
  // The decoded pixels are held by the IFD; let them go with this page.
  ;(ifd as { data?: unknown }).data = undefined
  const { width, height } = ifd
  const data = new Uint8Array(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength)
  if (outW === width && outH === height) return new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height)
  return resample({ data, rowStart: y => y * width * 4, spp: 4, invert: false }, width, height, outW, outH)
}

// ── The page ──────────────────────────────────────────────────────────────

/**
 * Page `page` of a TIFF as pixels, at most `maxW` x `maxH` (never larger than
 * the picture: a zoom past 100 % is stretched by the caller).
 */
export async function tiffPageImage(src: ImageSource, page: number, maxW: number, maxH: number): Promise<ImageData> {
  let dir: TiffDirectory | undefined
  try { dir = (await tiffDirectoriesOf(src))[page] } catch { /* UTIF may still read it */ }
  if (dir) {
    const outW = Math.max(1, Math.min(dir.width, Math.round(maxW)))
    const outH = Math.max(1, Math.min(dir.height, Math.round(maxH)))
    const layout = await stripLayout(src, dir).catch(() => null)
    if (layout) return stripsImage(src, dir, layout, outW, outH)
    return utifImage(src, page, outW, outH)
  }
  // Directories we could not walk: UTIF decides.
  const ifd = (await utifDirectories(src)).ifds[page]
  if (!ifd) throw new Error(`${src.name}: no page ${page + 1}`)
  const w = (ifd.t256 as number[])[0], h = (ifd.t257 as number[])[0]
  return utifImage(src, page, Math.max(1, Math.min(w, Math.round(maxW))), Math.max(1, Math.min(h, Math.round(maxH))))
}
