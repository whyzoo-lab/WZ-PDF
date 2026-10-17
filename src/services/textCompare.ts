// Compare two documents' text, word by word. A port of PdfCraft's
// `crates/compare` (Apache-2.0/MIT): the common prefix and suffix are set
// aside, long stretches are split at "patience" anchors (words that occur
// once on each side, in an order both agree on), and the rest is diffed with
// Myers' O((N+M)·D) algorithm. The edit script is grouped into changes —
// inserted, deleted or replaced runs of words — each with the rectangles to
// mark on its pages.

/** A word of one document, with its page (1-based) and box in viewport points. */
export interface Word {
  text: string
  page: number
  /** x, y, width, height — absent for a format without page geometry. */
  rect?: { x: number; y: number; width: number; height: number }
}

export type ChangeKind = 'inserted' | 'deleted' | 'replaced'

/** One side of a change: its words, its page, and the lines to mark. */
export interface ChangeSide {
  text: string
  page: number
  rects: { x: number; y: number; width: number; height: number }[]
  /** For an empty side: the box of the word next to where the other side's words were. */
  near?: { x: number; y: number; width: number; height: number }
}

export interface Change { kind: ChangeKind; old: ChangeSide; new: ChangeSide }

export interface Comparison {
  changes: Change[]
  oldWords: number
  newWords: number
}

// The edit script's steps (plain numbers: enums are not erasable syntax here).
const Op = { Equal: 0, Delete: 1, Insert: 2 } as const
type Op = typeof Op[keyof typeof Op]

/** Segments longer than this (old + new words) are split at anchors first, so Myers' saved frontiers stay small. */
const DIRECT = 3000

function diff(a: Int32Array, b: Int32Array, out: Op[], depth: number): void {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  for (let i = 0; i < prefix; i++) out.push(Op.Equal)
  const ma = a.subarray(prefix, a.length - suffix)
  const mb = b.subarray(prefix, b.length - suffix)
  if (ma.length + mb.length <= DIRECT) {
    for (const op of myers(ma, mb)) out.push(op)
  } else {
    const pairs = depth > 8 ? [] : anchors(ma, mb)
    if (pairs.length === 0) {
      // A long stretch with nothing in common: one replacement.
      for (let i = 0; i < ma.length; i++) out.push(Op.Delete)
      for (let j = 0; j < mb.length; j++) out.push(Op.Insert)
    } else {
      let i = 0, j = 0
      for (const [x, y] of pairs) {
        diff(ma.subarray(i, x), mb.subarray(j, y), out, depth + 1)
        out.push(Op.Equal)
        i = x + 1
        j = y + 1
      }
      diff(ma.subarray(i), mb.subarray(j), out, depth + 1)
    }
  }
  for (let i = 0; i < suffix; i++) out.push(Op.Equal)
}

/** Words that occur once on each side, in an order both sides agree on (longest increasing subsequence). */
function anchors(a: Int32Array, b: Int32Array): [number, number][] {
  const count = new Map<number, [number, number, number, number]>()
  a.forEach((h, i) => { const e = count.get(h) ?? [0, 0, 0, 0]; e[0]++; e[2] = i; count.set(h, e) })
  b.forEach((h, j) => { const e = count.get(h); if (e) { e[1]++; e[3] = j } })
  const pairs: [number, number][] = []
  for (const e of count.values()) if (e[0] === 1 && e[1] === 1) pairs.push([e[2], e[3]])
  pairs.sort((p, q) => p[0] - q[0])
  const tails: number[] = []
  const prev = new Array<number>(pairs.length).fill(-1)
  pairs.forEach(([, y], k) => {
    let lo = 0, hi = tails.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < y) lo = mid + 1; else hi = mid }
    if (lo > 0) prev[k] = tails[lo - 1]
    tails[lo] = k
  })
  const out: [number, number][] = []
  for (let k = tails.length ? tails[tails.length - 1] : -1; k !== -1; k = prev[k]) out.push(pairs[k])
  return out.reverse()
}

/** Myers' diff: the edit script turning `a` into `b`. */
function myers(a: Int32Array, b: Int32Array): Op[] {
  const n = a.length, m = b.length
  if (n === 0 || m === 0) return [...new Array<Op>(n).fill(Op.Delete), ...new Array<Op>(m).fill(Op.Insert)]
  const max = n + m
  const off = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  let found = false
  outer: for (let d = 0; d <= max; d++) {
    // Frontier d only spans diagonals -d..d: save just that slice.
    trace.push(v.slice(Math.max(0, off - d - 1), off + d + 2))
    for (let k = -d; k <= d; k += 2) {
      const i = k + off
      let x = k === -d || (k !== d && v[i - 1] < v[i + 1]) ? v[i + 1] : v[i - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[i] = x
      if (x >= n && y >= m) { found = true; break outer }
    }
  }
  if (!found) return [...new Array<Op>(n).fill(Op.Delete), ...new Array<Op>(m).fill(Op.Insert)]
  const ops: Op[] = []
  let x = n, y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    const t = trace[d]
    const base = Math.max(0, off - d - 1)
    const at = (k: number) => t[k + off - base]
    const k = x - y
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1
    const prevX = at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) { ops.push(Op.Equal); x--; y-- }
    if (d > 0) ops.push(x === prevX ? Op.Insert : Op.Delete)
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

/** Word boxes on the same page and line, merged into one rectangle per line. */
function lineRects(words: Word[]): ChangeSide['rects'] {
  const out: ChangeSide['rects'] = []
  for (const w of words) {
    const r = w.rect
    if (!r) continue
    const last = out[out.length - 1]
    const h = Math.max(r.height, 1)
    if (last && Math.abs(last.y - r.y) < h * 0.5 && r.x - (last.x + last.width) < Math.max(h, 4) * 2 && r.x >= last.x - 1) {
      const right = Math.max(last.x + last.width, r.x + r.width)
      const bottom = Math.max(last.y + last.height, r.y + r.height)
      last.x = Math.min(last.x, r.x)
      last.y = Math.min(last.y, r.y)
      last.width = right - last.x
      last.height = bottom - last.y
    } else out.push({ ...r })
  }
  return out
}

function side(words: Word[], neighbour: Word | undefined): ChangeSide {
  return {
    text: words.map(w => w.text).join(' '),
    page: (words[0] ?? neighbour)?.page ?? 1,
    rects: lineRects(words),
    near: words.length === 0 ? neighbour?.rect : undefined,
  }
}

/** Compare two documents' words. Words are compared as written (NFC). */
export function compareWords(oldWords: Word[], newWords: Word[]): Comparison {
  const ids = new Map<string, number>()
  const id = (w: Word) => { const k = w.text.normalize('NFC'); let v = ids.get(k); if (v === undefined) { v = ids.size; ids.set(k, v) } return v }
  const a = Int32Array.from(oldWords, id)
  const b = Int32Array.from(newWords, id)
  const ops: Op[] = []
  diff(a, b, ops, 0)

  const changes: Change[] = []
  let i = 0, j = 0, k = 0
  while (k < ops.length) {
    if (ops[k] === Op.Equal) { i++; j++; k++; continue }
    const del: Word[] = [], ins: Word[] = []
    while (k < ops.length && ops[k] !== Op.Equal) {
      if (ops[k] === Op.Delete) del.push(oldWords[i++])
      else ins.push(newWords[j++])
      k++
    }
    const kind: ChangeKind = del.length && ins.length ? 'replaced' : del.length ? 'deleted' : 'inserted'
    // Where a one-sided change sits in the other document: by the next word.
    changes.push({
      kind,
      old: side(del, oldWords[i] ?? oldWords[oldWords.length - 1]),
      new: side(ins, newWords[j] ?? newWords[newWords.length - 1]),
    })
  }
  return { changes, oldWords: oldWords.length, newWords: newWords.length }
}

/** A plain-text report: a summary, then each change with its pages. */
export function compareReport(c: Comparison, oldName: string, newName: string, labels: {
  title: string; old: string; new: string; summary: string; identical: string; kind: Record<ChangeKind, string>; page: (o: number, n: number) => string
}): string {
  const lines = [labels.title, '', `${labels.old}: ${oldName}`, `${labels.new}: ${newName}`, '', labels.summary, '']
  if (c.changes.length === 0) lines.push(labels.identical)
  c.changes.forEach((ch, n) => {
    lines.push(`${n + 1}. ${labels.kind[ch.kind]} (${labels.page(ch.old.page, ch.new.page)})`)
    if (ch.old.text) lines.push(`   ${labels.old}: ${ch.old.text}`)
    if (ch.new.text) lines.push(`   ${labels.new}: ${ch.new.text}`)
  })
  return lines.join('\n') + '\n'
}
