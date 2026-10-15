// Image collections: one image, the images in its folder, a selection of
// files, or a ZIP — each shown as one document whose pages are the pictures.
//
// Why one document rather than an image viewer beside the PDF one: everything
// the page pipeline already does — page list, two-page and grid views,
// fullscreen with the presenter tools, stamps, OCR, print, read-aloud — then
// works on pictures for free, and "save as PDF" turns a folder of photos into
// one PDF, which is the point.
//
// A collection is described by a small manifest (`IMAGE_SET_MIME`): an
// ordered list of entries, each naming a source by id (services/imageSources.ts).
// A manifest is cheap to copy — which is how page operations work: delete,
// reorder or insert produce a new manifest file, and undo restores the old
// one, exactly as a page edit on a PDF replaces its bytes.
//
// **Nothing is read up front but the folder listing.** A collection is built
// from names alone, so the picture that was opened shows as soon as it is
// decoded, whatever is beside it. A page learns its size from the first KB of
// its file when it is first laid out (services/imageDocAdapter.ts). The one
// exception is TIFF: a TIFF can hold several pages, and only reading it says
// how many. This used to read the head of every file in the folder before
// showing anything — 52 photos on a network drive took 2.3 s of that alone.

import { IMAGE_SET_MIME, type ImageSetEntry } from '../types/viewerDoc'
import { imageInfo, isImageName, naturalCompare, sniffImage, type ImageInfo } from './imageInfo'
import { pathOf } from './documentPaths'
import {
  sourceById, sourceFromBytes, sourceFromFile, sourceFromInflate, sourceFromPath, type ImageSource,
} from './imageSources'

export { IMAGE_SET_MIME, sourceById, sourceFromBytes, sourceFromFile, type ImageSource }

// A file opened from disk carries no path in the renderer; App records it in
// services/documentPaths.ts so opening a picture can find the rest of its folder.

// ── Manifests ─────────────────────────────────────────────────────────────

interface Manifest { wzImageSet: 1; name: string; entries: ImageSetEntry[]; start: number }

/** A collection as a file: what `setFile` takes, what undo restores. */
export function manifestFile(name: string, entries: ImageSetEntry[], start = 0): File {
  const body: Manifest = { wzImageSet: 1, name, entries, start }
  return new File([JSON.stringify(body)], name, { type: IMAGE_SET_MIME })
}

export function isManifestFile(file: { type?: string }): boolean {
  return file.type === IMAGE_SET_MIME
}

export function readManifest(bytes: ArrayBuffer): Manifest {
  const m = JSON.parse(new TextDecoder().decode(bytes)) as Manifest
  if (m?.wzImageSet !== 1 || !Array.isArray(m.entries)) throw new Error('Not an image collection')
  for (const e of m.entries) sourceById(e.src)          // every source still known
  return m
}

// ── Sizes ─────────────────────────────────────────────────────────────────

const infos = new Map<string, Promise<ImageInfo>>()
const known = new Map<string, ImageInfo>()
const tiffPages = new Map<string, Promise<{ width: number; height: number }[]>>()

const HEAD_BYTES = 256 * 1024

/** A source's format and displayed size, from its header (cached). */
export function infoOf(src: ImageSource): Promise<ImageInfo> {
  let p = infos.get(src.id)
  if (!p) {
    p = (async () => {
      let info = imageInfo(await src.head(HEAD_BYTES))
      // A JPEG whose frame header sits past a large embedded thumbnail.
      if (!info) info = imageInfo(new Uint8Array(await src.read()))
      if (!info) throw new Error(`${src.name}: not an image this app can show`)
      known.set(src.id, info)
      return info
    })()
    infos.set(src.id, p)
    p.catch(() => infos.delete(src.id))
  }
  return p
}

/** What `infoOf` has already learned, without waiting. */
export function knownInfo(src: ImageSource): ImageInfo | undefined {
  return known.get(src.id)
}

type Utif = typeof import('utif2')
let utif: Promise<Utif> | null = null
/** The TIFF decoder, loaded the first time a TIFF is opened (CommonJS module). */
export const loadUtif = (): Promise<Utif> =>
  (utif ??= import('utif2').then(m => ((m as unknown as { default?: Utif }).default ?? m)))

/** Size of each page of a TIFF (the whole file is needed to count them). */
export function tiffPagesOf(src: ImageSource): Promise<{ width: number; height: number }[]> {
  let p = tiffPages.get(src.id)
  if (!p) {
    p = (async () => {
      const UTIF = await loadUtif()
      const ifds = UTIF.decode(await src.read()).filter(ifd => (ifd.t256 as number[] | undefined) && (ifd.t257 as number[] | undefined))
      const pages = ifds.map(ifd => ({ width: (ifd.t256 as number[])[0], height: (ifd.t257 as number[])[0] }))
      if (pages.length === 0) throw new Error(`${src.name}: no pages`)
      return pages
    })()
    tiffPages.set(src.id, p)
    p.catch(() => tiffPages.delete(src.id))
  }
  return p
}

/**
 * Entries for sources in order — a multi-page TIFF becomes one entry per page.
 * Only TIFFs are read here (to count their pages); a TIFF that cannot be read
 * is left out. Anything else is one page, read when that page is drawn.
 */
export async function entriesFor(list: ImageSource[]): Promise<{ entries: ImageSetEntry[]; firstOf: Map<string, number> }> {
  const pageCounts = await mapLimit(list, 4, async src =>
    src.tiff ? (await tiffPagesOf(src).catch(() => [])).length : 1)
  const entries: ImageSetEntry[] = []
  const firstOf = new Map<string, number>()
  list.forEach((src, i) => {
    if (pageCounts[i] === 0) return
    firstOf.set(src.id, entries.length)
    if (!src.tiff) { entries.push({ src: src.id }); return }
    for (let page = 0; page < pageCounts[i]; page++) entries.push({ src: src.id, page })
  })
  return { entries, firstOf }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

// ── Building collections ──────────────────────────────────────────────────

const stripExt = (name: string) => name.replace(/\.[^.]+$/, '')

/** Most pictures a folder or ZIP contributes — more is not a page list. */
export const MAX_IMAGES = 2000

/**
 * A picture opened on its own: the images in its folder, in Explorer's order,
 * starting at this one. Without a folder to look in (the web build, a file
 * from a URL or an attachment) it is a collection of one.
 */
export async function collectionForImage(file: { name: string }, bytes: ArrayBuffer): Promise<File> {
  const opened = sourceFromBytes(file.name, bytes)
  // The opened file is in memory: make sure it is a picture now, so a broken
  // one fails here rather than as a blank page.
  await infoOf(opened)
  const path = pathOf(file)
  const api = window.electronAPI
  let list = [opened]
  let name = file.name
  if (path && api?.listFolderImages) {
    try {
      const siblings = await api.listFolderImages(path)
      const here = siblings.findIndex(s => s.path.toLowerCase() === path.toLowerCase())
      if (siblings.length > 1 && here >= 0) {
        list = siblings.map((s, i) => (i === here ? opened : sourceFromPath(s.path, s.name, s.size)))
        name = folderName(path)
      }
    } catch { /* a folder we may not list: just this picture */ }
  }
  const { entries, firstOf } = await entriesFor(list)
  if (entries.length === 0) throw new Error(`${file.name}: not an image this app can show`)
  return manifestFile(name, entries, firstOf.get(opened.id) ?? 0)
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2] : stripExt(parts[parts.length - 1] ?? 'images')
}

/** Several pictures picked or dropped together. */
export async function collectionForFiles(files: File[]): Promise<File> {
  const list = files.filter(f => isImageName(f.name) || f.type.startsWith('image/')).map(sourceFromFile)
  const { entries } = await entriesFor(list)
  if (entries.length === 0) throw new Error('No pictures this app can show')
  return manifestFile(stripExt(files[0].name), entries)
}

/**
 * A ZIP of pictures — such as the one "save images" writes. Read lazily: each
 * picture is inflated when its page is first drawn.
 */
export async function collectionForZip(bytes: ArrayBuffer, name: string): Promise<File> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(bytes)
  const list = Object.values(zip.files)
    .filter(f => !f.dir && !f.name.startsWith('__MACOSX/') && isImageName(f.name))
    .sort((a, b) => naturalCompare(a.name, b.name))
    .slice(0, MAX_IMAGES)
    .map(f => sourceFromInflate(f.name.split('/').pop() ?? f.name, () => f.async('arraybuffer')))
  const { entries } = await entriesFor(list)
  if (entries.length === 0) throw new Error(`${name}: no pictures inside`)
  return manifestFile(stripExt(name), entries)
}

/** Whether a ZIP holds pictures rather than an Office or HWPX document. */
export function zipLooksLikeImages(names: string[]): boolean {
  return names.some(isImageName) &&
    !names.some(n => n === 'mimetype' || n.startsWith('word/') || n.startsWith('ppt/') || n.startsWith('xl/') || n === '[Content_Types].xml')
}

/** A white page the size of `like`, for "insert blank page". */
export async function blankSource(width: number, height: number): Promise<ImageSource> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  const ctx = canvas.getContext('2d')
  if (ctx) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  const bytes = blob ? await blob.arrayBuffer() : new ArrayBuffer(0)
  return sourceFromBytes('blank.png', bytes)
}

export { sniffImage }
