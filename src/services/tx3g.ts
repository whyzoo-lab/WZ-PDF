import type { Cue } from './captions'

/**
 * Adds a switchable subtitle track to a finished MP4: 3GPP Timed Text
 * (`tx3g`, what FFmpeg calls mov_text) — the subtitle format MP4 players
 * actually offer in their subtitle menu (VLC, PotPlayer, MPC-HC, QuickTime,
 * iOS).
 *
 * Why by hand: the muxer (mediabunny) writes only WebVTT-in-MP4 (`wvtt`), a
 * streaming format desktop players do not list. A tx3g track is small and
 * simple — one sample per caption, a 16-bit length and the UTF-8 text — so it
 * is written here, after the muxer has finished, instead of patching the
 * library (see "Never patch a dependency in place").
 *
 * How: the file is re-laid out as `ftyp, moov (+ the new trak), the original
 * media boxes, a new mdat with the caption text`. Moving the media boxes moves
 * every sample, so each existing chunk offset (stco / co64) is rewritten by
 * the distance its box moved; no media byte is touched. The moov goes first
 * either way ("fast start"), so a web page can begin playing before the whole
 * file has arrived.
 *
 * Note that browsers' <video> ignores in-file subtitle tracks; the sidecar
 * .vtt is for the web, this track is for players.
 */

interface Box {
  type: string
  /** Offset of the box's first byte. */
  start: number
  size: number
  headerSize: number
}

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

function readBoxes(b: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const boxes: Box[] = []
  let at = start
  while (at + 8 <= end) {
    let size = view.getUint32(at)
    const type = ascii(b, at + 4)
    let headerSize = 8
    if (size === 1) {
      size = Number(view.getBigUint64(at + 8))
      headerSize = 16
    } else if (size === 0) {
      size = end - at
    }
    if (size < headerSize || at + size > end) throw new Error(`MP4: box ${type} at ${at} runs past its parent`)
    boxes.push({ type, start: at, size, headerSize })
    at += size
  }
  return boxes
}

// ── Writing ───────────────────────────────────────────────────────────────

class Writer {
  private parts: Uint8Array[] = []
  private length = 0
  bytes(b: Uint8Array | number[]) { const u = b instanceof Uint8Array ? b : Uint8Array.from(b); this.parts.push(u); this.length += u.length; return this }
  u8(v: number) { return this.bytes([v & 0xff]) }
  u16(v: number) { return this.bytes([(v >>> 8) & 0xff, v & 0xff]) }
  i16(v: number) { return this.u16(v & 0xffff) }
  u32(v: number) { return this.bytes([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]) }
  u64(v: number) { return this.u32(Math.floor(v / 2 ** 32)).u32(v >>> 0) }
  str(s: string) { return this.bytes(new TextEncoder().encode(s)) }
  zeros(n: number) { return this.bytes(new Uint8Array(n)) }
  done(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const p of this.parts) { out.set(p, at); at += p.length }
    return out
  }
}

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const size = 8 + children.reduce((n, c) => n + c.length, 0)
  const w = new Writer().u32(size).str(type)
  for (const c of children) w.bytes(c)
  return w.done()
}

function fullBox(type: string, version: number, flags: number, body: Uint8Array): Uint8Array {
  return box(type, new Writer().u8(version).u8(flags >>> 16).u8(flags >>> 8).u8(flags).bytes(body).done())
}

const UNITY_MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]

/** ISO 639-2/T, packed as three 5-bit letters. `und` for anything else. */
function packLanguage(code: string): number {
  const c = /^[a-z]{3}$/.test(code) ? code : 'und'
  return ((c.charCodeAt(0) - 0x60) << 10) | ((c.charCodeAt(1) - 0x60) << 5) | (c.charCodeAt(2) - 0x60)
}

/** The tx3g sample entry, with FFmpeg's mov_text defaults: centred, at the bottom, white. */
function tx3gSampleEntry(): Uint8Array {
  const font = 'Sans-Serif'
  const ftab = box('ftab', new Writer().u16(1).u16(1).u8(font.length).str(font).done())
  return box('tx3g', new Writer()
    .zeros(6).u16(1)               // SampleEntry: reserved, data_reference_index
    .u32(0)                        // displayFlags
    .u8(1).u8(0xff)                // horizontal: centre; vertical: bottom
    .bytes([0, 0, 0, 0])           // background colour (players draw their own)
    .i16(0).i16(0).i16(0).i16(0)   // default text box
    .u16(0).u16(0).u16(1).u8(0).u8(18).bytes([255, 255, 255, 255]) // default style
    .bytes(ftab)
    .done())
}

interface TextSample { duration: number; data: Uint8Array }

/**
 * Captions as a continuous run of samples covering the whole timeline: a gap
 * between captions is an empty sample, which is how tx3g clears the screen.
 * Durations are in milliseconds (the track's timescale).
 */
function textSamples(cues: readonly Cue[], totalMs: number): TextSample[] {
  const samples: TextSample[] = []
  const empty = new Uint8Array(2)
  let t = 0
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    const start = Math.max(t, Math.round(cue.start * 1000))
    const end = Math.min(totalMs, Math.round(cue.end * 1000))
    if (end <= start) continue
    if (start > t) samples.push({ duration: start - t, data: empty })
    const text = new TextEncoder().encode(cue.text.replace(/\s+/g, ' ').trim())
    if (text.length > 0xffff) throw new Error('caption too long for tx3g')
    samples.push({ duration: end - start, data: new Writer().u16(text.length).bytes(text).done() })
    t = end
  }
  if (t < totalMs) samples.push({ duration: totalMs - t, data: empty })
  return samples
}

function textTrak(opts: {
  trackId: number
  movieTimescale: number
  totalMs: number
  width: number
  height: number
  language: string
  name: string
  samples: TextSample[]
  chunkOffset: number
}): Uint8Array {
  const { samples } = opts
  const movieDuration = Math.round(opts.totalMs / 1000 * opts.movieTimescale)

  const tkhd = new Writer()
    .u32(0).u32(0)                  // creation, modification
    .u32(opts.trackId).u32(0)       // track_ID, reserved
    .u32(movieDuration)
    .zeros(8)                       // reserved
    .i16(0)                         // layer
    .i16(2)                         // alternate_group: one group for subtitles, as Apple's players expect
    .i16(0).u16(0)                  // volume (none for text), reserved
  for (const v of UNITY_MATRIX) tkhd.u32(v)
  tkhd.u32(opts.width * 0x10000).u32(opts.height * 0x10000)

  const mdhd = new Writer().u32(0).u32(0).u32(1000).u32(opts.totalMs).u16(packLanguage(opts.language)).u16(0)
  const hdlr = new Writer().u32(0).str('sbtl').zeros(12).str(opts.name).u8(0)

  // Run-length time-to-sample table.
  const runs: { count: number; delta: number }[] = []
  for (const s of samples) {
    const last = runs[runs.length - 1]
    if (last && last.delta === s.duration) last.count++
    else runs.push({ count: 1, delta: s.duration })
  }
  const stts = new Writer().u32(runs.length)
  for (const r of runs) stts.u32(r.count).u32(r.delta)
  const stsz = new Writer().u32(0).u32(samples.length)
  for (const s of samples) stsz.u32(s.data.length)
  const stsc = new Writer().u32(1).u32(1).u32(samples.length).u32(1)
  const chunkOffsetBox = opts.chunkOffset > 0xffffffff
    ? fullBox('co64', 0, 0, new Writer().u32(1).u64(opts.chunkOffset).done())
    : fullBox('stco', 0, 0, new Writer().u32(1).u32(opts.chunkOffset).done())

  return box('trak',
    fullBox('tkhd', 0, 0x000003, tkhd.done()), // enabled, in movie
    box('mdia',
      fullBox('mdhd', 0, 0, mdhd.done()),
      fullBox('hdlr', 0, 0, hdlr.done()),
      box('minf',
        fullBox('nmhd', 0, 0, new Uint8Array(0)),
        box('dinf', fullBox('dref', 0, 0, new Writer().u32(1).bytes(fullBox('url ', 0, 1, new Uint8Array(0))).done())),
        box('stbl',
          fullBox('stsd', 0, 0, new Writer().u32(1).bytes(tx3gSampleEntry()).done()),
          fullBox('stts', 0, 0, stts.done()),
          fullBox('stsc', 0, 0, stsc.done()),
          fullBox('stsz', 0, 0, stsz.done()),
          chunkOffsetBox,
        ),
      ),
    ),
  )
}

// ── Reading what is needed from the existing moov ────────────────────────────

function child(b: Uint8Array, parent: Box, type: string): Box | undefined {
  return readBoxes(b, parent.start + parent.headerSize, parent.start + parent.size).find(x => x.type === type)
}

/** Every stco / co64 under a moov, wherever its traks keep them. */
function chunkOffsetBoxes(b: Uint8Array, moov: Box): Box[] {
  const found: Box[] = []
  const walk = (parent: Box) => {
    for (const c of readBoxes(b, parent.start + parent.headerSize, parent.start + parent.size)) {
      if (c.type === 'stco' || c.type === 'co64') found.push(c)
      else if (c.type === 'trak' || c.type === 'mdia' || c.type === 'minf' || c.type === 'stbl') walk(c)
    }
  }
  walk(moov)
  return found
}

export interface Tx3gOptions {
  cues: readonly Cue[]
  /** Length of the video, seconds; the caption track covers all of it. */
  duration: number
  width: number
  height: number
  /** ISO 639-2/T, e.g. `kor`. */
  language: string
  /** Shown in players' subtitle menus. */
  name: string
}

export function addTx3gTrack(mp4: Uint8Array, opts: Tx3gOptions): Uint8Array {
  const top = readBoxes(mp4, 0, mp4.length)
  const ftyp = top.find(x => x.type === 'ftyp')
  const moov = top.find(x => x.type === 'moov')
  if (!ftyp || !moov) throw new Error('MP4: no ftyp or moov')
  const media = top.filter(x => x !== ftyp && x !== moov)

  const view = new DataView(mp4.buffer, mp4.byteOffset, mp4.byteLength)
  const mvhd = child(mp4, moov, 'mvhd')
  if (!mvhd) throw new Error('MP4: no mvhd')
  const mvhdVersion = mp4[mvhd.start + mvhd.headerSize]
  const movieTimescale = view.getUint32(mvhd.start + mvhd.headerSize + (mvhdVersion === 1 ? 20 : 12))
  const nextTrackIdAt = mvhd.start + mvhd.size - 4
  const trackId = view.getUint32(nextTrackIdAt)

  const totalMs = Math.round(opts.duration * 1000)
  const samples = textSamples(opts.cues, totalMs)
  const textData = new Writer()
  for (const s of samples) textData.bytes(s.data)
  const textPayload = textData.done()
  const trakArgs = {
    trackId, movieTimescale, totalMs, width: opts.width, height: opts.height,
    language: opts.language, name: opts.name, samples,
  }

  // Sizes first — the trak's size does not depend on the offset it carries,
  // as long as it fits in 32 bits, which is checked once the offset is known.
  const trakSize = textTrak({ ...trakArgs, chunkOffset: 0 }).length
  const moovSize = moov.size + trakSize
  const mediaSize = media.reduce((n, x) => n + x.size, 0)
  let at = ftyp.size + moovSize
  const moved = media.map(x => { const to = at; at += x.size; return { ...x, to } })
  const textMdatStart = ftyp.size + moovSize + mediaSize
  const trak = textTrak({ ...trakArgs, chunkOffset: textMdatStart + 8 })
  if (trak.length !== trakSize) throw new Error('MP4: caption offset needs 64 bits')

  // The new moov: the old one with its size grown, the next track ID bumped,
  // every chunk offset moved with its box, and the caption trak appended.
  const newMoov = new Uint8Array(moovSize)
  newMoov.set(mp4.subarray(moov.start, moov.start + moov.size), 0)
  const mv = new DataView(newMoov.buffer)
  if (moov.headerSize === 16) mv.setBigUint64(8, BigInt(moovSize))
  else mv.setUint32(0, moovSize)
  mv.setUint32(nextTrackIdAt - moov.start, trackId + 1)
  const relocate = (offset: number) => {
    const box = moved.find(x => offset >= x.start && offset < x.start + x.size)
    if (!box) throw new Error(`MP4: a chunk offset (${offset}) points outside the media`)
    return offset - box.start + box.to
  }
  for (const co of chunkOffsetBoxes(mp4, moov)) {
    const body = co.start + co.headerSize + 4 // past version/flags
    const count = view.getUint32(body)
    for (let i = 0; i < count; i++) {
      if (co.type === 'stco') {
        const pos = body + 4 + i * 4
        const value = relocate(view.getUint32(pos))
        if (value > 0xffffffff) throw new Error('MP4: a moved chunk offset needs 64 bits')
        mv.setUint32(pos - moov.start, value)
      } else {
        const pos = body + 4 + i * 8
        mv.setBigUint64(pos - moov.start, BigInt(relocate(Number(view.getBigUint64(pos)))))
      }
    }
  }
  newMoov.set(trak, moov.size)

  const out = new Uint8Array(textMdatStart + 8 + textPayload.length)
  out.set(mp4.subarray(ftyp.start, ftyp.start + ftyp.size), 0)
  out.set(newMoov, ftyp.size)
  for (const x of moved) out.set(mp4.subarray(x.start, x.start + x.size), x.to)
  out.set(box('mdat', textPayload), textMdatStart)
  return out
}
