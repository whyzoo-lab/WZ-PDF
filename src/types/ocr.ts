/** One recognized text box in PDF points (page-local, top-left origin) —
 *  the same coordinate space as annotations (multiply by effectiveZoom for screen). */
export interface OcrWord {
  text: string
  score: number
  x: number
  y: number
  width: number
  height: number
  rotation: number // box angle; v1 always 0 (axis-aligned bbox)
}

export interface OcrPageResult {
  page: number
  words: OcrWord[]
  status: 'done' | 'error'
  durationMs: number
}

/** The words of every page whose recognition finished, by page. */
export function doneOcrWords(results: ReadonlyMap<number, OcrPageResult> | undefined): Map<number, OcrWord[]> {
  const out = new Map<number, OcrWord[]>()
  for (const [page, r] of results ?? []) if (r.status === 'done') out.set(page, r.words)
  return out
}

/** Normalized single line from the SDK: box = 4 [x,y] points in CANVAS pixels. */
export interface RawOcrLine {
  box: [number, number][]
  text: string
  score: number
}
