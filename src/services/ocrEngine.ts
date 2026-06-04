// SDK result shape (from @paddleocr/paddleocr-js types):
//   create(opts) -> PaddleOCR; predict(canvas) -> OcrResult[]
//   OcrResult = { image:{width,height}, items: OcrResultItem[], metrics, runtime }
//   OcrResultItem = { poly: [number,number][], text: string, score: number }
import { PaddleOCR } from '@paddleocr/paddleocr-js'
import type { OcrResult } from '@paddleocr/paddleocr-js'
import type { RawOcrLine } from '../types/ocr'

type OcrInstance = { predict: (img: HTMLCanvasElement) => Promise<OcrResult[]> }

let instance: OcrInstance | null = null
let initPromise: Promise<OcrInstance> | null = null

export function __resetOcrForTests() { instance = null; initPromise = null }

export function initOcr(): Promise<OcrInstance> {
  if (instance) return Promise.resolve(instance)
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const ocr = await PaddleOCR.create({
        ocrVersion: 'PP-OCRv5',
        ortOptions: { backend: 'auto', wasmPaths: '/ocr/wasm/' },
        worker: true,
        textDetectionModelName: 'PP-OCRv5_mobile_det',
        textDetectionModelAsset: { url: '/ocr/models/PP-OCRv5_mobile_det.tar' },
        textRecognitionModelName: 'korean_PP-OCRv5_mobile_rec',
        textRecognitionModelAsset: { url: '/ocr/models/korean_PP-OCRv5_mobile_rec.tar' },
      }) as OcrInstance
      instance = ocr
      return ocr
    } catch (err) {
      initPromise = null
      throw new Error(`OCR engine failed to load: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
  return initPromise
}

/** Normalize the SDK's per-image result into RawOcrLine[]. */
function normalize(result: OcrResult): RawOcrLine[] {
  return result.items.map(it => ({
    box: it.poly.map(p => [p[0], p[1]] as [number, number]),
    text: it.text,
    score: it.score,
  }))
}

export async function predict(canvas: HTMLCanvasElement): Promise<RawOcrLine[]> {
  const ocr = await initOcr()
  const out = await ocr.predict(canvas) // OcrResult[] — one per input image
  const first = out[0]
  if (!first) return []
  return normalize(first)
}
