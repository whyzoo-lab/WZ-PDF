// @vitest-environment node
//
// Two versions of a PDF compared as the app does it: words read through
// pdf.js with their boxes, diffed, and the changed words' boxes landing on the
// words on the page.
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { splitRun, wordsOfDocument } from './compareWords'
import { compareWords } from './textCompare'
import type { ViewerDoc } from '../types/viewerDoc'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href

async function pdf(lines: string[]) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([400, 300])
  lines.forEach((l, i) => page.drawText(l, { x: 40, y: 250 - i * 24, size: 14, font }))
  return pdfjs.getDocument({ data: await doc.save() }).promise
}

describe('compare two PDFs', () => {
  it('finds the changed word and marks it on its line', async () => {
    const older = await pdf(['The term is one year.', 'Payment within thirty days.'])
    const newer = await pdf(['The term is two years.', 'Payment within thirty days.'])
    const a = await wordsOfDocument(older as unknown as ViewerDoc, 'pdf', 1)
    const b = await wordsOfDocument(newer as unknown as ViewerDoc, 'pdf', 1)
    expect(b.map(w => w.text).join(' ')).toBe('The term is two years. Payment within thirty days.')
    const { changes } = compareWords(a, b)
    expect(changes.map(c => [c.kind, c.old.text, c.new.text])).toEqual([['replaced', 'one year.', 'two years.']])
    const [r] = changes[0].new.rects
    // On the first line (top-down: 300 - 250 = 50 is its baseline), right of "The term is".
    expect(r.y).toBeLessThan(50)
    expect(r.y + r.height).toBeGreaterThan(45)
    expect(r.x).toBeGreaterThan(100)
  })

  it('splits a run into words with their share of its width', () => {
    const ws = splitRun('ab  cd', 1, { x: 0, y: 0, width: 60, height: 10 })
    expect(ws.map(w => [w.text, w.rect!.x, w.rect!.width])).toEqual([['ab', 0, 20], ['cd', 40, 20]])
  })
})
