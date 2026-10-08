// src/services/imageDocAdapter.ts
//
// Pictures as a pdfjs-shaped ViewerDoc: one page per picture (per page, for a
// multi-page TIFF), for a collection built by services/imageSet.ts.
//
// An image is page-like in the way a message is not: fixed geometry, no
// reflow. So rather than building a separate image viewer, pictures go through
// the page pipeline — zoom, rotation, fit, the page list, annotations, print,
// OCR and every export then work through the paths they already use.
//
// Nothing is decoded until a page is drawn, and the decoded picture is dropped
// as soon as it has been painted into the raster the caller asked for: the
// render cache (services/pageRender.ts) owns what stays in memory.

import type { ImageAnimation, ImageSetEntry, ViewerDoc, ViewerPage } from '../types/viewerDoc'
import { IMAGE_MIME, type ImageInfo } from './imageInfo'
import {
  entriesFor, infoOf, isManifestFile, loadUtif, readManifest, sourceById, sourceFromBytes, tiffPagesOf,
  type ImageSource,
} from './imageSet'

/**
 * Largest raster a page is drawn into. Chromium refuses canvases past 32,767 px
 * a side or ~268 M pixels — a 48 MP photo zoomed to 300 % is well past both,
 * and came out blank. Beyond this the raster is drawn smaller and stretched
 * to the requested size: softer at extreme zoom, never empty. 64 M pixels is
 * also 256 MB of memory, as much as any one page should hold.
 */
const MAX_SIDE = 16384
const MAX_AREA = 64 * 1024 * 1024

/**
 * Longest side of a picture's page, in points. A page is otherwise its pixel
 * size, which made a 9000-px photo eleven times the size of the screenshot
 * beside it in the same folder, and a 9000-pt page in the saved PDF. Pictures
 * smaller than this keep their size (an icon is not blown up); the saved PDF
 * still carries every pixel — the page is smaller, its resolution higher.
 */
export const PAGE_MAX = 1600

export function pageSize(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, PAGE_MAX / Math.max(width, height))
  return { width: width * k, height: height * k }
}

export function clampRaster(width: number, height: number): { width: number; height: number } {
  let k = Math.min(1, MAX_SIDE / width, MAX_SIDE / height)
  if (width * height * k * k > MAX_AREA) k = Math.sqrt(MAX_AREA / (width * height))
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

// ── TIFF ──────────────────────────────────────────────────────────────────
// Decoded with UTIF (utif2): Chromium has no TIFF decoder. Scanners write TIFF
// — often CCITT fax-compressed, often several pages to a file — so this is
// what lets a scanned document in TIFF open at all. The parsed directories of
// the last couple of files are kept so paging through one does not re-parse it.

type Utif = typeof import('utif2')
const tiffCache: { id: string; bytes: ArrayBuffer; ifds: ReturnType<Utif['decode']> }[] = []

async function tiffPageImage(src: ImageSource, page: number): Promise<ImageData> {
  const UTIF = await loadUtif()
  let hit = tiffCache.find(t => t.id === src.id)
  if (!hit) {
    const bytes = await src.read()
    const ifds = UTIF.decode(bytes).filter(ifd => ifd.t256 && ifd.t257)
    hit = { id: src.id, bytes, ifds }
    tiffCache.unshift(hit)
    tiffCache.length = Math.min(tiffCache.length, 2)
  }
  const ifd = hit.ifds[page]
  if (!ifd) throw new Error(`${src.name}: no page ${page + 1}`)
  UTIF.decodeImage(hit.bytes, ifd)
  const rgba = UTIF.toRGBA8(ifd)
  const data = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), ifd.width, ifd.height)
  // The decoded pixels are held by the IFD; let them go with this page.
  ;(ifd as { data?: unknown }).data = undefined
  return data
}

// ── Decoding the others ───────────────────────────────────────────────────

/**
 * Decode a picture, at the size it will be drawn when that is much smaller
 * (thumbnails): a 12 MP photo is 48 MB decoded, its thumbnail a few KB.
 * EXIF rotation is applied by the decoder (`imageOrientation: 'from-image'`
 * is the default), which is why sizes from imageInfo are already turned.
 */
async function decodeStill(src: ImageSource, info: ImageInfo, w: number, h: number): Promise<CanvasImageSource & { close?: () => void }> {
  const blob = new Blob([await src.read()], { type: IMAGE_MIME[info.format] })
  if (typeof createImageBitmap === 'function') {
    // Resizing is asked for only on unrotated pictures: whether the resize box
    // is meant before or after EXIF rotation is not something to bet on.
    const small = info.orientation === 1 && w * 2 < info.width
    try {
      return await createImageBitmap(blob, small ? { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } : undefined)
    } catch { /* not decodable this way — try the <img> decoder */ }
  }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`${src.name}: unsupported or corrupt image`))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Paint entry `e` into `canvas`, filling it. Transparent pixels stay transparent. */
async function paint(canvas: HTMLCanvasElement, e: ImageSetEntry): Promise<void> {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const src = sourceById(e.src)
  const info = await infoOf(src)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (info.format === 'tiff') {
    const data = await tiffPageImage(src, e.page ?? 0)
    const full = document.createElement('canvas')
    full.width = data.width
    full.height = data.height
    full.getContext('2d')?.putImageData(data, 0, 0)
    ctx.drawImage(full, 0, 0, canvas.width, canvas.height)
    return
  }
  const pic = await decodeStill(src, info, canvas.width, canvas.height)
  try {
    ctx.drawImage(pic, 0, 0, canvas.width, canvas.height)
  } finally {
    pic.close?.()
  }
}

// ── Animation ─────────────────────────────────────────────────────────────

/**
 * Frames of an animated GIF or WebP through WebCodecs' ImageDecoder, which
 * Chromium has; canvas can only ever draw an animated image's first frame.
 * Null for a still picture, or where ImageDecoder is missing (the page then
 * shows the first frame, as before).
 */
async function animationOf(src: ImageSource, info: ImageInfo): Promise<ImageAnimation | null> {
  if (!info.animated || typeof ImageDecoder === 'undefined') return null
  const decoder = new ImageDecoder({ data: await src.read(), type: IMAGE_MIME[info.format] })
  try {
    await decoder.tracks.ready
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1
    if (frameCount <= 1) { decoder.close(); return null }
    return {
      frameCount,
      frame: async i => {
        const { image } = await decoder.decode({ frameIndex: i })
        // GIFs often say 0 or 10 ms; browsers show those at 100 ms, so do we.
        const ms = (image.duration ?? 0) / 1000
        return { image, duration: ms >= 20 ? ms : 100 }
      },
      close: () => decoder.close(),
    }
  } catch {
    decoder.close()
    return null
  }
}

// ── The document ──────────────────────────────────────────────────────────

/** A collection, from its manifest's bytes. */
export async function createImageSetDoc(manifestBytes: ArrayBuffer): Promise<ViewerDoc & { startPage: number }> {
  const m = readManifest(manifestBytes)
  const sizes = await Promise.all(m.entries.map(async e => {
    const src = sourceById(e.src)
    const info = await infoOf(src)
    return info.format === 'tiff' ? (await tiffPagesOf(src))[e.page ?? 0] : info
  }))

  const pages: ViewerPage[] = m.entries.map((e, i) => {
    const natural = pageSize(sizes[i].width, sizes[i].height)
    return {
      getViewport: ({ scale }) => ({ width: natural.width * scale, height: natural.height * scale, scale }),
      render: ({ canvas, viewport }) => {
        const size = clampRaster(viewport.width, viewport.height)
        canvas.width = size.width
        canvas.height = size.height
        return { promise: paint(canvas, e) }
      },
      // No text in a picture. OCR is the way to get text out, and it already
      // works off the rendered canvas.
      getTextContent: async () => ({ items: [] }),
    }
  })

  const entryOf = (page: number) => {
    const e = m.entries[page - 1]
    if (!e) throw new Error(`No page ${page}`)
    return { e, src: sourceById(e.src) }
  }

  return {
    numPages: pages.length,
    startPage: Math.min(pages.length, Math.max(1, m.start + 1)),
    getPage: async n => {
      const p = pages[n - 1]
      if (!p) throw new Error(`No page ${n}`)
      return p
    },
    images: {
      name: m.name,
      entries: m.entries,
      nameOf: page => entryOf(page).src.name,
      original: async page => {
        const { src } = entryOf(page)
        return { bytes: await src.read(), name: src.name }
      },
      encoded: async page => {
        const { src } = entryOf(page)
        const info = await infoOf(src)
        // A JPEG goes into a PDF as it is (no second compression) unless it
        // relies on EXIF rotation, which a PDF does not read.
        if (info.format === 'jpeg' && info.orientation === 1) return { bytes: new Uint8Array(await src.read()), type: 'jpeg' }
        if (info.format === 'png') return { bytes: new Uint8Array(await src.read()), type: 'png' }
        return null
      },
      mayHaveAlpha: page => {
        const { src } = entryOf(page)
        return sourceFormat(src) !== 'jpeg'
      },
      animation: async page => {
        const { src } = entryOf(page)
        return animationOf(src, await infoOf(src))
      },
    },
    destroy: () => { /* sources stay registered: undo may bring this collection back */ },
  }
}

function sourceFormat(src: ImageSource): string | null {
  return knownFormats.get(src.id) ?? null
}
const knownFormats = new Map<string, string>()

/** Remember formats as they are learned, for the synchronous `mayHaveAlpha`. */
async function learnFormats(entries: ImageSetEntry[]): Promise<void> {
  await Promise.all(entries.map(async e => {
    const src = sourceById(e.src)
    knownFormats.set(src.id, (await infoOf(src)).format)
  }))
}

/** A collection from a manifest file, or a single picture's bytes. */
export async function createImageViewerDoc(bytes: ArrayBuffer, _mimeType = '', name = 'image'): Promise<ViewerDoc> {
  void _mimeType
  const src = sourceFromBytes(name, bytes)
  const { entries } = await entriesFor([src])
  if (entries.length === 0) throw new Error('Unsupported or corrupt image')
  const { manifestFile } = await import('./imageSet')
  return openManifest(await manifestFile(name, entries).arrayBuffer())
}

/** Open a manifest, with the formats needed by `mayHaveAlpha` learned first. */
export async function openManifest(bytes: ArrayBuffer): Promise<ViewerDoc & { startPage: number }> {
  await learnFormats(readManifest(bytes).entries)
  return createImageSetDoc(bytes)
}

export { isManifestFile }
