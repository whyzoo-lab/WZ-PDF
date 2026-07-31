// src/services/hwpFonts.ts
//
// Make sure a Korean face is actually available before rhwp paints a page.
//
// rhwp resolves each HWP font through a CSS fallback chain, e.g. for 바탕:
//   "바탕", Batang, 바탕, Nanum Myeongjo, AppleMyungjo, Noto Serif KR, …, serif
// On Korean Windows the first entries are installed system fonts, so the chain
// stops immediately and there is nothing for us to do. Elsewhere — a non-Korean
// Windows, macOS without the Korean pack, or the web build — every named family
// misses and the browser drops to generic serif/sans, which changes glyph shapes
// and metrics.
//
// Two things make this non-obvious:
//   1. Canvas does NOT trigger @font-face downloads. Declaring the face in CSS
//      is not enough; the font has to be loaded explicitly through the CSS Font
//      Loading API before anything is drawn, or the first render silently uses
//      the fallback.
//   2. Our bundled Noto files were only ever read as bytes by pdf-lib, so the
//      renderer never knew they existed.
//
// So: detect whether a Korean face is already there, and only pay for the
// download when it isn't. On the machines that need it, this is the difference
// between correct text and generic-serif text; on the machines that don't, it
// costs nothing.

/** Families rhwp's fallback chains end on that we actually ship. */
const BUNDLED = ['Noto Sans KR', 'Noto Serif KR'] as const

/**
 * Families that mean "this machine can already draw Korean the way the document
 * asked". Deliberately the ones that appear EARLY in rhwp's chains — if one of
 * these resolves, our webfonts would never be reached anyway.
 */
const SYSTEM_KOREAN = [
  '바탕', 'Batang', '맑은 고딕', 'Malgun Gothic', '굴림', 'Gulim',
  'Apple SD Gothic Neo', 'AppleMyungjo',
  'Noto Sans KR', 'Noto Serif KR',
]

/** Is `family` actually installed/loaded, rather than silently substituted? */
function familyResolves(family: string): boolean {
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return true // can't tell — don't force a download on a guess
  const sample = '한글Ag'
  // Compare against two very different generics: a family that isn't present
  // measures identically to whatever generic it falls back to.
  ctx.font = '48px monospace'
  const mono = ctx.measureText(sample).width
  ctx.font = `48px "${family}", monospace`
  const withFamily = ctx.measureText(sample).width
  return Math.abs(withFamily - mono) > 0.5
}

let ready: Promise<void> | null = null

/**
 * Resolve once a Korean face is usable for canvas rendering.
 *
 * Never rejects and never blocks for long: if the fonts are slow or missing the
 * page still renders, just with the browser's own fallback — which is exactly
 * what happened before this existed.
 */
export function ensureKoreanFonts(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    try {
      if (SYSTEM_KOREAN.some(familyResolves)) return // nothing to download
      if (!document.fonts?.load) return
      await Promise.race([
        Promise.all(BUNDLED.map(f => document.fonts.load(`16px "${f}"`))),
        // A slow or failed font must not hold a document hostage.
        new Promise(resolve => setTimeout(resolve, 3000)),
      ])
    } catch {
      /* fall back to whatever the browser has */
    }
  })()
  return ready
}
