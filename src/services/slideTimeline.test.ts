import { describe, expect, it } from 'vitest'
import { FRAME_GRID, frameTimes, pcmPieces, planSlide, TIMING } from './slideTimeline'

describe('planSlide', () => {
  it('fades in, speaks with pauses, holds after the last word', () => {
    const slide = planSlide(10, [{ text: 'a', duration: 2 }, { text: 'b', duration: 1 }])
    expect(slide.sentenceStarts).toEqual([10 + TIMING.leadIn, 10 + TIMING.leadIn + 2 + TIMING.gap])
    expect(slide.end).toBeCloseTo(10 + TIMING.leadIn + 2 + TIMING.gap + 1 + TIMING.tail)
    // A caption lasts until the next replaces it.
    expect(slide.cues[0].end).toBe(slide.cues[1].start)
    expect(slide.cues[1].end).toBeLessThanOrEqual(slide.end)
  })

  it('holds a slide without notes', () => {
    expect(planSlide(5, [])).toEqual({ start: 5, end: 5 + TIMING.silentHold, sentenceStarts: [], cues: [] })
  })
})

describe('pcmPieces', () => {
  it('cuts the voice into standalone copies, in order, with nothing lost', () => {
    const pcm = Float32Array.from({ length: 10 }, (_, i) => i)
    const pieces = pcmPieces(pcm, 4)
    expect(pieces.map(p => [...p])).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]])
    // What the encoder actually reads is the whole buffer from its start: each
    // piece's buffer must be exactly that piece. With subarray views every
    // piece read back as [0, 1, 2, 3] — the first second, repeated.
    for (const p of pieces) {
      expect(p.byteOffset).toBe(0)
      expect([...new Float32Array(p.buffer)]).toEqual([...p])
    }
  })
})

describe('frameTimes', () => {
  it('has the fade, every caption change and a heartbeat — and nothing past the slide', () => {
    const slide = planSlide(0, [{ text: 'a', duration: 2.5 }])
    const times = frameTimes(slide, { fade: true, fps: 10, heartbeat: 1 })
    expect(times[0]).toBe(0)
    for (let k = 1; k <= TIMING.fade * 10; k++) expect(times).toContain(Math.round(k / 10 * 1000) / 1000)
    expect(times).toContain(slide.cues[0].start)
    expect(times).toContain(1)
    expect(times.every(t => t < slide.end)).toBe(true)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })

  it('puts every frame on the video clock, and never gives two slides the same moment', () => {
    // Odd lengths, so ends fall between ticks.
    let start = 0
    const all: number[] = []
    for (const d of [1.237, 2.0101, 0.6667, 3.3333]) {
      const slide = planSlide(start, [{ text: 'x', duration: d }])
      all.push(...frameTimes(slide, { fade: start > 0 }))
      start = slide.end
    }
    for (const t of all) expect(Math.abs(t * FRAME_GRID - Math.round(t * FRAME_GRID))).toBeLessThan(1e-9)
    for (let i = 1; i < all.length; i++) expect(all[i]).toBeGreaterThan(all[i - 1])
  })

  it('skips the fade for the first slide', () => {
    const times = frameTimes(planSlide(0, []), { fade: false, fps: 10, heartbeat: 1 })
    expect(times).toEqual([0, 1, 2])
  })
})
