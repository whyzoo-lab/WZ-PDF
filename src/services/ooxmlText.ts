/**
 * Text out of Office Open XML — Word and PowerPoint — without rendering.
 *
 * Shared by the app (a deck's speaker notes, shown under each slide and read
 * aloud) and the MCP server (doc_get_text / doc_info, mcp/src/docText.ts), so
 * both read a document the same way. Pure: JSZip and string work, no DOM.
 */

import JSZip from 'jszip'

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase()
    if (k === 'lt') return '<'
    if (k === 'gt') return '>'
    if (k === 'amp') return '&'
    if (k === 'quot') return '"'
    if (k === 'apos') return "'"
    const cp = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
  })
}

/**
 * Text of an OOXML part: runs (`t`) joined, paragraphs (`p`) on their own
 * lines, table cells separated by tabs and rows by newlines. `ns` is the
 * element prefix — `w` for Word, `a` for DrawingML (slides).
 *
 * With `picture`, each embedded picture (`a:blip`, VML `v:imagedata`) is
 * written where it stands as whatever `picture` returns for its relationship
 * id — the MCP server marks the spot and fills in the text OCR finds in it.
 */
export function ooxmlText(xml: string, ns: 'w' | 'a', picture?: (rid: string) => string): string {
  // [^<>], not [^>]: a tag ends at the next "<" whatever it says. Crossing
  // those made a 28 KB part of repeated, unclosed tags take 23 s to fail.
  const re = new RegExp(
    `<(/)?${ns}:(p|t|tab|br|cr|tc|tr|tbl)(?=[\\s/>])[^<>]*?(/)?>`
      + `|<(?:a:blip|v:imagedata)\\b[^<>]*>|([^<]+)`,
    'g',
  )
  let out = ''
  let inText = false
  let cellDepth = 0
  for (const m of xml.matchAll(re)) {
    const [whole, closing, tag, selfClosing, text] = m
    if (text !== undefined) {
      if (inText) out += decodeEntities(text)
      continue
    }
    if (tag === undefined) {
      const rid = /\br:(?:embed|id)="([^"]*)"/.exec(whole)?.[1]
      if (picture && rid) out += picture(rid)
      continue
    }
    if (tag === 't') { inText = !closing && !selfClosing; continue }
    if (tag === 'tab') { if (!closing) out += cellDepth ? ' ' : '\t'; continue }
    if (tag === 'br' || tag === 'cr') { if (!closing) out += cellDepth ? ' ' : '\n'; continue }
    if (!closing) {
      if (tag === 'tc') cellDepth++
      continue
    }
    if (tag === 'p') out += cellDepth ? ' ' : '\n'
    else if (tag === 'tc') { cellDepth = Math.max(0, cellDepth - 1); out = withoutTrailing(out, ' ') + '\t' }
    else if (tag === 'tr') out = (out.endsWith('\t') ? out.slice(0, -1) : out) + '\n'
    else if (tag === 'tbl') out += '\n'
  }
  return tidyLines(out)
}

/** A `/ +$/` here would scan the whole text so far, once per table cell. */
function withoutTrailing(s: string, ch: string): string {
  let end = s.length
  while (end > 0 && s[end - 1] === ch) end--
  return end === s.length ? s : s.slice(0, end)
}

/**
 * No trailing blanks on a line, at most one empty line in a row. By line, not
 * `/[ \t]+\n/g`: that is quadratic in a long run of spaces — 15 s on 200,000.
 */
export function tidyLines(text: string): string {
  return text.split('\n').map(line => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** More than any real document's XML part; a part past it is a zip bomb. */
const MAX_PART_BYTES = 256 * 1024 * 1024

interface InflateStream {
  on(event: 'data', fn: (chunk: Uint8Array) => void): InflateStream
  on(event: 'error', fn: (error: Error) => void): InflateStream
  on(event: 'end', fn: () => void): InflateStream
  pause(): void
  resume(): void
}

/**
 * One zip entry, stopped as soon as it inflates past `maxBytes`. The size a
 * zip declares is the attacker's to write, so bytes are counted as they come
 * out. A few KB of zip can otherwise expand until the process runs out of memory.
 */
export function inflateBounded(file: JSZip.JSZipObject, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let total = 0
    // internalStream: the one streaming API that works in a browser too; it is
    // public in JSZip's documentation but missing from its type declarations.
    const stream = (file as unknown as { internalStream(type: 'uint8array'): InflateStream }).internalStream('uint8array')
    stream
      .on('data', chunk => {
        total += chunk.length
        if (total > maxBytes) {
          stream.pause()
          reject(new Error(`${file.name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB once unpacked`))
          return
        }
        chunks.push(chunk.slice())
      })
      .on('error', reject)
      .on('end', () => {
        const out = new Uint8Array(total)
        let at = 0
        for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
        resolve(out)
      })
      .resume()
  })
}

export async function zipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path)
  return file ? new TextDecoder().decode(await inflateBounded(file, MAX_PART_BYTES)) : null
}

// ── PowerPoint ──────────────────────────────────────────────────────────────

export interface SlideText {
  /** 1-based, in presentation order. */
  number: number
  hidden: boolean
  text: string
  notes: string
}

export function relsMap(xml: string | null): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>()
  for (const m of (xml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[0])?.[1] ?? ''
    map.set(attr('Id'), { type: attr('Type'), target: attr('Target') })
  }
  return map
}

/** `ppt/slides/` + `../notesSlides/n.xml` → `ppt/notesSlides/n.xml`. */
export function joinPart(dir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${dir}/${target}`).split('/')
  const out: string[] = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p && p !== '.') out.push(p)
  }
  return out.join('/')
}

/** The body placeholder of a notes page — not its slide-number or thumbnail. */
function notesBody(xml: string): string {
  const shapes = xml.split(/<p:sp>|<p:sp\s/).slice(1)
  const body = shapes.find(s => /<p:ph\b[^>]*type="body"/.test(s))
  return body ? ooxmlText(body, 'a') : ''
}

/**
 * Slides' text and notes. With `picture`, each picture on a slide is written
 * where it stands as whatever `picture` returns for its part (`ppt/media/…`).
 */
export async function pptxText(bytes: Uint8Array | ArrayBuffer, picture?: (part: string) => string): Promise<SlideText[]> {
  const zip = await JSZip.loadAsync(bytes)
  const pres = await zipText(zip, 'ppt/presentation.xml')
  if (pres === null) throw new Error('not a PowerPoint document (no ppt/presentation.xml)')
  const rels = relsMap(await zipText(zip, 'ppt/_rels/presentation.xml.rels'))
  const order = Array.from(pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)).map(m => m[1])
  const slides: SlideText[] = []
  for (const rid of order) {
    const rel = rels.get(rid)
    if (!rel) continue
    const path = joinPart('ppt', rel.target)
    const xml = await zipText(zip, path)
    if (xml === null) continue
    const name = path.split('/').pop()!
    const slideRels = relsMap(await zipText(zip, path.replace(name, `_rels/${name}.rels`)))
    const notesRel = Array.from(slideRels.values()).find(r => r.type.endsWith('/notesSlide'))
    const notesXml = notesRel ? await zipText(zip, joinPart(path.slice(0, -name.length - 1), notesRel.target)) : null
    slides.push({
      number: slides.length + 1,
      hidden: /<p:sld\b[^>]*\bshow="(0|false)"/.test(xml),
      text: ooxmlText(xml, 'a', picture && (rid => {
        const target = slideRels.get(rid)?.target
        return target ? picture(joinPart(path.slice(0, -name.length - 1), target)) : ''
      })),
      notes: notesXml ? notesBody(notesXml) : '',
    })
  }
  return slides
}
