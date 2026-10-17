// The image codec the optimizer uses in the app: the browser decodes (JPEG,
// or raw samples through ImageData), a canvas resamples with high-quality
// smoothing, and encodes JPEG.

import type { ImageCodec } from './pdfOptimize'

export const canvasCodec: ImageCodec = {
  async resample(input, width, height, quality) {
    let source: ImageBitmap
    if ('jpeg' in input) {
      source = await createImageBitmap(new Blob([input.jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
    } else {
      const { raw, width: w, height: h, channels } = input
      const rgba = new Uint8ClampedArray(w * h * 4)
      for (let i = 0, j = 0; i < w * h; i++, j += channels) {
        rgba[i * 4] = raw[j]
        rgba[i * 4 + 1] = channels === 3 ? raw[j + 1] : raw[j]
        rgba[i * 4 + 2] = channels === 3 ? raw[j + 2] : raw[j]
        rgba[i * 4 + 3] = 255
      }
      source = await createImageBitmap(new ImageData(rgba, w, h))
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(source, 0, 0, width, height)
    source.close()
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', quality))
    canvas.width = canvas.height = 0
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null
  },
}
