import { describe, expect, it } from 'vitest'
import { addTx3gTrack } from './tx3g'

// ── A tiny MP4 built by hand: one trak whose single chunk points into the mdat ──

const enc = new TextEncoder()
function u32(v: number) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255] }
function box(type: string, ...parts: (number[] | Uint8Array)[]): Uint8Array {
  const body = parts.flatMap(p => [...p])
  return Uint8Array.from([...u32(8 + body.length), ...enc.encode(type), ...body])
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

const MEDIA = enc.encode('VIDEO-AND-AUDIO-SAMPLES')

function mvhd(nextTrackId: number) {
  // version 0: flags, ctime, mtime, timescale 1000, duration 5000, rate, volume, reserved, matrix, pre_defined, next_track_ID
  return box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(5000), u32(0x10000), [1, 0], new Array(10).fill(0),
    new Array(36).fill(0), new Array(24).fill(0), u32(nextTrackId))
}
function moovWithOffset(offset: number) {
  const stco = box('stco', [0, 0, 0, 0], u32(1), u32(offset))
  return box('moov', mvhd(2), box('trak', box('mdia', box('minf', box('stbl', stco)))))
}

/** ftyp, mdat, moov — the muxer's default layout. */
function moovLast() {
  const ftyp = box('ftyp', enc.encode('isom'), u32(0))
  const mdat = box('mdat', MEDIA)
  return concat(ftyp, mdat, moovWithOffset(ftyp.length + 8))
}
/** ftyp, moov, mdat — "fast start". */
function moovFirst() {
  const ftyp = box('ftyp', enc.encode('isom'), u32(0))
  const probe = moovWithOffset(0)
  const mdatAt = ftyp.length + probe.length
  return concat(ftyp, moovWithOffset(mdatAt + 8), box('mdat', MEDIA))
}

// ── Reading the result back ──────────────────────────────────────────────────

interface B { type: string; start: number; size: number }
function boxes(b: Uint8Array, start: number, end: number): B[] {
  const v = new DataView(b.buffer, b.byteOffset)
  const out: B[] = []
  for (let at = start; at < end;) {
    const size = v.getUint32(at)
    out.push({ type: String.fromCharCode(...b.subarray(at + 4, at + 8)), start: at, size })
    at += size
  }
  return out
}
const inside = (b: Uint8Array, p: B) => boxes(b, p.start + 8, p.start + p.size)
function find(b: Uint8Array, p: B, ...path: string[]): B {
  let cur = p
  for (const type of path) {
    const next = inside(b, cur).find(x => x.type === type)
    if (!next) throw new Error(`no ${type}`)
    cur = next
  }
  return cur
}
const u32At = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at)

const cues = [
  { start: 0.6, end: 2.0, text: '안녕하세요.' },
  { start: 2.0, end: 3.5, text: 'Second line' },
]

describe.each([
  ['moov after the media', moovLast],
  ['moov before the media (fast start)', moovFirst],
])('addTx3gTrack — %s', (_label, make) => {
  const out = addTx3gTrack(make(), { cues, duration: 5, width: 1920, height: 1080, language: 'kor', name: '한국어' })
  const top = boxes(out, 0, out.length)
  const moov = top.find(x => x.type === 'moov')!

  it('puts the moov first, then the media, then the caption data', () => {
    expect(top.map(x => x.type)).toEqual(['ftyp', 'moov', 'mdat', 'mdat'])
  })

  it('keeps the existing track pointing at its own samples', () => {
    const traks = inside(out, moov).filter(x => x.type === 'trak')
    const stco = find(out, traks[0], 'mdia', 'minf', 'stbl', 'stco')
    const offset = u32At(out, stco.start + 16)
    expect(new TextDecoder().decode(out.subarray(offset, offset + MEDIA.length))).toBe('VIDEO-AND-AUDIO-SAMPLES')
  })

  it('adds a tx3g track whose samples are the captions, gaps as empty samples', () => {
    const traks = inside(out, moov).filter(x => x.type === 'trak')
    expect(traks).toHaveLength(2)
    const text = traks[1]
    expect(u32At(out, find(out, text, 'tkhd').start + 20)).toBe(2) // track_ID
    const hdlr = find(out, text, 'mdia', 'hdlr')
    expect(String.fromCharCode(...out.subarray(hdlr.start + 16, hdlr.start + 20))).toBe('sbtl')
    const stbl = find(out, text, 'mdia', 'minf', 'stbl')
    const stsd = find(out, stbl, 'stsd')
    expect(String.fromCharCode(...out.subarray(stsd.start + 20, stsd.start + 24))).toBe('tx3g')

    // Language "kor", packed.
    const mdhd = find(out, text, 'mdia', 'mdhd')
    const lang = (out[mdhd.start + 28] << 8) | out[mdhd.start + 29]
    expect(String.fromCharCode(((lang >> 10) & 31) + 0x60, ((lang >> 5) & 31) + 0x60, (lang & 31) + 0x60)).toBe('kor')

    // Samples: empty 0–600 ms, two captions, empty to the end (5 s).
    const stsz = find(out, stbl, 'stsz')
    const count = u32At(out, stsz.start + 16)
    const sizes = Array.from({ length: count }, (_, i) => u32At(out, stsz.start + 20 + i * 4))
    const stts = find(out, stbl, 'stts')
    const runs = u32At(out, stts.start + 12)
    const durations: number[] = []
    for (let i = 0; i < runs; i++) {
      const n = u32At(out, stts.start + 16 + i * 8)
      for (let k = 0; k < n; k++) durations.push(u32At(out, stts.start + 20 + i * 8))
    }
    expect(durations).toEqual([600, 1400, 1500, 1500])

    let at = u32At(out, find(out, stbl, 'stco').start + 16)
    const texts = sizes.map(size => {
      const len = (out[at] << 8) | out[at + 1]
      const s = new TextDecoder().decode(out.subarray(at + 2, at + 2 + len))
      at += size
      return s
    })
    expect(texts).toEqual(['', '안녕하세요.', 'Second line', ''])
  })

  it('bumps the next track ID', () => {
    const mvhdBox = find(out, moov, 'mvhd')
    expect(u32At(out, mvhdBox.start + mvhdBox.size - 4)).toBe(3)
  })
})
