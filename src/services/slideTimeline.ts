import type { Cue } from './captions'

/**
 * When everything happens in a narrated slide video. Pure, so the pacing can be
 * tested and tuned without encoding anything.
 *
 * Each slide fades in over the previous one, waits a moment, then its script
 * is spoken sentence by sentence with a short pause between, and it stays up a
 * little after the last word. A slide without notes is held for a few seconds,
 * so a section divider is seen rather than skipped.
 */
export const TIMING = {
  /**
   * Cross-fade from the previous slide. Short on purpose: a blended frame is a
   * whole new picture (~100 KB at 1080p, more than a key frame), and at half
   * a second the fades were two thirds of a talk's file. At 0.3 s and ten
   * frames a second it is two blended frames — a quick dissolve.
   */
  fade: 0.3,
  /** From the slide appearing to its first word; at least the fade. */
  leadIn: 0.6,
  /** Between two sentences. */
  gap: 0.35,
  /** After the last word, before the next slide. */
  tail: 1.0,
  /** A slide with nothing to say. */
  silentHold: 3,
} as const

export interface SpokenSentence {
  text: string
  /** Length of its audio, seconds. */
  duration: number
}

export interface PlannedSlide {
  start: number
  end: number
  /** When each sentence begins, in order. */
  sentenceStarts: number[]
  cues: Cue[]
}

/**
 * Place one slide starting at `start`. Slides are planned one at a time,
 * because the video is built one at a time — the next slide's audio does not
 * exist yet when this one is encoded.
 */
export function planSlide(start: number, sentences: readonly SpokenSentence[]): PlannedSlide {
  if (sentences.length === 0) {
    return { start, end: start + TIMING.silentHold, sentenceStarts: [], cues: [] }
  }
  const sentenceStarts: number[] = []
  let t = start + TIMING.leadIn
  for (const [i, s] of sentences.entries()) {
    sentenceStarts.push(t)
    t += s.duration + (i < sentences.length - 1 ? TIMING.gap : 0)
  }
  const end = t + TIMING.tail
  // A caption stays up until the next one replaces it — a blank flicker in the
  // pause between two sentences reads as a glitch — and the last one until the
  // slide is about to change.
  const cues = sentences.map((s, i): Cue => ({
    start: sentenceStarts[i],
    end: i < sentences.length - 1 ? sentenceStarts[i + 1] : Math.min(end, sentenceStarts[i] + s.duration + TIMING.tail / 2),
    text: s.text,
  }))
  return { start, end, sentenceStarts, cues }
}

/**
 * The video track's clock: frame times are kept on a 1/30 s grid. The muxer
 * stores them at that rate, and two moments closer than a tick (a caption
 * change right after a fade frame) landed on the same timestamp — FFmpeg warns
 * "non monotonically increasing dts" on such a file.
 */
export const FRAME_GRID = 30

/** `t` on the frame grid. */
export function snapToFrame(t: number): number {
  return Math.round(t * FRAME_GRID) / FRAME_GRID
}

/**
 * The moments a frame is needed within a slide: every frame of the fade, each
 * caption change, and a steady heartbeat so a player can seek and the encoder
 * has key frames to place. Between them the picture does not change, so the
 * video is variable-frame-rate — a five-minute talk is a few hundred frames,
 * not nine thousand.
 */
export function frameTimes(slide: PlannedSlide, opts: { fade: boolean; fps?: number; heartbeat?: number }): number[] {
  // Ten frames a second is smooth enough for a short cross-fade, and each fade
  // frame is a whole new picture to encode — at 30 the fades were most of a
  // talk's file size (a repeated frame costs a few hundred bytes, a fade frame
  // tens of kilobytes).
  const fps = opts.fps ?? 10
  const heartbeat = opts.heartbeat ?? 1
  // Snapped to the grid, and kept before the slide's snapped end: the next
  // slide starts exactly there, so the two can never share a frame time.
  const start = snapToFrame(slide.start)
  const end = snapToFrame(slide.end)
  const times = new Set<number>()
  const at = (t: number) => { const q = snapToFrame(t); if (q >= start && q < end) times.add(q) }
  at(slide.start)
  if (opts.fade) for (let k = 1; k <= Math.ceil(TIMING.fade * fps); k++) at(slide.start + k / fps)
  for (const cue of slide.cues) { at(cue.start); at(cue.end) }
  for (let t = slide.start + heartbeat; t < slide.end; t += heartbeat) at(t)
  return [...times].sort((a, b) => a - b)
}
