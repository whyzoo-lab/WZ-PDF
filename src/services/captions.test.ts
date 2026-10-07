import { describe, expect, it } from 'vitest'
import { toSrt, toVtt, wrapCaption } from './captions'
import { FRAME_GRID, frameTimes, planSlide, TIMING } from './slideTimeline'

describe('caption files', () => {
  const cues = [
    { start: 0.6, end: 3.25, text: '안녕하세요.\n김태선 입니다' },
    { start: 3661.5, end: 3663, text: 'A < B & C' },
  ]

  it('writes SubRip with comma milliseconds, numbered, one line per cue', () => {
    expect(toSrt(cues)).toBe(
      '1\n00:00:00,600 --> 00:00:03,250\n안녕하세요. 김태선 입니다\n\n'
      + '2\n01:01:01,500 --> 01:01:03,000\nA < B & C\n',
    )
  })

  it('writes WebVTT with dot milliseconds and its markup characters escaped', () => {
    expect(toVtt(cues)).toBe(
      'WEBVTT\n\n'
      + '00:00:00.600 --> 00:00:03.250\n안녕하세요. 김태선 입니다\n\n'
      + '01:01:01.500 --> 01:01:03.000\nA &lt; B &amp; C\n',
    )
  })
})

describe('wrapCaption', () => {
  const measure = (s: string) => [...s].length // one unit per character

  it('breaks at spaces', () => {
    expect(wrapCaption('one two three four', 9, measure)).toEqual(['one two', 'three', 'four'])
  })

  it('breaks a word wider than the line between characters', () => {
    expect(wrapCaption('가나다라마바사아자차 끝', 4, measure)).toEqual(['가나다라', '마바사아', '자차 끝'])
  })
})

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
