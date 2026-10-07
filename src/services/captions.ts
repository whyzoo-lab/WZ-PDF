/**
 * Captions for a narrated slide video: the cue list, the two sidecar formats,
 * and line wrapping for the version with the captions drawn into the picture.
 * Pure — no DOM; the measuring function is passed in.
 */

/** One subtitle: shown from `start` to `end`, in seconds. */
export interface Cue {
  start: number
  end: number
  text: string
}

function clock(seconds: number, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor(ms / 60_000) % 60
  const s = Math.floor(ms / 1000) % 60
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms % 1000, 3)}`
}

/** One line per cue: a caption is a sentence, and players wrap it themselves. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** SubRip — what YouTube and most players take as a separate file. */
export function toSrt(cues: readonly Cue[]): string {
  return cues
    .map((cue, i) => `${i + 1}\n${clock(cue.start, ',')} --> ${clock(cue.end, ',')}\n${oneLine(cue.text)}\n`)
    .join('\n')
}

/** WebVTT — for a web page's <video><track>. Its text is markup, so & and < are escaped. */
export function toVtt(cues: readonly Cue[]): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return 'WEBVTT\n\n' + cues
    .map(cue => `${clock(cue.start, '.')} --> ${clock(cue.end, '.')}\n${escape(oneLine(cue.text))}\n`)
    .join('\n')
}

/**
 * Break a caption into lines no wider than `maxWidth`, at spaces where it can
 * and between characters where a single word is wider than a line (a long
 * Korean phrase or a URL has no space to break at).
 */
export function wrapCaption(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  let line = ''
  const push = () => { if (line) lines.push(line); line = '' }
  for (const word of oneLine(text).split(' ')) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate) <= maxWidth) { line = candidate; continue }
    push()
    if (measure(word) <= maxWidth) { line = word; continue }
    // A word wider than the line: by character.
    for (const ch of word) {
      if (line && measure(line + ch) > maxWidth) push()
      line += ch
    }
  }
  push()
  return lines
}
