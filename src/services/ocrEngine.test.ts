import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()
const predictMock = vi.fn()

vi.mock('@paddleocr/paddleocr-js', () => ({
  PaddleOCR: { create: (...a: unknown[]) => createMock(...a) },
}))

import { initOcr, predict, __resetOcrForTests } from './ocrEngine'

beforeEach(() => {
  createMock.mockReset()
  predictMock.mockReset()
  __resetOcrForTests()
  createMock.mockResolvedValue({ predict: predictMock })
})

describe('ocrEngine', () => {
  it('initializes the SDK only once across concurrent calls', async () => {
    await Promise.all([initOcr(), initOcr(), initOcr()])
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('predict normalizes SDK output to RawOcrLine[]', async () => {
    // Real SDK shape: predict() -> OcrResult[]; OcrResult.items[] = { poly, text, score }
    predictMock.mockResolvedValue([{
      image: { width: 100, height: 100 },
      items: [{ poly: [[1,2],[3,2],[3,4],[1,4]], text: 'hi', score: 0.8 }],
      metrics: {}, runtime: {},
    }])
    const canvas = document.createElement('canvas')
    const lines = await predict(canvas)
    expect(lines).toEqual([{ box: [[1,2],[3,2],[3,4],[1,4]], text: 'hi', score: 0.8 }])
  })

  it('throws a clear error if SDK init fails', async () => {
    createMock.mockRejectedValue(new Error('wasm 404'))
    await expect(initOcr()).rejects.toThrow(/OCR engine failed to load/)
  })
})
