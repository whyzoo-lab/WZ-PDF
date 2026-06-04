/**
 * Background-colour sampling for text edits. When a textEdit annotation covers
 * the original text, we fill the patch with the page's local background colour
 * (sampled from the rendered canvas) instead of plain white, so the patch
 * blends into coloured / off-white / scanned paper.
 */

type RGB = [number, number, number]

/** Hex string from the per-channel median of the samples. White if empty. */
export function medianColor(samples: RGB[]): string {
  if (samples.length === 0) return '#FFFFFF'
  const channel = (k: number): number => {
    const vals = samples.map(s => s[k]).sort((a, b) => a - b)
    return vals[Math.floor(vals.length / 2)]
  }
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${toHex(channel(0))}${toHex(channel(1))}${toHex(channel(2))}`
}

/**
 * Sample the background colour around a region of `canvas` (coordinates in
 * canvas pixels). Reads points just inside the corners and just outside the
 * mid-edges — places text glyphs rarely occupy — and returns the per-channel
 * median as a hex string. Returns null if the canvas can't be read (caller
 * falls back to white).
 */
export function sampleBackgroundColor(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  w: number,
  h: number,
): string | null {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const maxX = canvas.width - 1
    const maxY = canvas.height - 1
    if (maxX < 0 || maxY < 0) return null
    const cx = (v: number) => Math.max(0, Math.min(maxX, Math.round(v)))
    const cy = (v: number) => Math.max(0, Math.min(maxY, Math.round(v)))
    const points: Array<[number, number]> = [
      [x + 1, y + 1],
      [x + w - 2, y + 1],
      [x + 1, y + h - 2],
      [x + w - 2, y + h - 2],
      [x + w / 2, y - 3],
      [x + w / 2, y + h + 3],
      [x - 3, y + h / 2],
      [x + w + 3, y + h / 2],
    ]
    const samples: RGB[] = []
    for (const [px, py] of points) {
      const d = ctx.getImageData(cx(px), cy(py), 1, 1).data
      samples.push([d[0], d[1], d[2]])
    }
    return medianColor(samples)
  } catch {
    return null
  }
}
