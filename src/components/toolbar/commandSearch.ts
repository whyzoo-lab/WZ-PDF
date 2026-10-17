// How the command palette ranks commands against what is typed.
//
// Ported from PdfCraft's palette (crates/ui-egui/src/palette.rs, Apache-2.0/MIT):
// a case-folded substring match ranks by where it starts; then the other
// language's label; then the command id (+50); and as a last resort the typed
// characters appearing in order (100). Commands that cannot run now sort last.
//
// Added for Korean: 초성 search. Typing only initial consonants ("ㅇㄹ") matches
// the labels whose syllables start with them ("열기", "인쇄 → ㅇㅅ"), the way
// Korean phone contacts and app launchers are searched.

const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

/** Lower-cased, NFC, spaces collapsed. */
export function fold(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Each Hangul syllable replaced by its initial consonant; everything else kept. */
export function choseong(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00
    out += code >= 0 && code < 11172 ? CHOSEONG[Math.floor(code / 588)] : ch
  }
  return out
}

const isAllChoseong = (q: string) => q.length > 0 && [...q.replace(/\s/g, '')].every(c => CHOSEONG.includes(c))

/** Where `needle` (folded) matches `hay`: lower is better, null for no match. */
export function score(hay: string, needle: string): number | null {
  if (!needle) return 0
  const h = fold(hay)
  const at = h.indexOf(needle)
  if (at >= 0) return at
  if (isAllChoseong(needle)) {
    const c = choseong(h).replace(/\s/g, '')
    const i = c.indexOf(needle.replace(/\s/g, ''))
    if (i >= 0) return 10 + i
  }
  // The typed characters, in order, anywhere in the label.
  let from = 0
  for (const ch of needle.replace(/\s/g, '')) {
    const i = h.indexOf(ch, from)
    if (i < 0) return null
    from = i + 1
  }
  return 100
}

export interface Searchable {
  id: string
  label: string
  /** The label in the other language (English for a Korean UI). */
  alt?: string
  /** Extra words that should find it (synonyms). */
  keywords?: string
  disabled?: boolean
}

/** The commands matching `query`, best first, at most `limit`. */
export function rank<T extends Searchable>(commands: readonly T[], query: string, limit = 12): T[] {
  const q = fold(query)
  const hits: { s: number; i: number; c: T }[] = []
  commands.forEach((c, i) => {
    const best = [
      score(c.label, q),
      c.alt === undefined ? null : score(c.alt, q),
      c.keywords === undefined ? null : (s => (s === null ? null : s + 20))(score(c.keywords, q)),
      (s => (s === null ? null : s + 50))(score(c.id, q)),
    ].filter((s): s is number => s !== null)
    if (best.length) hits.push({ s: Math.min(...best), i, c })
  })
  hits.sort((a, b) => (a.s - b.s) || (Number(!!a.c.disabled) - Number(!!b.c.disabled)) || (a.i - b.i))
  return hits.slice(0, limit).map(h => h.c)
}
