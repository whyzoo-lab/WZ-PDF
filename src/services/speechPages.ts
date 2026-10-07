import { findFlexible } from './domText'
import { normalizeForSpeech } from './ttsText'

/**
 * Which page each spoken sentence comes from — so a presentation can turn the
 * page as it is read.
 *
 * Outside fullscreen the screen follows the reading by *finding* the sentence
 * on screen (useSpeechHighlight) and scrolling to it. A presentation shows one
 * page or slide at a time, and what is being read is often not on screen at all
 * (a deck's speaker notes; the next PDF page, which is not mounted), so there
 * is nothing to find. Instead the text is gathered page by page, and each
 * sentence is matched back to its page once, when reading starts.
 */

/** One page's (or slide's) text, as it is read. */
export interface SpeechUnit {
  /** 1-based page or slide number. */
  page: number
  text: string
}

/**
 * How much of a sentence identifies it. A whole sentence can run across a page
 * break, and then matches neither page; its opening is on the page it starts on,
 * and that is the page to show while it is read.
 */
const PROBE_CHARS = 40

/** The units joined the way the reader reads them: a blank line between pages. */
export function joinSpeechUnits(units: readonly SpeechUnit[]): string {
  return units.map(u => u.text).join('\n\n')
}

/**
 * The page of each chunk planned from `joinSpeechUnits(units)`, in order.
 *
 * A forward scan, like the highlight's: each chunk is looked for from where the
 * last one was found, so a sentence repeated on several pages lands on the
 * right one. A chunk that cannot be placed (normalisation changed its opening,
 * e.g. a word hyphenated across lines) keeps the previous chunk's page rather
 * than jumping somewhere wrong.
 */
export function pagesForChunks(units: readonly SpeechUnit[], chunks: readonly string[]): number[] {
  // Normalised per page exactly as planSpeech normalises the whole: the blank
  // line between pages keeps every page's text unchanged by its neighbours.
  const texts = units.map(u => normalizeForSpeech(u.text))
  let unit = 0
  let offset = 0
  let page = units[0]?.page ?? 1
  return chunks.map(chunk => {
    const probe = chunk.slice(0, PROBE_CHARS)
    for (let i = unit; i < texts.length; i++) {
      const hit = findFlexible(texts[i], probe, i === unit ? offset : 0)
      if (!hit) continue
      unit = i
      offset = hit.end
      page = units[i].page
      break
    }
    return page
  })
}
