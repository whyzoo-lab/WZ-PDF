import { useState, useRef, useCallback, useEffect } from 'react'
import type { ViewerDoc } from '../types/viewerDoc'
import { getOrRenderPage } from './usePdfPage'
import { lineToWord } from '../utils/ocrCoords'
import { computeOcrScale, ocrMaxDimension } from '../utils/ocrInput'
import type { OcrPageResult } from '../types/ocr'

export interface UseOcrReturn {
  ocrResults: Map<number, OcrPageResult>
  ocrProgress: { done: number; total: number } | null
  isOcrRunning: boolean
  /** Page currently being recognized (drives the scanning animation), or null. */
  ocrActivePage: number | null
  ocrError: string | null
  runPage: (page: number) => Promise<void>
  runAll: () => Promise<void>
  cancel: () => void
  clear: () => void
}

export function useOcr(pdfDoc: ViewerDoc | null, numPages: number): UseOcrReturn {
  const [ocrResults, setOcrResults] = useState<Map<number, OcrPageResult>>(new Map())
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null)
  const [isOcrRunning, setIsOcrRunning] = useState(false)
  const [ocrActivePage, setOcrActivePage] = useState<number | null>(null)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const resultsRef = useRef(ocrResults)
  // eslint-disable-next-line react-hooks/refs -- keep a latest-value ref so async OCR callbacks read current results
  resultsRef.current = ocrResults
  const abortRef = useRef(false)

  // Reset OCR state whenever the document changes (new file, or page CRUD which
  // produces a fresh PDFDocumentProxy). Stale results would map to wrong pages.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when the document changes
    setOcrResults(new Map())
    setOcrError(null)
    setOcrActivePage(null)
  }, [pdfDoc])

  const ocrOnePage = useCallback(async (page: number): Promise<OcrPageResult> => {
    const cached = resultsRef.current.get(page)
    if (cached && cached.status === 'done') return cached
    if (!pdfDoc) return { page, words: [], status: 'error', durationMs: 0 }
    const started = performance.now()
    setOcrActivePage(page) // mark this page as "recognizing" for the overlay
    try {
      const { predict } = await import('../services/ocrEngine')
      const { canvas, renderScale } = await getOrRenderPage(pdfDoc, page)
      // Downscale the input on memory-constrained platforms (iOS) so OCR fits
      // the per-tab budget. Coordinates are recovered via the effective scale.
      const scale = computeOcrScale(canvas.width, canvas.height, ocrMaxDimension())
      let input = canvas
      if (scale < 1) {
        const small = document.createElement('canvas')
        small.width = Math.max(1, Math.round(canvas.width * scale))
        small.height = Math.max(1, Math.round(canvas.height * scale))
        small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height)
        input = small
      }
      const lines = await predict(input)
      // input px → PDF points: the page canvas was rasterized at `renderScale`
      // pixels-per-point (variable now, no longer fixed) and then possibly shrunk
      // by `scale`, so divide boxes by the product.
      const words = lines
        .map(l => lineToWord(l, renderScale * scale))
        .filter(w => w.text.length > 0)
      if (input !== canvas) { input.width = 0; input.height = 0 } // release the temp canvas
      return { page, words, status: 'done', durationMs: performance.now() - started }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : String(err))
      return { page, words: [], status: 'error', durationMs: performance.now() - started }
    }
  }, [pdfDoc])

  const store = useCallback((res: OcrPageResult) => {
    setOcrResults(prev => { const next = new Map(prev); next.set(res.page, res); return next })
  }, [])

  const runPage = useCallback(async (page: number) => {
    setIsOcrRunning(true)
    setOcrError(null)
    // Reported like a one-page run of `runAll`. Recognising a single page still
    // takes seconds, and to a reader who cannot see the scanning animation those
    // seconds are silence that could equally mean nothing happened.
    setOcrProgress({ done: 0, total: 1 })
    try { store(await ocrOnePage(page)) }
    finally { setIsOcrRunning(false); setOcrActivePage(null); setOcrProgress(null) }
  }, [ocrOnePage, store])

  const runAll = useCallback(async () => {
    abortRef.current = false
    setIsOcrRunning(true)
    setOcrError(null)
    setOcrProgress({ done: 0, total: numPages })
    try {
      for (let p = 1; p <= numPages; p++) {
        if (abortRef.current) break
        store(await ocrOnePage(p))
        setOcrProgress({ done: p, total: numPages })
      }
    } finally {
      setIsOcrRunning(false)
      setOcrProgress(null)
      setOcrActivePage(null)
    }
  }, [numPages, ocrOnePage, store])

  const cancel = useCallback(() => { abortRef.current = true }, [])
  const clear = useCallback(() => {
    setOcrResults(new Map())
    setOcrError(null)
    setOcrActivePage(null)
  }, [])

  return { ocrResults, ocrProgress, isOcrRunning, ocrActivePage, ocrError, runPage, runAll, cancel, clear }
}
