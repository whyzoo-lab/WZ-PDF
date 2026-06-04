import { useState, useRef, useCallback, useEffect } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { getOrRenderPage } from './usePdfPage'
import { lineToWord } from '../utils/ocrCoords'
import { PDF_RENDER_SCALE } from '../utils/constants'
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

export function useOcr(pdfDoc: PDFDocumentProxy | null, numPages: number): UseOcrReturn {
  const [ocrResults, setOcrResults] = useState<Map<number, OcrPageResult>>(new Map())
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null)
  const [isOcrRunning, setIsOcrRunning] = useState(false)
  const [ocrActivePage, setOcrActivePage] = useState<number | null>(null)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const resultsRef = useRef(ocrResults)
  resultsRef.current = ocrResults
  const abortRef = useRef(false)

  // Reset OCR state whenever the document changes (new file, or page CRUD which
  // produces a fresh PDFDocumentProxy). Stale results would map to wrong pages.
  useEffect(() => {
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
      const { canvas } = await getOrRenderPage(pdfDoc, page)
      const lines = await predict(canvas)
      const words = lines.map(l => lineToWord(l, PDF_RENDER_SCALE)).filter(w => w.text.length > 0)
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
    try { store(await ocrOnePage(page)) }
    finally { setIsOcrRunning(false); setOcrActivePage(null) }
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
