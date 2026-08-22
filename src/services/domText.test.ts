import { describe, expect, it } from 'vitest'
import { BLOCK_SEPARATOR, findFlexible, indexText, rangeAt } from './domText'

const html = (markup: string): HTMLElement => {
  const el = document.createElement('div')
  el.innerHTML = markup
  return el
}

describe('whitespace-flexible search', () => {
  it('finds text whose spacing was rewritten on the way out', () => {
    // The sentence went through the speech pipeline: the page's line break
    // became a single space, so a literal indexOf would miss it.
    const hit = findFlexible('이 계약은 갑과 을이\n체결한 것으로 한다.', '이 계약은 갑과 을이 체결한 것으로 한다.')
    expect(hit).not.toBeNull()
    expect(hit!.start).toBe(0)
    expect(hit!.end).toBe('이 계약은 갑과 을이\n체결한 것으로 한다.'.length)
  })

  it('matches across collapsed runs of spaces and non-breaking spaces', () => {
    const hit = findFlexible('총   계약 금액은 1억 원', '총 계약 금액은 1억 원')
    expect(hit).not.toBeNull()
    expect(hit!.start).toBe(0)
  })

  it('starts looking where the caller says, so a repeat lands correctly', () => {
    // The same sentence twice: the second call must find the second one.
    const text = '같은 문장. 다른 문장. 같은 문장.'
    const first = findFlexible(text, '같은 문장.')!
    const second = findFlexible(text, '같은 문장.', first.end)!
    expect(second.start).toBeGreaterThan(first.start)
    expect(text.slice(second.start, second.end)).toBe('같은 문장.')
  })

  it('returns null when the text is genuinely absent', () => {
    expect(findFlexible('여기에는 없습니다.', '다른 문장입니다.')).toBeNull()
  })

  it('ignores a needle that is only whitespace', () => {
    expect(findFlexible('아무 텍스트', '   ')).toBeNull()
  })

  it('does not run past the end of the haystack', () => {
    // A needle longer than what remains must fail rather than matching a prefix.
    expect(findFlexible('짧다', '짧다 그리고 더 있다')).toBeNull()
  })

  it('skips leading whitespace in the haystack when anchoring', () => {
    const hit = findFlexible('   \n  시작합니다.', '시작합니다.')
    expect(hit).not.toBeNull()
    expect(hit!.start).toBe(6)
  })
})

describe('indexing DOM text', () => {
  it('separates block elements so a match cannot straddle them', () => {
    const idx = indexText(html('<p>첫 문단</p><p>둘째 문단</p>'))
    expect(idx.text).toBe(`첫 문단${BLOCK_SEPARATOR}둘째 문단`)
    // The separator belongs to no node, so nothing can match across it.
    expect(findFlexible(idx.text, '첫 문단둘째')).toBeNull()
    expect(findFlexible(idx.text, '첫 문단 둘째 문단')).toBeNull()
  })

  it('still matches across a newline inside a single text node', () => {
    // Markup indentation puts newlines inside paragraphs; the speech pipeline
    // turned them into spaces, so the sentence must still be findable.
    const idx = indexText(html('<p>줄이\n  나뉜   문장</p>'))
    expect(findFlexible(idx.text, '줄이 나뉜 문장')).not.toBeNull()
  })

  it('skips script and style content', () => {
    const idx = indexText(html('<p>보이는 글</p><style>.a{color:red}</style><script>var x=1</script>'))
    expect(idx.text).toBe('보이는 글')
  })

  it('records where each text node starts', () => {
    const idx = indexText(html('<p>가나<b>다라</b></p>'))
    expect(idx.nodes).toHaveLength(2)
    expect(idx.offsets).toEqual([0, 2])
  })
})

describe('turning positions back into ranges', () => {
  it('spans across element boundaries', () => {
    const root = html('<p>가나<b>다라</b>마바</p>')
    const idx = indexText(root)
    const range = rangeAt(idx, 1, 4)   // 나다라마
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('나다라마')
  })

  it('refuses an empty range instead of producing a collapsed one', () => {
    const idx = indexText(html('<p>텍스트</p>'))
    expect(rangeAt(idx, 0, 0)).toBeNull()
  })

  it('returns null for an empty document rather than throwing', () => {
    const idx = indexText(html(''))
    expect(rangeAt(idx, 0, 3)).toBeNull()
  })
})
