// What ties a PDF's pages to the rest of it — bookmarks, links, named
// destinations, form fields — kept intact when pages are inserted from
// another file, deleted or moved. After PdfCraft's `crates/organize`
// (import.rs, prune.rs; Apache-2.0/MIT):
//  - inserting a file: link destinations are re-pointed at the copies (and a
//    link to a page that did not come along is dropped, not left dangling),
//    named destinations become explicit, each annotation's /P is its new
//    page, structure-tree links are cut, the file's form fields join the
//    document's /AcroForm (a clashing name gets "-1"), and its bookmarks come
//    along under one bookmark named after the file;
//  - removing pages: bookmarks to them lose their destination, links to them
//    and their form fields go;
//  - and objects nothing refers to any more are not written out.

import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObject,
  PDFObjectCopier, PDFPage, PDFRef, PDFStream, PDFString,
} from '@cantoo/pdf-lib'

const N = (s: string) => PDFName.of(s)

function textOf(o: PDFObject | undefined): string {
  return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : ''
}

function dictAt(doc: PDFDocument, o: PDFObject | undefined): PDFDict | undefined {
  const v = o instanceof PDFRef ? doc.context.lookup(o) : o
  return v instanceof PDFDict ? v : undefined
}

function arrayAt(doc: PDFDocument, o: PDFObject | undefined): PDFArray | undefined {
  const v = o instanceof PDFRef ? doc.context.lookup(o) : o
  return v instanceof PDFArray ? v : undefined
}

// ── Destinations ────────────────────────────────────────────────────────────

/** A destination pointing into this document: the page, and how to show it (/XYZ …). */
export interface PageDest { page: PDFRef; rest: PDFObject[] }

function lookupNameTree(doc: PDFDocument, node: PDFDict | undefined, key: string, depth = 0): PDFObject | undefined {
  if (!node || depth > 32) return undefined
  const names = arrayAt(doc, node.get(N('Names')))
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) if (textOf(names.get(i)) === key) return names.get(i + 1)
  }
  const kids = arrayAt(doc, node.get(N('Kids')))
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const hit = lookupNameTree(doc, dictAt(doc, kids.get(i)), key, depth + 1)
      if (hit) return hit
    }
  }
  return undefined
}

/** An explicit, named (/Dests or the /Names tree) or GoTo destination, resolved. */
export function resolveDest(doc: PDFDocument, dest: PDFObject | undefined): PageDest | null {
  let d: PDFObject | undefined = dest instanceof PDFRef ? doc.context.lookup(dest) : dest
  if (d instanceof PDFName || d instanceof PDFString || d instanceof PDFHexString) {
    const key = textOf(d)
    const old = dictAt(doc, doc.catalog.get(N('Dests')))
    const names = dictAt(doc, dictAt(doc, doc.catalog.get(N('Names')))?.get(N('Dests')))
    d = old?.get(N(key)) ?? lookupNameTree(doc, names, key)
    if (d instanceof PDFRef) d = doc.context.lookup(d)
  }
  if (d instanceof PDFDict) d = d.get(N('D'))
  const arr = arrayAt(doc, d)
  if (!arr || arr.size() === 0) return null
  const page = arr.get(0)
  if (!(page instanceof PDFRef)) return null
  return { page, rest: arr.asArray().slice(1) }
}

/** An outline item's or link's destination: /Dest, or a GoTo action's /D. */
function destOf(doc: PDFDocument, item: PDFDict): PDFObject | undefined {
  const dest = item.get(N('Dest'))
  if (dest) return dest
  const action = dictAt(doc, item.get(N('A')))
  if (action && action.get(N('S')) === N('GoTo')) return action.get(N('D'))
  return undefined
}

function annotsOf(doc: PDFDocument, page: PDFPage): { list: PDFArray; dicts: (PDFDict | undefined)[] } | null {
  const list = arrayAt(doc, page.node.get(N('Annots')))
  if (!list) return null
  return { list, dicts: list.asArray().map(o => dictAt(doc, o)) }
}

// ── Inserting pages from another file ──────────────────────────────────────

/**
 * Get a source document ready to have its pages copied: everything that
 * points from a page's annotations back into the source (/P, link
 * destinations, structure links) is cut or replaced by a page *index*, so
 * pdf-lib's copier does not drag source pages along as unreachable copies.
 */
function prepareSource(src: PDFDocument): void {
  const pages = src.getPages()
  const index = new Map(pages.map((p, i) => [p.ref.toString(), i]))
  for (const page of pages) {
    page.node.delete(N('StructParents'))
    page.node.delete(N('B'))
    const annots = annotsOf(src, page)
    if (!annots) continue
    for (const a of annots.dicts) {
      if (!a) continue
      a.delete(N('P'))
      a.delete(N('StructParent'))
      if (a.get(N('Subtype')) !== N('Link')) continue
      const raw = destOf(src, a)
      if (raw === undefined) continue // URI, launch, GoToR: not into this file
      const dest = resolveDest(src, raw)
      const i = dest ? index.get(dest.page.toString()) : undefined
      a.delete(N('A'))
      a.set(N('Dest'), src.context.obj([i ?? -1, ...(dest?.rest ?? [])]))
    }
  }
  // (/P is cut on every page's annotations, not only links: widgets reach
  // their fields through /Parent, and a field's other widgets would otherwise
  // bring their pages along.)
}

/** Fix the copied pages' annotations: /P, and link destinations given as page indexes. */
function relinkCopied(dest: PDFDocument, copied: PDFPage[], target: (i: number) => PDFRef | undefined): void {
  for (const page of copied) {
    const annots = annotsOf(dest, page)
    if (!annots) continue
    for (let i = annots.dicts.length - 1; i >= 0; i--) {
      const a = annots.dicts[i]
      if (!a) continue
      a.set(N('P'), page.ref)
      if (a.get(N('Subtype')) !== N('Link')) continue
      const d = arrayAt(dest, a.get(N('Dest')))
      const first = d?.get(0)
      if (!(first instanceof PDFNumber)) continue
      const ref = target(first.asNumber())
      if (ref) d!.set(0, ref)
      else annots.list.remove(i) // into a page that did not come along
    }
  }
}

function fullName(doc: PDFDocument, field: PDFDict): string {
  const parts: string[] = []
  let f: PDFDict | undefined = field
  for (let depth = 0; f && depth < 32; depth++) {
    const t = textOf(f.get(N('T')))
    if (t) parts.unshift(t)
    f = dictAt(doc, f.get(N('Parent')))
  }
  return parts.join('.')
}

/**
 * Register the copied pages' form fields in the document's /AcroForm, so they
 * are fields and not just drawings of them. A top-level name the document
 * already uses gets "-1", "-2"…: two fields with one name are one field.
 * The fonts their appearances name (/DR) come along.
 */
function registerFields(dest: PDFDocument, src: PDFDocument, copied: PDFPage[]): string[] {
  const tops = new Map<string, PDFRef>()
  for (const page of copied) {
    for (const ref of annotsOf(dest, page)?.list.asArray() ?? []) {
      if (!(ref instanceof PDFRef)) continue
      let node = dest.context.lookup(ref)
      let nodeRef: PDFRef = ref
      if (!(node instanceof PDFDict) || node.get(N('Subtype')) !== N('Widget')) continue
      for (let depth = 0; depth < 32; depth++) {
        const parent = (node as PDFDict).get(N('Parent'))
        if (!(parent instanceof PDFRef)) break
        nodeRef = parent
        node = dest.context.lookup(parent)
      }
      if (node instanceof PDFDict && (node.has(N('FT')) || node.has(N('T')) || node.has(N('Kids')))) tops.set(nodeRef.toString(), nodeRef)
    }
  }
  if (tops.size === 0) return []

  const acroForm = dest.catalog.getOrCreateAcroForm().dict
  let fields = arrayAt(dest, acroForm.get(N('Fields')))
  if (!fields) { fields = dest.context.obj([]); acroForm.set(N('Fields'), fields) }
  const taken = new Set<string>()
  for (const f of fields.asArray()) { const d = dictAt(dest, f); if (d) taken.add(fullName(dest, d)) }
  const renamed: string[] = []
  for (const ref of tops.values()) {
    const field = dest.context.lookup(ref, PDFDict)
    let name = textOf(field.get(N('T')))
    if (name && taken.has(name)) {
      let k = 1
      while (taken.has(`${name}-${k}`)) k++
      renamed.push(`${name} → ${name}-${k}`)
      name = `${name}-${k}`
      field.set(N('T'), PDFHexString.fromText(name))
    }
    taken.add(name)
    fields.push(ref)
  }

  // Default appearance and fonts the copied fields draw with.
  const srcForm = dictAt(src, src.catalog.get(N('AcroForm')))
  if (srcForm) {
    const copier = PDFObjectCopier.for(src.context, dest.context)
    if (!acroForm.has(N('DA')) && srcForm.has(N('DA'))) acroForm.set(N('DA'), copier.copy(srcForm.get(N('DA'))!))
    const srcFonts = dictAt(src, dictAt(src, srcForm.get(N('DR')))?.get(N('Font')))
    if (srcFonts) {
      let dr = dictAt(dest, acroForm.get(N('DR')))
      if (!dr) { dr = dest.context.obj({}); acroForm.set(N('DR'), dr) }
      let fonts = dictAt(dest, dr.get(N('Font')))
      if (!fonts) { fonts = dest.context.obj({}); dr.set(N('Font'), fonts) }
      for (const [key, value] of srcFonts.entries()) if (!fonts.has(key)) fonts.set(key, copier.copy(value))
    }
    if (srcForm.get(N('NeedAppearances'))?.toString() === 'true') acroForm.set(N('NeedAppearances'), dest.context.obj(true))
  }
  return renamed
}

// ── Bookmarks ───────────────────────────────────────────────────────────────

interface Mark { title: string; dest: PageDest | null; children: Mark[] }

function readOutline(doc: PDFDocument): Mark[] {
  const root = dictAt(doc, doc.catalog.get(N('Outlines')))
  const seen = new Set<string>()
  const walk = (first: PDFObject | undefined, depth: number): Mark[] => {
    const out: Mark[] = []
    let ref = first
    while (ref instanceof PDFRef && !seen.has(ref.toString()) && depth < 32) {
      seen.add(ref.toString())
      const item = doc.context.lookup(ref)
      if (!(item instanceof PDFDict)) break
      out.push({ title: textOf(item.get(N('Title'))), dest: resolveDest(doc, destOf(doc, item)), children: walk(item.get(N('First')), depth + 1) })
      ref = item.get(N('Next'))
    }
    return out
  }
  return root ? walk(root.get(N('First')), 0) : []
}

/** Write bookmarks as a chain under `parent`; returns the first and last item and how many items. */
function writeMarks(doc: PDFDocument, marks: Mark[], parent: PDFRef, target: (d: PageDest) => PDFRef | undefined): { first: PDFRef; last: PDFRef; count: number } | null {
  if (marks.length === 0) return null
  const refs = marks.map(() => doc.context.nextRef())
  let count = 0
  marks.forEach((m, i) => {
    const dict = doc.context.obj({}) as PDFDict
    dict.set(N('Title'), PDFHexString.fromText(m.title))
    dict.set(N('Parent'), parent)
    if (i > 0) dict.set(N('Prev'), refs[i - 1])
    if (i < refs.length - 1) dict.set(N('Next'), refs[i + 1])
    const page = m.dest ? target(m.dest) : undefined
    if (page) dict.set(N('Dest'), doc.context.obj([page, ...m.dest!.rest]))
    const kids = writeMarks(doc, m.children, refs[i], target)
    if (kids) {
      dict.set(N('First'), kids.first)
      dict.set(N('Last'), kids.last)
      dict.set(N('Count'), PDFNumber.of(-kids.count)) // closed
    }
    doc.context.assign(refs[i], dict)
    count++
  })
  return { first: refs[0], last: refs[refs.length - 1], count }
}

/**
 * The inserted file's bookmarks, under one bookmark named after it at its
 * first page, among the document's top-level bookmarks where the pages went:
 * before the first one that points at a page from there on.
 */
function addFileBookmark(dest: PDFDocument, title: string, marks: Mark[], target: (d: PageDest) => PDFRef | undefined, firstPage: PDFRef, at: number): void {
  if (marks.length === 0) return
  let root = dictAt(dest, dest.catalog.get(N('Outlines')))
  if (!root) {
    root = dest.context.obj({ Type: 'Outlines' }) as PDFDict
    dest.catalog.set(N('Outlines'), dest.context.register(root))
  }
  const rootRef = dest.catalog.get(N('Outlines')) as PDFRef
  const markRef = dest.context.nextRef()
  const item = dest.context.obj({}) as PDFDict
  item.set(N('Title'), PDFHexString.fromText(title))
  item.set(N('Parent'), rootRef)
  item.set(N('Dest'), dest.context.obj([firstPage, N('Fit')]))
  const kids = writeMarks(dest, marks, markRef, target)
  if (kids) {
    item.set(N('First'), kids.first)
    item.set(N('Last'), kids.last)
    item.set(N('Count'), PDFNumber.of(-kids.count))
  }
  dest.context.assign(markRef, item)

  // Where it goes among the top level.
  const pageIndex = new Map(dest.getPages().map((p, i) => [p.ref.toString(), i]))
  let before: PDFRef | undefined
  let prev: PDFRef | undefined
  for (let ref = root.get(N('First')), guard = 0; ref instanceof PDFRef && guard < 100000; guard++) {
    const top = dest.context.lookup(ref)
    if (!(top instanceof PDFDict)) break
    const d = resolveDest(dest, destOf(dest, top))
    const i = d ? pageIndex.get(d.page.toString()) : undefined
    if (i !== undefined && i >= at) { before = ref; break }
    prev = ref
    ref = top.get(N('Next'))
  }
  if (prev) { item.set(N('Prev'), prev); dest.context.lookup(prev, PDFDict).set(N('Next'), markRef) }
  else root.set(N('First'), markRef)
  if (before) { item.set(N('Next'), before); dest.context.lookup(before, PDFDict).set(N('Prev'), markRef) }
  else root.set(N('Last'), markRef)
  const count = root.get(N('Count'))
  root.set(N('Count'), PDFNumber.of((count instanceof PDFNumber ? Math.abs(count.asNumber()) : 0) + 1))
}

/**
 * Insert all of `src`'s pages into `dest` at `at` (0-based), keeping its links,
 * fields and bookmarks working. Returns the field names that had to change.
 */
export async function insertDocument(dest: PDFDocument, src: PDFDocument, at: number, title: string): Promise<{ renamed: string[] }> {
  const marks = readOutline(src)
  const srcIndex = new Map(src.getPages().map((p, i) => [p.ref.toString(), i]))
  prepareSource(src)
  const copied = await dest.copyPages(src, src.getPageIndices())
  copied.forEach((p, i) => dest.insertPage(at + i, p))
  const byIndex = (i: number) => copied[i]?.ref
  relinkCopied(dest, copied, byIndex)
  const renamed = registerFields(dest, src, copied)
  if (copied.length > 0) {
    addFileBookmark(dest, title, marks, d => { const i = srcIndex.get(d.page.toString()); return i === undefined ? undefined : byIndex(i) }, copied[0].ref, at)
  }
  return { renamed }
}

// ── Removing pages ──────────────────────────────────────────────────────────

/**
 * After pages left the page tree: bookmarks to them lose their destination,
 * links to them are removed, named destinations to them are forgotten, and
 * form fields whose widgets were all on them leave the form.
 */
export function pruneRemovedPages(doc: PDFDocument): void {
  const pages = doc.getPages()
  const alive = new Set(pages.map(p => p.ref.toString()))
  const points = (o: PDFObject | undefined) => { const d = resolveDest(doc, o); return !d || alive.has(d.page.toString()) }

  // Bookmarks.
  const root = dictAt(doc, doc.catalog.get(N('Outlines')))
  const seen = new Set<string>()
  const walk = (ref: PDFObject | undefined, depth: number) => {
    while (ref instanceof PDFRef && !seen.has(ref.toString()) && depth < 32) {
      seen.add(ref.toString())
      const item = doc.context.lookup(ref)
      if (!(item instanceof PDFDict)) return
      if (!points(destOf(doc, item))) { item.delete(N('Dest')); item.delete(N('A')) }
      walk(item.get(N('First')), depth + 1)
      ref = item.get(N('Next'))
    }
  }
  if (root) walk(root.get(N('First')), 0)

  // Links on the pages that stay.
  for (const page of pages) {
    const annots = annotsOf(doc, page)
    if (!annots) continue
    for (let i = annots.dicts.length - 1; i >= 0; i--) {
      const a = annots.dicts[i]
      if (a?.get(N('Subtype')) === N('Link') && !points(destOf(doc, a))) annots.list.remove(i)
    }
  }

  // Named destinations.
  const old = dictAt(doc, doc.catalog.get(N('Dests')))
  if (old) for (const [key, value] of old.entries()) if (!points(value)) old.delete(key)
  const pruneTree = (node: PDFDict | undefined, depth: number) => {
    if (!node || depth > 32) return
    const names = arrayAt(doc, node.get(N('Names')))
    if (names) for (let i = names.size() - 2; i >= 0; i -= 2) if (!points(names.get(i + 1))) { names.remove(i + 1); names.remove(i) }
    for (const kid of arrayAt(doc, node.get(N('Kids')))?.asArray() ?? []) pruneTree(dictAt(doc, kid), depth + 1)
  }
  pruneTree(dictAt(doc, dictAt(doc, doc.catalog.get(N('Names')))?.get(N('Dests'))), 0)

  // Form fields: keep the parts with a widget on a page that stays.
  const form = dictAt(doc, doc.catalog.get(N('AcroForm')))
  const fields = arrayAt(doc, form?.get(N('Fields')))
  if (!fields) return
  const widgets = new Set<string>()
  for (const page of pages) for (const r of annotsOf(doc, page)?.list.asArray() ?? []) if (r instanceof PDFRef) widgets.add(r.toString())
  const keep = (ref: PDFObject, depth: number): boolean => {
    const node = dictAt(doc, ref)
    if (!node || depth > 32) return false
    const kids = arrayAt(doc, node.get(N('Kids')))
    if (!kids) return ref instanceof PDFRef && (widgets.has(ref.toString()) || node.get(N('Subtype')) !== N('Widget'))
    for (let i = kids.size() - 1; i >= 0; i--) if (!keep(kids.get(i), depth + 1)) kids.remove(i)
    return kids.size() > 0
  }
  for (let i = fields.size() - 1; i >= 0; i--) if (!keep(fields.get(i), 0)) fields.remove(i)
}

// ── Page order ──────────────────────────────────────────────────────────────

const INHERITED = ['Resources', 'MediaBox', 'CropBox', 'Rotate']

/**
 * Put the pages in this order, as one flat list under the root of the page
 * tree. What a page inherits from the nodes above it (resources, boxes,
 * rotation) is written onto the page first, since those nodes leave the tree.
 * The document's own page list (getPages) is stale afterwards; save it.
 */
export function setPageOrder(doc: PDFDocument, pages: PDFPage[]): void {
  for (const p of pages) {
    for (const key of INHERITED) {
      if (p.node.has(N(key))) continue
      const v = p.node.getInheritableAttribute(N(key))
      if (v) p.node.set(N(key), v)
    }
  }
  const rootRef = doc.catalog.get(N('Pages'))
  const root = doc.catalog.Pages()
  root.set(N('Kids'), doc.context.obj(pages.map(p => p.ref)))
  root.set(N('Count'), PDFNumber.of(pages.length))
  if (rootRef instanceof PDFRef) for (const p of pages) p.node.set(N('Parent'), rootRef)
}

// ── Garbage ─────────────────────────────────────────────────────────────────

/**
 * Forget the objects nothing reaches from the trailer — the pages just
 * removed, what only they used — so they are not written out. pdf-lib writes
 * every object it holds; without this a deleted page stayed in the file.
 */
export function collectGarbage(doc: PDFDocument): number {
  const { context } = doc
  const reached = new Set<string>()
  const stack: PDFObject[] = []
  const t = context.trailerInfo
  for (const o of [t.Root, t.Info, t.Encrypt, t.ID]) if (o) stack.push(o as PDFObject)
  while (stack.length) {
    const o = stack.pop()!
    if (o instanceof PDFRef) {
      const key = o.toString()
      if (reached.has(key)) continue
      reached.add(key)
      const v = context.lookup(o)
      if (v) stack.push(v)
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v)
    } else if (o instanceof PDFArray) {
      for (const v of o.asArray()) stack.push(v)
    } else if (o instanceof PDFStream) {
      stack.push(o.dict)
    }
  }
  let dropped = 0
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) { context.delete(ref); dropped++ }
  }
  return dropped
}

