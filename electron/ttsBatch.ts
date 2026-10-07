/**
 * Several sentences in one call to the speech engine, for making a video
 * (src/services/slideVideo.ts). Measured on the 15-sentence test script: five
 * at a time ran 1.7x faster than one by one at the same quality, because each
 * of the model's passes then does five sentences' work at once.
 *
 * The engine's `batch` returns one flat array: every sentence padded to the
 * longest, back to back, with each one's spoken length beside it. This cuts it
 * back into one clip per sentence and drops the padding — kept here, apart from
 * the worker, so it can be tested without an engine.
 */

/** Longest text `call` takes in one piece; longer ones it splits itself. */
export function maxChunkChars(lang: string): number {
  return lang === 'ko' || lang === 'ja' ? 120 : 300
}

/**
 * Whether these texts can go through `batch`. It does no splitting of its own,
 * so a text too long for one piece goes through `call` instead.
 */
export function canBatch(texts: readonly string[], langs: readonly string[]): boolean {
  return texts.length > 1 && texts.every((t, i) => t.length <= maxChunkChars(langs[i] ?? 'en'))
}

/** One clip per sentence from a batch's flat output. */
export function splitBatch(wav: ArrayLike<number>, durations: readonly number[], sampleRate: number): Float32Array[] {
  const count = durations.length
  if (count === 0) return []
  const row = Math.floor(wav.length / count)
  if (row * count !== wav.length) throw new Error('Batch output does not divide into its sentences')
  return durations.map((seconds, i) => {
    // The spoken length, rounded up, never past the row (which is padding).
    const length = Math.min(row, Math.ceil(seconds * sampleRate))
    const clip = new Float32Array(length)
    const start = i * row
    for (let k = 0; k < length; k++) clip[k] = wav[start + k]
    return clip
  })
}
