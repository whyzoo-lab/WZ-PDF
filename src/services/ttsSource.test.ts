import { describe, expect, it } from 'vitest'
import type { DocKind, ViewerDoc } from '../types/viewerDoc'
import {
  groupLinesIntoBlocks,
  linesFromRuns,
  linesFromPdfItems,
  textFromElement,
  textFromPages,
} from './ttsSource'

describe('grouping lines into blocks', () => {
  it('joins normally spaced lines with a single newline', () => {
    // Ordinary leading: these are wrapped lines of one paragraph.
    const text = groupLinesIntoBlocks([
      { text: '이 계약은 갑과 을이', y: 700, height: 12 },
      { text: '체결한 것으로 한다.', y: 686, height: 12 },
    ])
    expect(text).toBe('이 계약은 갑과 을이\n체결한 것으로 한다.')
  })

  it('starts a new block when the gap is large', () => {
    const text = groupLinesIntoBlocks([
      { text: '제1조 목적', y: 700, height: 12 },
      { text: '이 계약은 갑과 을이', y: 660, height: 12 },
    ])
    expect(text).toBe('제1조 목적\n\n이 계약은 갑과 을이')
  })

  it('treats a blank line as the gap it is, never as an utterance', () => {
    // The empty line must not become something to speak — but it is also a real
    // vertical gap, so what it leaves behind is a block break.
    const text = groupLinesIntoBlocks([
      { text: '첫 줄', y: 700, height: 12 },
      { text: '   ', y: 686, height: 12 },
      { text: '둘째 줄', y: 672, height: 12 },
    ])
    expect(text).toBe('첫 줄\n\n둘째 줄')
    expect(text.split('\n').filter(l => l.trim() === '')).toHaveLength(1)
  })

  it('survives lines with no height information', () => {
    // A zero height would make every gap look enormous and every line a block.
    const text = groupLinesIntoBlocks([
      { text: 'a', y: 10, height: 0 },
      { text: 'b', y: 9, height: 0 },
    ])
    expect(text).toBe('a\nb')
  })
})

describe('lines from a pdfjs text stream', () => {
  it('concatenates runs until hasEOL', () => {
    // pdfjs emits one run per formatting change; the PDF encodes its own
    // spacing, so joining with an added space would double it.
    const lines = linesFromPdfItems([
      { str: '총 계약', transform: [1, 0, 0, 1, 50, 700], height: 12 },
      { str: '금액은', hasEOL: true, transform: [1, 0, 0, 1, 90, 700], height: 12 },
      { str: '1억 원입니다.', hasEOL: true, transform: [1, 0, 0, 1, 50, 686], height: 12 },
    ])
    expect(lines.map(l => l.text)).toEqual(['총 계약금액은', '1억 원입니다.'])
    expect(lines[0].y).toBe(700)
  })

  it('keeps a trailing run that never sets hasEOL', () => {
    const lines = linesFromPdfItems([{ str: '마지막 줄', transform: [1, 0, 0, 1, 0, 5] }])
    expect(lines.map(l => l.text)).toEqual(['마지막 줄'])
  })

  it('ignores items that carry no string', () => {
    const lines = linesFromPdfItems([{ type: 'beginMarkedContent' }, { str: 'x', hasEOL: true }])
    expect(lines.map(l => l.text)).toEqual(['x'])
  })
})

describe('lines from positioned runs (rhwp or OCR)', () => {
  it('merges runs that share a baseline', () => {
    const lines = linesFromRuns([
      { text: '총 계약금액은 ', x: 50, y: 100, width: 60, height: 12 },
      { text: '1억 원', x: 110, y: 101, width: 30, height: 12 },
      { text: '다음 줄입니다', x: 50, y: 120, width: 60, height: 12 },
    ])
    expect(lines.map(l => l.text)).toEqual(['총 계약금액은 1억 원', '다음 줄입니다'])
  })

  it('orders runs on a line by x, not by arrival', () => {
    const lines = linesFromRuns([
      { text: '뒤', x: 110, y: 100, width: 10, height: 12 },
      { text: '앞', x: 50, y: 100, width: 10, height: 12 },
    ])
    expect(lines[0].text).toBe('앞뒤')
  })
})

describe('text from a reflowing document', () => {
  const html = (markup: string): HTMLElement => {
    const el = document.createElement('div')
    el.innerHTML = markup
    return el
  }

  it('makes each block element its own block', () => {
    const text = textFromElement(html('<h1>제목</h1><p>첫 문단.</p><p>둘째 문단.</p>'))
    expect(text).toBe('제목\n\n첫 문단.\n\n둘째 문단.')
  })

  it('does not speak a nesting block twice', () => {
    // <li> inside <li> — the outer would otherwise contribute its child's text
    // as well as the child doing so itself.
    const text = textFromElement(html('<ul><li><p>안쪽</p></li></ul>'))
    expect(text).toBe('안쪽')
  })

  it('falls back to the whole element when there are no block tags', () => {
    expect(textFromElement(html('그냥 텍스트'))).toBe('그냥 텍스트')
  })

  it('collapses the whitespace that markup leaves behind', () => {
    expect(textFromElement(html('<p>줄이\n  나뉜   문장</p>'))).toBe('줄이 나뉜 문장')
  })
})

describe('falling back to OCR on a scanned page', () => {
  /** A one-page document whose text layer is empty, like an image-only PDF. */
  const scannedDoc = (items: unknown[]): ViewerDoc => ({
    numPages: 1,
    getPage: async () => ({
      getViewport: () => ({ width: 100, height: 100, scale: 1 }),
      render: () => ({ promise: Promise.resolve() }),
      getTextContent: async () => ({ items }),
    }),
    destroy: () => undefined,
  })

  it('reads recognized text when the page has no text layer', async () => {
    const text = await textFromPages(scannedDoc([]), 'pdf' as DocKind, { from: 1, to: 1 }, {
      ocrRuns: () => [
        { text: '스캔 문서', x: 40, y: 20, height: 14 },
        { text: '읽기 시험입니다.', x: 40, y: 44, height: 14 },
      ],
    })
    expect(text).toContain('스캔 문서')
    expect(text).toContain('읽기 시험입니다.')
  })

  it('puts recognized boxes into reading order', async () => {
    // Detection order is not reading order, so the boxes arrive shuffled.
    const text = await textFromPages(scannedDoc([]), 'pdf' as DocKind, { from: 1, to: 1 }, {
      ocrRuns: () => [
        { text: '셋째', x: 40, y: 80, height: 14 },
        { text: '첫째', x: 40, y: 20, height: 14 },
        { text: '둘째', x: 40, y: 50, height: 14 },
      ],
    })
    expect(text.indexOf('첫째')).toBeLessThan(text.indexOf('둘째'))
    expect(text.indexOf('둘째')).toBeLessThan(text.indexOf('셋째'))
  })

  it('prefers the real text layer over recognition', async () => {
    // Native text is exact; OCR is a guess. Never trade down.
    const withText = scannedDoc([{ str: '진짜 텍스트입니다.', hasEOL: true, transform: [1, 0, 0, 1, 0, 700] }])
    const text = await textFromPages(withText, 'pdf' as DocKind, { from: 1, to: 1 }, {
      ocrRuns: () => [{ text: '잘못 인식된 글자', x: 0, y: 0, height: 14 }],
    })
    expect(text).toBe('진짜 텍스트입니다.')
  })

  it('returns nothing when OCR has not run on the page', async () => {
    const text = await textFromPages(scannedDoc([]), 'pdf' as DocKind, { from: 1, to: 1 }, {
      ocrRuns: () => undefined,
    })
    expect(text).toBe('')
  })
})
