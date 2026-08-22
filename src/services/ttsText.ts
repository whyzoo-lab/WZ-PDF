/**
 * Turning a document into things worth speaking.
 *
 * Reading aloud is done a sentence at a time, not a page at a time, for three
 * reasons that all point the same way: the first sentence can start playing
 * while the rest is still being synthesized, stopping is instant, and the
 * reader can be shown where they are. So the quality of this split is what the
 * whole feature feels like.
 *
 * Pure and unit-tested — no engine, no DOM.
 */

/**
 * Longest chunk handed to the engine.
 *
 * The engine chunks Korean and Japanese at 120 characters internally and joins
 * the pieces with a fixed pause. Staying under that keeps the decision here,
 * where we know where the sentence boundaries actually are, instead of letting
 * it fall mid-clause.
 */
export const MAX_CHUNK_CHARS = 110

/** Sentence-final punctuation, including the full-width forms Korean text uses. */
const TERMINATORS = new Set(['.', '!', '?', '…', '。', '！', '？'])

/** Closing marks that belong to the sentence that just ended, not the next one. */
const TRAILERS = new Set(['"', "'", ')', ']', '}', '»', '”', '’', '』', '」', '〉', '》'])

/** Where a too-long chunk may be cut, best first. */
const SOFT_BREAKS = [',', '，', ';', '；', ':', '：', '·', '—', '–', ' ']

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9'

/**
 * Is the terminator at `i` a real end of sentence?
 *
 * The cases that matter in real documents, all of which a naive split on `.`
 * gets wrong — and gets wrong audibly, because the engine then reads a fragment
 * with falling intonation and pauses in the middle of a number:
 *   1.5      a decimal
 *   2026.08. a Korean-style date
 *   www.foo  a domain
 */
function isSentenceEnd(text: string, i: number): boolean {
  const ch = text[i]
  if (ch === '.' && isDigit(text[i - 1]) && isDigit(text[i + 1])) return false
  if (ch === '.' && /[A-Za-z]/.test(text[i + 1] ?? '') && /[A-Za-z]/.test(text[i - 1] ?? '')) {
    // Only treat `a.b` as a domain-ish run when no space follows; "End.Next"
    // without a space is far more likely a URL than two sentences.
    return false
  }
  return true
}

/**
 * Break one over-long piece into speakable chunks.
 *
 * Prefers a comma, then any space, and only cuts mid-word when a single run of
 * characters genuinely exceeds the limit — which for Korean, written without
 * spaces between many phrases, does happen.
 */
function hardWrap(piece: string, maxChars: number): string[] {
  const out: string[] = []
  let rest = piece

  while (rest.length > maxChars) {
    let cut = -1
    for (const mark of SOFT_BREAKS) {
      // Accept a break anywhere past the first quarter. Being stricter sounds
      // tidier but is worse: a sentence whose only comma sits early then gets
      // cut mid-word instead, which is audible, while a slightly short chunk is
      // not — a comma is a natural pause anyway.
      const at = rest.lastIndexOf(mark, maxChars)
      if (at > maxChars / 4) { cut = at + (mark === ' ' ? 0 : 1); break }
    }
    if (cut <= 0) cut = maxChars
    const head = rest.slice(0, cut).trim()
    if (head) out.push(head)
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Split document text into chunks to speak, in order.
 *
 * Blank lines and line breaks are treated as boundaries: a heading, a table
 * cell and a list item are separate utterances even without punctuation, and
 * running them together is one of the most obviously wrong-sounding things a
 * reader can do.
 */
export function splitSentences(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    const trimmed = current.trim()
    current = ''
    if (!trimmed) return
    if (trimmed.length <= maxChars) chunks.push(trimmed)
    else chunks.push(...hardWrap(trimmed, maxChars))
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '\n' || ch === '\r') { flush(); continue }
    current += ch

    if (!TERMINATORS.has(ch)) continue
    if (!isSentenceEnd(text, i)) continue

    // Swallow a run of terminators ("...", "?!") and any closing quote, so the
    // punctuation stays with the sentence it belongs to.
    while (i + 1 < text.length && TERMINATORS.has(text[i + 1])) current += text[++i]
    while (i + 1 < text.length && TRAILERS.has(text[i + 1])) current += text[++i]
    flush()
  }
  flush()

  return chunks
}

/**
 * Tidy extracted text before splitting.
 *
 * PDF text layers arrive with hard line breaks wherever the line ended on the
 * page, so a sentence is routinely broken across several of them. Joining those
 * back up matters more than it sounds: without it every visual line becomes its
 * own utterance and the result is read like a shopping list.
 *
 * **The contract this depends on:** a single newline is a wrapped line and gets
 * joined; a blank line is a real block boundary and is kept. Callers must
 * separate blocks — headings, list items, table cells, paragraphs — with a
 * blank line.
 *
 * That requirement is not laziness, it is where the information is. `제1조 목적`
 * (a heading) and `이 계약은 갑과 을이` (a wrapped line) are both short lines with
 * no final punctuation, and no rule over the characters alone can tell them
 * apart. The extractor knows, because the document format told it: pdfjs has
 * item coordinates, rhwp has paragraphs, Markdown has block elements.
 */
export function normalizeForSpeech(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // A hyphen at end of line is a word split across lines: close it up.
    .replace(/([A-Za-z])-\n([A-Za-z])/g, '$1$2')
    // Keep blank lines (real paragraph breaks) but join single wrapped lines
    // that do not end a sentence.
    .replace(/([^\n.!?…。！？])\n(?!\n)/g, '$1 ')
    // The class includes \u00a0 on purpose: PDF text layers are full
    // of non-breaking spaces, and leaving them in makes the engine read a
    // run-on word. Escaped, because a literal one is invisible in review.
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** Everything the reader needs for one document, in reading order. */
export interface SpeechPlan {
  chunks: string[]
}

export function planSpeech(rawText: string, maxChars: number = MAX_CHUNK_CHARS): SpeechPlan {
  return { chunks: splitSentences(normalizeForSpeech(rawText), maxChars) }
}

/**
 * Pick the language tag to synthesize a chunk with.
 *
 * The engine takes one language per call, and the honest choice for a mixed
 * Korean sentence with English terms in it — the normal case in Korean business
 * documents — is Korean: its reader handles embedded Latin words, whereas the
 * English reader mangles Hangul completely.
 */
export function languageFor(chunk: string, fallback: string = 'en'): string {
  return /[가-힣ᄀ-ᇿ㄰-㆏]/.test(chunk) ? 'ko' : fallback
}
