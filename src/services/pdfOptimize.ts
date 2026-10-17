// Make a PDF smaller without changing what it shows (or, for images, only
// their resolution). A port, sized down, of PdfCraft's `crates/optimize`
// (Apache-2.0/MIT) — Acrobat's Reduce File Size:
//  - images: each one's effective resolution is measured where pages draw it
//    (the smallest over all its uses, through form XObjects), and one above
//    the preset's threshold is resampled to its target and stored as JPEG —
//    kept only if that is smaller. JPEGs and 8-bit grey/RGB images are done;
//    masks, CMYK and other colour spaces, predictors, JPEG 2000, JBIG2 and
//    CCITT are left alone, as in PdfCraft;
//  - identical objects (a font or image embedded twice, as inserting a file
//    can leave) are merged;
//  - streams with no filter are Flate-compressed;
//  - thumbnails, alternate images and private data go;
//  - what nothing refers to any more is dropped, and the file is written
//    with object streams.

import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRawStream, PDFRef, PDFStream,
  decodePDFRawStream,
} from '@cantoo/pdf-lib'
import { collectGarbage } from './pdfStructure'

const N = (s: string) => PDFName.of(s)

export interface OptimizeSettings {
  /** Images above this many pixels per inch are resampled … */
  above: number
  /** … to this. */
  target: number
  /** JPEG quality, 0–1. */
  quality: number
  /** Also drop the document's tags (structure tree) — smaller, less accessible. */
  dropTags?: boolean
}

export const PRESETS = {
  standard: { above: 225, target: 150, quality: 0.75 },
  screen: { above: 144, target: 96, quality: 0.7 },
  high: { above: 300, target: 200, quality: 0.85 },
} satisfies Record<string, OptimizeSettings>

/** Pixels in, a JPEG of the given size out (the app does it on a canvas). */
export interface ImageCodec {
  resample(input: { jpeg: Uint8Array } | { raw: Uint8Array; width: number; height: number; channels: 1 | 3 }, width: number, height: number, quality: number): Promise<Uint8Array | null>
}

export interface OptimizeReport {
  before: number
  after: number
  imagesResampled: number
  objectsMerged: number
  streamsCompressed: number
}

// ── Reading content streams ─────────────────────────────────────────────────

type Token = number | string | { name: string }

/**
 * The operators of a content stream with their numeric and name operands —
 * all that is needed to follow q / Q / cm / Do. Strings, arrays, dictionaries
 * and inline images are skipped over properly, so their bytes are never
 * mistaken for operators.
 */
export function scanContent(bytes: Uint8Array): { op: string; args: Token[] }[] {
  const out: { op: string; args: Token[] }[] = []
  let args: Token[] = []
  let i = 0
  const n = bytes.length
  const isWs = (c: number) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0
  const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37
  while (i < n) {
    const c = bytes[i]
    if (isWs(c)) { i++; continue }
    if (c === 37) { while (i < n && bytes[i] !== 10 && bytes[i] !== 13) i++; continue } // comment
    if (c === 40) { // (string) with nesting and escapes
      let depth = 1; i++
      while (i < n && depth > 0) {
        if (bytes[i] === 92) i += 2
        else { if (bytes[i] === 40) depth++; else if (bytes[i] === 41) depth--; i++ }
      }
      args.push('')
      continue
    }
    if (c === 60 && bytes[i + 1] === 60) { // << dict >>
      let depth = 0
      while (i < n) {
        if (bytes[i] === 60 && bytes[i + 1] === 60) { depth++; i += 2 }
        else if (bytes[i] === 62 && bytes[i + 1] === 62) { depth--; i += 2; if (depth === 0) break }
        else if (bytes[i] === 40) { let d = 1; i++; while (i < n && d > 0) { if (bytes[i] === 92) i += 2; else { if (bytes[i] === 40) d++; else if (bytes[i] === 41) d--; i++ } } }
        else i++
      }
      args.push('')
      continue
    }
    if (c === 60) { while (i < n && bytes[i] !== 62) i++; i++; args.push(''); continue } // <hex>
    if (c === 91 || c === 93 || c === 123 || c === 125) { i++; continue } // arrays: their numbers are kept as operands, harmlessly
    if (c === 47) { // /Name
      let j = i + 1
      while (j < n && !isWs(bytes[j]) && !isDelim(bytes[j])) j++
      args.push({ name: new TextDecoder('latin1').decode(bytes.subarray(i + 1, j)) })
      i = j
      continue
    }
    let j = i
    while (j < n && !isWs(bytes[j]) && !isDelim(bytes[j])) j++
    if (j === i) { i++; continue }
    const word = new TextDecoder('latin1').decode(bytes.subarray(i, j))
    i = j
    const num = Number(word)
    if (word !== '' && !Number.isNaN(num) && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) { args.push(num); continue }
    if (word === 'BI') {
      // Inline image: skip to "EI" standing alone after the data.
      const id = indexOf(bytes, 'ID', i)
      let k = id < 0 ? n : id + 3
      while (k < n && !(bytes[k] === 69 && bytes[k + 1] === 73 && isWs(bytes[k - 1]) && (k + 2 >= n || isWs(bytes[k + 2])))) k++
      i = k + 2
      out.push({ op: 'BI', args: [] })
      args = []
      continue
    }
    out.push({ op: word, args })
    args = []
  }
  return out
}

function indexOf(b: Uint8Array, s: string, from: number): number {
  outer: for (let i = from; i <= b.length - s.length; i++) {
    for (let j = 0; j < s.length; j++) if (b[i + j] !== s.charCodeAt(j)) continue outer
    return i
  }
  return -1
}

type Matrix = [number, number, number, number, number, number]
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
]

function streamBytes(doc: PDFDocument, o: PDFObject | undefined): Uint8Array | null {
  const s = o instanceof PDFRef ? doc.context.lookup(o) : o
  if (!(s instanceof PDFRawStream)) return null
  try { return decodePDFRawStream(s).decode() } catch { return null }
}

/**
 * The smallest size, in points, each image XObject is drawn at, by ref:
 * pages and the form XObjects they draw, up to 12 deep. An image drawn where
 * it cannot be measured (deeper forms) is marked so it is never resampled.
 */
export function imageUses(doc: PDFDocument): Map<string, { w: number; h: number } | 'unmeasured'> {
  const uses = new Map<string, { w: number; h: number } | 'unmeasured'>()
  const record = (ref: string, m: Matrix) => {
    const w = Math.hypot(m[0], m[1]), h = Math.hypot(m[2], m[3])
    const prev = uses.get(ref)
    if (prev === 'unmeasured') return
    uses.set(ref, prev ? { w: Math.min(prev.w, w), h: Math.min(prev.h, h) } : { w, h })
  }
  const walk = (content: Uint8Array, resources: PDFDict | undefined, ctm: Matrix, depth: number) => {
    const xobjects = resources?.lookupMaybe(N('XObject'), PDFDict)
    const stack: Matrix[] = []
    let m = ctm
    for (const { op, args } of scanContent(content)) {
      if (op === 'q') stack.push(m)
      else if (op === 'Q') m = stack.pop() ?? m
      else if (op === 'cm' && args.length >= 6 && args.slice(-6).every(a => typeof a === 'number')) m = mul(args.slice(-6) as Matrix, m)
      else if (op === 'Do') {
        const name = args[args.length - 1]
        if (!name || typeof name !== 'object') continue
        const ref = xobjects?.get(N(name.name))
        if (!(ref instanceof PDFRef)) continue
        const x = doc.context.lookup(ref)
        if (!(x instanceof PDFStream)) continue
        const subtype = x.dict.get(N('Subtype'))
        if (subtype === N('Image')) record(ref.toString(), m)
        else if (subtype === N('Form')) {
          if (depth >= 12) { markAll(x.dict.lookupMaybe(N('Resources'), PDFDict)); continue }
          const fm = x.dict.lookupMaybe(N('Matrix'), PDFArray)?.asArray().map(v => (v instanceof PDFNumber ? v.asNumber() : 0)) as Matrix | undefined
          const inner = streamBytes(doc, ref)
          if (inner) walk(inner, x.dict.lookupMaybe(N('Resources'), PDFDict) ?? resources, fm && fm.length === 6 ? mul(fm, m) : m, depth + 1)
        }
      }
    }
  }
  const markAll = (resources: PDFDict | undefined) => {
    for (const [, ref] of resources?.lookupMaybe(N('XObject'), PDFDict)?.entries() ?? []) if (ref instanceof PDFRef) uses.set(ref.toString(), 'unmeasured')
  }
  for (const page of doc.getPages()) {
    const contents = page.node.get(N('Contents'))
    const parts = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
    const chunks = parts.map(p => streamBytes(doc, p)).filter((b): b is Uint8Array => !!b)
    const all = new Uint8Array(chunks.reduce((s, c) => s + c.length + 1, 0))
    let at = 0
    for (const c of chunks) { all.set(c, at); at += c.length; all[at++] = 10 }
    walk(all, page.node.Resources(), [1, 0, 0, 1, 0, 0], 0)
  }
  return uses
}

// ── Images ──────────────────────────────────────────────────────────────────

function nameOf(o: PDFObject | undefined): string {
  return o instanceof PDFName ? o.decodeText() : ''
}

async function resampleImages(doc: PDFDocument, settings: OptimizeSettings, codec: ImageCodec): Promise<number> {
  let done = 0
  for (const [key, size] of imageUses(doc)) {
    if (size === 'unmeasured' || size.w <= 0 || size.h <= 0) continue
    const ref = [...doc.context.enumerateIndirectObjects()].find(([r]) => r.toString() === key)?.[0]
    if (!ref) continue
    const img = doc.context.lookup(ref)
    if (!(img instanceof PDFRawStream)) continue
    const d = img.dict
    const width = (d.get(N('Width')) as PDFNumber | undefined)?.asNumber() ?? 0
    const height = (d.get(N('Height')) as PDFNumber | undefined)?.asNumber() ?? 0
    const bpc = (d.get(N('BitsPerComponent')) as PDFNumber | undefined)?.asNumber() ?? 0
    const cs = nameOf(d.lookup(N('ColorSpace')) as PDFObject | undefined)
    if (!width || !height || bpc !== 8 || (cs !== 'DeviceRGB' && cs !== 'DeviceGray')) continue
    if (d.has(N('SMask')) || d.has(N('Mask')) || d.has(N('ImageMask')) || d.has(N('Decode')) || d.has(N('DecodeParms'))) continue
    const ppi = Math.min(width / (size.w / 72), height / (size.h / 72))
    if (ppi <= settings.above) continue
    const k = settings.target / ppi
    const w = Math.max(1, Math.round(width * k)), h = Math.max(1, Math.round(height * k))
    const filter = d.get(N('Filter'))
    const filters = filter instanceof PDFArray ? filter.asArray().map(nameOf) : filter ? [nameOf(filter)] : []
    let input: Parameters<ImageCodec['resample']>[0]
    if (filters.length === 1 && filters[0] === 'DCTDecode') input = { jpeg: img.contents }
    else if (filters.every(f => f === 'FlateDecode' || f === 'LZWDecode' || f === 'ASCII85Decode' || f === 'ASCIIHexDecode' || f === 'RunLengthDecode')) {
      let raw: Uint8Array
      try { raw = decodePDFRawStream(img).decode() } catch { continue }
      const channels = cs === 'DeviceRGB' ? 3 : 1
      if (raw.length < width * height * channels) continue
      input = { raw, width, height, channels }
    } else continue
    const jpeg = await codec.resample(input, w, h, settings.quality).catch(() => null)
    if (!jpeg || jpeg.length >= img.contents.length) continue
    const dict = doc.context.obj({
      Type: 'XObject', Subtype: 'Image', Width: w, Height: h, BitsPerComponent: 8,
      ColorSpace: 'DeviceRGB', Filter: 'DCTDecode', Length: jpeg.length,
    }) as PDFDict
    // Keep what else the image carries (an /Intent, /Interpolate, its /Name).
    for (const extra of ['Intent', 'Interpolate', 'Name', 'OC']) { const v = d.get(N(extra)); if (v) dict.set(N(extra), v) }
    doc.context.assign(ref, PDFRawStream.of(dict, jpeg))
    done++
  }
  return done
}

// ── Merging identical objects ───────────────────────────────────────────────

function hashBytes(b: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < b.length; i++) { h1 = Math.imul(h1 ^ b[i], 16777619); h2 = Math.imul(h2 + b[i], 2246822519) ^ (h2 >>> 13) }
  return `${b.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`
}

/** Point every reference to a duplicate at the copy kept. */
function rewriteRefs(o: PDFObject, map: Map<string, PDFRef>): void {
  if (o instanceof PDFDict) {
    for (const [k, v] of o.entries()) {
      if (v instanceof PDFRef) { const to = map.get(v.toString()); if (to) o.set(k, to) }
      else rewriteRefs(v, map)
    }
  } else if (o instanceof PDFArray) {
    for (let i = 0; i < o.size(); i++) {
      const v = o.get(i)
      if (v instanceof PDFRef) { const to = map.get(v.toString()); if (to) o.set(i, to) }
      else rewriteRefs(v, map)
    }
  } else if (o instanceof PDFStream) rewriteRefs(o.dict, map)
}

/**
 * Merge identical streams and dictionaries (pages excepted — two equal pages
 * are still two pages). Repeated until nothing merges: identical font files
 * make their descriptors identical, which make the fonts identical.
 */
function mergeIdentical(doc: PDFDocument): number {
  let merged = 0
  const pageRefs = new Set(doc.getPages().map(p => p.ref.toString()))
  for (let pass = 0; pass < 6; pass++) {
    const seen = new Map<string, PDFRef>()
    const map = new Map<string, PDFRef>()
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (pageRefs.has(ref.toString())) continue
      let key: string | null = null
      if (obj instanceof PDFRawStream) key = `S${obj.dict.toString()}|${hashBytes(obj.contents)}`
      else if (obj instanceof PDFDict) {
        const type = obj.get(N('Type'))
        // Only resource-like dictionaries; structural ones (pages, outline items, annotations) keep their identity.
        if (type === N('Font') || type === N('FontDescriptor') || type === N('ExtGState') || type === N('XObject')) key = `D${obj.toString()}`
      }
      if (!key) continue
      const first = seen.get(key)
      if (first) map.set(ref.toString(), first)
      else seen.set(key, ref)
    }
    if (map.size === 0) break
    for (const [, obj] of doc.context.enumerateIndirectObjects()) rewriteRefs(obj, map)
    const t = doc.context.trailerInfo
    for (const k of ['Root', 'Info'] as const) { const v = t[k]; if (v instanceof PDFRef && map.has(v.toString())) t[k] = map.get(v.toString())! }
    merged += map.size
  }
  return merged
}

// ── Streams and leftovers ───────────────────────────────────────────────────

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate')
  const out = new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(cs))
  return new Uint8Array(await out.arrayBuffer())
}

async function compressPlainStreams(doc: PDFDocument): Promise<number> {
  let n = 0
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(N('Filter')) || obj.contents.length < 64) continue
    // Metadata stays readable (PDF/A asks for it uncompressed); signatures' bytes must not move.
    if (obj.dict.get(N('Type')) === N('Metadata') || obj.dict.get(N('Type')) === N('XRef')) continue
    const packed = await deflate(obj.contents)
    if (packed.length >= obj.contents.length) continue
    const dict = obj.dict.clone(doc.context)
    dict.set(N('Filter'), N('FlateDecode'))
    dict.set(N('Length'), PDFNumber.of(packed.length))
    doc.context.assign(ref, PDFRawStream.of(dict, packed))
    n++
  }
  return n
}

function dropExtras(doc: PDFDocument, dropTags: boolean): void {
  for (const page of doc.getPages()) for (const k of ['Thumb', 'PieceInfo']) page.node.delete(N(k))
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const d = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null
    if (d?.get(N('Subtype')) === N('Image')) d.delete(N('Alternates'))
  }
  doc.catalog.delete(N('PieceInfo'))
  if (dropTags) { doc.catalog.delete(N('StructTreeRoot')); doc.catalog.delete(N('MarkInfo')); for (const p of doc.getPages()) p.node.delete(N('StructParents')) }
}

/** Optimize a PDF. `codec` resamples images; without it images are left as they are. */
export async function optimizePdf(bytes: ArrayBuffer, settings: OptimizeSettings, codec?: ImageCodec, password?: string): Promise<{ bytes: Uint8Array; report: OptimizeReport }> {
  const { loadPdfForWriting } = await import('./pdfLoad')
  const doc = await loadPdfForWriting(bytes, password)
  const imagesResampled = codec ? await resampleImages(doc, settings, codec) : 0
  dropExtras(doc, !!settings.dropTags)
  collectGarbage(doc)
  const objectsMerged = mergeIdentical(doc)
  const streamsCompressed = await compressPlainStreams(doc)
  collectGarbage(doc)
  const out = await doc.save({ useObjectStreams: true })
  return { bytes: out, report: { before: bytes.byteLength, after: out.length, imagesResampled, objectsMerged, streamsCompressed } }
}
