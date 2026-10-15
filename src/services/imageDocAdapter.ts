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
  entriesFor, infoOf, isManifestFile, knownInfo, loadUtif, manifestFile, readManifest, sourceById, sourceFromBytes,
  tiffPagesOf, type ImageSource,
} from './imageSet'
import { t } from '../i18n'

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
 * (fitted pages, thumbnails): a 12 MP photo is 48 MB decoded, its fitted page
 * a few MB. EXIF rotation is applied by the decoder (`imageOrientation:
 * 'from-image'` is the default), which is why sizes from imageInfo are
 * already turned — and the resize box is in that turned size too: checked in
 * the app's Chromium on a 4032x3024 photo tagged orientation 6, the resized
 * decode matched a full decode drawn small (mean difference 1.9 of 255, the
 * same as for an unrotated photo).
 */
async function decodeStill(src: ImageSource, info: ImageInfo, w: number, h: number): Promise<CanvasImageSource & { close?: () => void }> {
  const blob = new Blob([await src.read()], { type: IMAGE_MIME[info.format] })
  if (typeof createImageBitmap === 'function') {
    const small = w * 2 < info.width
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

/** A page whose file cannot be read: grey, with its name, rather than blank. */
function paintUnreadable(canvas: HTMLCanvasElement, name: string): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#6b7280'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${Math.max(12, Math.round(canvas.width / 40))}px sans-serif`
  ctx.fillText(t('page.imageUnreadable', { name }), canvas.width / 2, canvas.height / 2, canvas.width * 0.9)
}

/** Used for pages not yet read when even the start page could not be. */
const LETTER = { width: 612, height: 792 }

/**
 * A collection, from its manifest's bytes. Only the start page is read here;
 * every other page reads its file's header when it is first asked for
 * (`getPage`), and until then is assumed to be the start page's size — a
 * folder is usually one camera's pictures, all one size — so the page list
 * lays out the way it will look.
 */
export async function createImageSetDoc(manifestBytes: ArrayBuffer): Promise<ViewerDoc & { startPage: number }> {
  const m = readManifest(manifestBytes)
  const count = m.entries.length
  const startPage = Math.min(count, Math.max(1, m.start + 1))

  const entryOf = (page: number) => {
    const e = m.entries[page - 1]
    if (!e) throw new Error(`No page ${page}`)
    return { e, src: sourceById(e.src) }
  }

  // Page size in points once read; `unreadable` for files that are not
  // pictures after all (the folder listing goes by extension).
  const sizes: ({ width: number; height: number } | undefined)[] = new Array(count)
  const unreadable = new Set<number>()
  let guess = LETTER
  const sizeOf = async (page: number) => {
    const known = sizes[page - 1]
    if (known) return known
    const { e, src } = entryOf(page)
    try {
      const info = await infoOf(src)
      const px = info.format === 'tiff' ? (await tiffPagesOf(src))[e.page ?? 0] : info
      if (!px) throw new Error(`${src.name}: no page ${(e.page ?? 0) + 1}`)
      sizes[page - 1] = pageSize(px.width, px.height)
    } catch {
      unreadable.add(page)
      sizes[page - 1] = guess
    }
    return sizes[page - 1]!
  }
  const start = await sizeOf(startPage)
  if (!unreadable.has(startPage)) guess = start

  const pages = new Map<number, ViewerPage>()
  const makePage = (page: number, natural: { width: number; height: number }): ViewerPage => {
    const { e, src } = entryOf(page)
    return {
      getViewport: ({ scale }) => ({ width: natural.width * scale, height: natural.height * scale, scale }),
      render: ({ canvas, viewport }) => {
        const size = clampRaster(viewport.width, viewport.height)
        canvas.width = size.width
        canvas.height = size.height
        if (unreadable.has(page)) { paintUnreadable(canvas, src.name); return { promise: Promise.resolve() } }
        return { promise: paint(canvas, e) }
      },
      // No text in a picture. OCR is the way to get text out, and it already
      // works off the rendered canvas.
      getTextContent: async () => ({ items: [] }),
    }
  }

  return {
    numPages: count,
    startPage,
    getPage: async n => {
      const hit = pages.get(n)
      if (hit) return hit
      const page = makePage(n, await sizeOf(n))
      pages.set(n, page)
      return page
    },
    pageSizeHint: n => sizes[n - 1] ?? guess,
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
      // Asked while drawing, after the page's header has been read; the name
      // is only a fallback.
      mayHaveAlpha: page => {
        const { src } = entryOf(page)
        const format = knownInfo(src)?.format
        return format ? format !== 'jpeg' : !/\.jpe?g$/i.test(src.name)
      },
      animation: async page => {
        const { src } = entryOf(page)
        return animationOf(src, await infoOf(src))
      },
    },
    destroy: () => { /* sources stay registered: undo may bring this collection back */ },
  }
}

/** A collection from a manifest file, or a single picture's bytes. */
export async function createImageViewerDoc(bytes: ArrayBuffer, _mimeType = '', name = 'image'): Promise<ViewerDoc> {
  void _mimeType
  const src = sourceFromBytes(name, bytes)
  await infoOf(src)                                   // a picture at all?
  const { entries } = await entriesFor([src])
  if (entries.length === 0) throw new Error('Unsupported or corrupt image')
  return createImageSetDoc(await manifestFile(name, entries).arrayBuffer())
}

/** Open a manifest (a collection just built, or one restored by undo). */
export const openManifest = createImageSetDoc

export { isManifestFile }
