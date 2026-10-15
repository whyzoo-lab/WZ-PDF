// Where the pictures of an image collection come from, and how their bytes
// are read: a file on disk (through the main process), a picked File, a ZIP
// entry, or bytes already in memory.
//
// Two things here are about speed, both measured on a folder of 52 camera
// JPEGs (8 MB each) on a network drive:
//
// - **Reads wait in one queue, newest first, a few at a time.** Pages ask for
//   their file as they come into view. Opening a picture deep in a folder
//   used to pass every page above it on the way down, and each started reading
//   its whole file — the picture asked for last (the one on screen) waited
//   behind forty others and appeared after 20 s. Newest-first serves what is on
//   screen now; what scrolled past is read later, if still wanted.
// - **Whole files are kept for a while** (least recently used out, a budget in
//   bytes). Zooming re-renders a page, and every re-render used to read its
//   8 MB again over the network; a thumbnail and its page read it twice.

import { sniffImage } from './imageInfo'

/** One picture file. */
export interface ImageSource {
  id: string
  name: string
  /** Known to be a TIFF (which may have several pages) without reading it. */
  tiff: boolean
  /** Whole file. */
  read(): Promise<ArrayBuffer>
  /** The first `n` bytes (fewer if the file is shorter). */
  head(n: number): Promise<Uint8Array>
}

const TIFF_NAME = /\.tiff?$/i

// ── The read queue ────────────────────────────────────────────────────────

export interface ReadQueue {
  run<T>(job: () => Promise<T>): Promise<T>
}

/** Jobs run `limit` at a time, the most recently added first. */
export function createReadQueue(limit: number): ReadQueue {
  const waiting: (() => void)[] = []
  let running = 0
  const pump = () => {
    while (running < limit && waiting.length > 0) {
      running++
      waiting.pop()!()
    }
  }
  return {
    run: job => new Promise((resolve, reject) => {
      waiting.push(() => {
        job().then(resolve, reject).finally(() => { running--; pump() })
      })
      pump()
    }),
  }
}

// ── Whole-file cache ──────────────────────────────────────────────────────

export interface ByteCache {
  /** The file's bytes, from the cache or `load` — one load at a time per id. */
  get(id: string, load: () => Promise<ArrayBuffer>): Promise<ArrayBuffer>
  /** What is held now, if anything. */
  peek(id: string): ArrayBuffer | undefined
}

export function createByteCache(budget: number): ByteCache {
  const held = new Map<string, ArrayBuffer>()        // insertion order = recency
  const loading = new Map<string, Promise<ArrayBuffer>>()
  let total = 0
  const keep = (id: string, bytes: ArrayBuffer) => {
    if (bytes.byteLength > budget / 2) return          // one file must not empty it
    held.set(id, bytes)
    total += bytes.byteLength
    for (const [old, b] of held) {
      if (total <= budget) break
      held.delete(old)
      total -= b.byteLength
    }
  }
  return {
    peek: id => held.get(id),
    get(id, load) {
      const hit = held.get(id)
      if (hit) { held.delete(id); held.set(id, hit); return Promise.resolve(hit) }
      const pending = loading.get(id)
      if (pending) return pending
      const p = load().then(bytes => { keep(id, bytes); return bytes }).finally(() => loading.delete(id))
      loading.set(id, p)
      return p
    },
  }
}

const reads = createReadQueue(3)
const files = createByteCache(192 * 1024 * 1024)

// ── The registry ──────────────────────────────────────────────────────────
// Manifests name sources by id (services/imageSet.ts), so a manifest is cheap
// to copy and undo can bring an old one back.

const sources = new Map<string, ImageSource>()
let nextId = 1

function register(name: string, tiff: boolean, make: (id: string) => Pick<ImageSource, 'read' | 'head'>): ImageSource {
  const id = `img${nextId++}`
  const src: ImageSource = { id, name, tiff, ...make(id) }
  sources.set(id, src)
  return src
}

export function sourceById(id: string): ImageSource {
  const s = sources.get(id)
  if (!s) throw new Error('Image is no longer available')
  return s
}

/** The first `n` bytes of a whole file that may already be held. */
const headOf = async (bytes: ArrayBuffer, n: number) => new Uint8Array(bytes, 0, Math.min(n, bytes.byteLength))

export function sourceFromBytes(name: string, bytes: ArrayBuffer): ImageSource {
  const tiff = sniffImage(new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength))) === 'tiff'
  return register(name, tiff, () => ({
    read: async () => bytes,
    head: n => headOf(bytes, n),
  }))
}

export function sourceFromFile(file: File): ImageSource {
  return register(file.name, TIFF_NAME.test(file.name) || file.type === 'image/tiff', id => ({
    read: () => files.get(id, () => file.arrayBuffer()),
    head: async n => {
      const held = files.peek(id)
      return held ? headOf(held, n) : new Uint8Array(await file.slice(0, n).arrayBuffer())
    },
  }))
}

/** A file on disk, read through the main process when a page needs it. */
export function sourceFromPath(path: string, name: string, size: number): ImageSource {
  const api = window.electronAPI!
  return register(name, TIFF_NAME.test(name), id => ({
    read: () => files.get(id, () => reads.run(() => api.readFile(path))),
    head: async n => {
      const held = files.peek(id)
      if (held) return headOf(held, n)
      return new Uint8Array(await reads.run(() => api.readFileRange(path, 0, Math.min(n, size))))
    },
  }))
}

/** One picture inside a ZIP, inflated when it is first needed. */
export function sourceFromInflate(name: string, inflate: () => Promise<ArrayBuffer>): ImageSource {
  return register(name, TIFF_NAME.test(name), id => {
    const read = () => files.get(id, inflate)
    return { read, head: async n => headOf(await read(), n) }
  })
}
