import { describe, it, expect } from 'vitest'
import { toDisplayed, fromDisplayed, mergeLineRects, selectionToRects, commentAt, rangeText } from './pageGeometry'
import type { Annotation } from '../types/annotation'

describe('toDisplayed / fromDisplayed', () => {
  it('are inverses for every rotation', () => {
    for (const rot of [0, 90, 180, 270]) {
      const d = toDisplayed(30, 70, 200, 300, rot)
      expect(fromDisplayed(d.x, d.y, 200, 300, rot)).toEqual({ x: 30, y: 70 })
    }
  })

  it('turns the top-left corner where CSS rotate puts it', () => {
    // A page 200 wide, 300 tall: turned 90deg clockwise its top-left shows top-right.
    expect(toDisplayed(0, 0, 200, 300, 90)).toEqual({ x: 300, y: 0 })
    expect(toDisplayed(0, 0, 200, 300, 180)).toEqual({ x: 200, y: 300 })
    expect(toDisplayed(0, 0, 200, 300, 270)).toEqual({ x: 0, y: 200 })
  })
})

describe('mergeLineRects', () => {
  it('joins the spans of one line and keeps lines apart', () => {
    const out = mergeLineRects([
      { x: 10, y: 10, width: 40, height: 12 },
      { x: 50, y: 10.5, width: 30, height: 11 },
      { x: 10, y: 30, width: 60, height: 12 },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ x: 10, y: 10, width: 70, height: 12 })
    expect(out[1].y).toBe(30)
  })

  it('keeps two columns on the same line apart', () => {
    const out = mergeLineRects([
      { x: 10, y: 10, width: 40, height: 12 },
      { x: 200, y: 10, width: 40, height: 12 },
    ])
    expect(out).toHaveLength(2)
  })

  it('drops empty boxes', () => {
    expect(mergeLineRects([{ x: 0, y: 0, width: 0, height: 10 }])).toEqual([])
  })
})

describe('selectionToRects', () => {
  const page = { left: 100, top: 50, right: 300, bottom: 350, width: 200, height: 300 } as DOMRect
  const rect = (left: number, top: number, w: number, h: number) =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect

  it('converts to PDF points at the zoom', () => {
    const out = selectionToRects([rect(120, 70, 40, 15)], page, 200, 300, 0, 2)
    expect(out).toEqual([{ x: 10, y: 10, width: 20, height: 7.5 }])
  })

  it('undoes the page rotation', () => {
    // Shown turned 90deg: the page box is 300 wide, 200 tall on screen.
    const turned = { left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 } as DOMRect
    // A vertical strip near the right edge on screen = a line near the top unrotated.
    const out = selectionToRects([rect(280, 20, 10, 60)], turned, 200, 300, 90, 1)
    expect(out).toEqual([{ x: 20, y: 10, width: 60, height: 10 }])
  })

  it('ignores the end-of-content box and anything off the page', () => {
    expect(selectionToRects([rect(100, 50, 200, 300), rect(400, 70, 20, 10)], page, 200, 300, 0, 1)).toEqual([])
  })
})

describe('commentAt', () => {
  const base = { rotation: 0, contents: '', author: '', createdAt: 0, replies: [] }
  const anns = [
    { ...base, id: 'h', type: 'highlight', page: 1, x: 0, y: 0, width: 100, height: 30, color: '#ff0', text: 'x', rects: [{ x: 0, y: 0, width: 100, height: 10 }, { x: 0, y: 20, width: 50, height: 10 }] },
    { ...base, id: 'n', type: 'note', page: 1, x: 200, y: 200, width: 20, height: 20, color: '#fc0' },
  ] as Annotation[]

  it('finds a markup by its lines, not its bounds', () => {
    expect(commentAt(anns, 1, 10, 5)?.id).toBe('h')
    expect(commentAt(anns, 1, 80, 25)).toBeNull()
  })

  it('finds a note and respects the page', () => {
    expect(commentAt(anns, 1, 210, 210)?.id).toBe('n')
    expect(commentAt(anns, 2, 210, 210)).toBeNull()
  })
})

describe('rangeText', () => {
  it('keeps the space a line break and separate word boxes stand for', () => {
    const el = document.createElement('div')
    el.innerHTML = '<span>WZ Reader</span><br><span>Every document</span><span class="wz-ocr-span">계약</span><span class="wz-ocr-span">기간</span>'
    document.body.append(el)
    const r = document.createRange()
    r.selectNodeContents(el)
    expect(rangeText(r)).toBe('WZ Reader Every document계약 기간')
    el.remove()
  })
})
