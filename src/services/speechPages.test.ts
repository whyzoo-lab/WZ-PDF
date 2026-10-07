import { describe, expect, it } from 'vitest'
import { joinSpeechUnits, pagesForChunks, type SpeechUnit } from './speechPages'
import { planSpeech } from './ttsText'

/** Plans speech exactly as the app does, then maps it back to pages. */
function mapped(units: SpeechUnit[]) {
  const { chunks } = planSpeech(joinSpeechUnits(units))
  return chunks.map((chunk, i) => [pagesForChunks(units, chunks)[i], chunk] as const)
}

describe('pagesForChunks', () => {
  it('puts each sentence of a deck\'s notes on its slide, skipping slides without notes', () => {
    const units = [
      { page: 2, text: '안녕하세요. 사업 개요를 말씀드리겠습니다.' },
      { page: 5, text: '목표 시스템은 다음과 같습니다.\n입주 기업 정보를 입력받습니다.' },
      { page: 6, text: '감사합니다.' },
    ]
    expect(mapped(units).map(([page]) => page)).toEqual([2, 2, 5, 5, 6])
  })

  it('places a sentence repeated on several pages by reading order', () => {
    const units = [
      { page: 1, text: 'Questions? Next slide.' },
      { page: 2, text: 'Questions? Thank you.' },
    ]
    expect(mapped(units)).toEqual([
      [1, 'Questions?'], [1, 'Next slide.'], [2, 'Questions?'], [2, 'Thank you.'],
    ])
  })

  it('shows the page a sentence starts on when it runs across a page break', () => {
    const units = [
      { page: 3, text: 'The contract begins on the first of' },
      { page: 4, text: 'March and runs for a year. It may be renewed.' },
    ]
    const pages = mapped(units)
    expect(pages[0][0]).toBe(3)
    expect(pages[pages.length - 1]).toEqual([4, 'It may be renewed.'])
  })

  it('splits a long sentence into chunks that all stay on its page', () => {
    const long = '이 문장은 아주 길어서 엔진에 한 번에 넘길 수 없으므로, 쉼표나 공백에서 나뉘어 여러 조각으로 읽히게 되는데, 그 조각들도 모두 같은 슬라이드에 속해야 하고, 다음 슬라이드로 넘어가서는 안 됩니다, 끝까지 그렇습니다.'
    const units = [{ page: 7, text: long }, { page: 8, text: '다음입니다.' }]
    const pages = mapped(units)
    expect(pages.length).toBeGreaterThan(2)
    expect(pages.slice(0, -1).every(([page]) => page === 7)).toBe(true)
    expect(pages[pages.length - 1][0]).toBe(8)
  })

  it('keeps the previous page for a chunk it cannot place', () => {
    expect(pagesForChunks([{ page: 9, text: 'Known text.' }], ['Known text.', 'something else entirely'])).toEqual([9, 9])
  })
})
