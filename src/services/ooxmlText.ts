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
 */
export function ooxmlText(xml: string, ns: 'w' | 'a'): string {
  const re = new RegExp(`<(/)?${ns}:(p|t|tab|br|cr|tc|tr|tbl)(?=[\\s/>])[^>]*?(/)?>|([^<]+)`, 'g')
  let out = ''
  let inText = false
  let cellDepth = 0
  for (const m of xml.matchAll(re)) {
    const [, closing, tag, selfClosing, text] = m
    if (text !== undefined) {
      if (inText) out += decodeEntities(text)
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
    else if (tag === 'tc') { cellDepth = Math.max(0, cellDepth - 1); out = out.replace(/ +$/, '') + '\t' }
    else if (tag === 'tr') out = out.replace(/\t$/, '') + '\n'
    else if (tag === 'tbl') out += '\n'
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function zipText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path)
  return file ? file.async('string') : null
}

// ── PowerPoint ──────────────────────────────────────────────────────────────

export interface SlideText {
  /** 1-based, in presentation order. */
  number: number
  hidden: boolean
  text: string
  notes: string
}

function relsMap(xml: string | null): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>()
  for (const m of (xml ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(m[0])?.[1] ?? ''
    map.set(attr('Id'), { type: attr('Type'), target: attr('Target') })
  }
  return map
}

/** `ppt/slides/` + `../notesSlides/n.xml` → `ppt/notesSlides/n.xml`. */
function joinPart(dir: string, target: string): string {
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

export async function pptxText(bytes: Uint8Array | ArrayBuffer): Promise<SlideText[]> {
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
      text: ooxmlText(xml, 'a'),
      notes: notesXml ? notesBody(notesXml) : '',
    })
  }
  return slides
}
