import { describe, expect, it } from 'vitest'
import {
  MAX_CHUNK_CHARS,
  languageFor,
  normalizeForSpeech,
  planSpeech,
  splitSentences,
} from './ttsText'

describe('sentence splitting', () => {
  it('splits Korean prose on sentence-final punctuation', () => {
    expect(splitSentences('첫 문장입니다. 두 번째 문장입니다! 세 번째인가요?'))
      .toEqual(['첫 문장입니다.', '두 번째 문장입니다!', '세 번째인가요?'])
  })

  it('keeps a decimal number in one piece', () => {
    // Splitting here would read "총 1" then "5 퍼센트" — audibly wrong.
    expect(splitSentences('증가율은 1.5 퍼센트입니다.'))
      .toEqual(['증가율은 1.5 퍼센트입니다.'])
  })

  it('does not split inside a domain name', () => {
    expect(splitSentences('자세한 내용은 www.example.com 을 보세요.'))
      .toEqual(['자세한 내용은 www.example.com 을 보세요.'])
  })

  it('keeps closing quotes with the sentence they end', () => {
    expect(splitSentences('그는 "알겠습니다." 라고 답했다.'))
      .toEqual(['그는 "알겠습니다."', '라고 답했다.'])
  })

  it('treats a run of terminators as one ending', () => {
    expect(splitSentences('정말요...? 네.')).toEqual(['정말요...?', '네.'])
  })

  it('treats line breaks as boundaries even without punctuation', () => {
    // Headings and table cells have no full stop; running them into the next
    // line is the most obviously wrong thing a reader can do.
    expect(splitSentences('제1조 목적\n제2조 정의'))
      .toEqual(['제1조 목적', '제2조 정의'])
  })

  it('drops empty pieces instead of speaking silence', () => {
    expect(splitSentences('첫째.\n\n\n둘째.')).toEqual(['첫째.', '둘째.'])
    expect(splitSentences('   \n  ')).toEqual([])
  })

  it('handles full-width punctuation', () => {
    expect(splitSentences('안녕하세요。반갑습니다！')).toEqual(['안녕하세요。', '반갑습니다！'])
  })
})

describe('long-chunk wrapping', () => {
  it('never exceeds the limit the engine chunks at', () => {
    const long = '가'.repeat(400) + '.'
    for (const chunk of splitSentences(long)) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS)
    }
  })

  it('prefers to break at a comma', () => {
    const text = '앞부분을 충분히 길게 적어서 한도를 넘기도록 만든 문장이고, ' + '뒤'.repeat(90) + '.'
    const chunks = splitSentences(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].endsWith(',')).toBe(true)
  })

  it('still splits text with no break opportunity at all', () => {
    const chunks = splitSentences('가'.repeat(300))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe('가'.repeat(300))
  })

  it('loses no characters when wrapping on spaces', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const rejoined = splitSentences(words).join(' ')
    expect(rejoined.replace(/\s+/g, ' ')).toBe(words)
  })
})

describe('normalizing extracted text', () => {
  it('rejoins a sentence broken across page lines', () => {
    // A PDF text layer breaks wherever the line ended on the page.
    expect(normalizeForSpeech('이 계약은 갑과 을이\n체결한 것으로 한다.'))
      .toBe('이 계약은 갑과 을이 체결한 것으로 한다.')
  })

  it('keeps a real paragraph break', () => {
    expect(normalizeForSpeech('첫 문단입니다.\n\n둘째 문단입니다.'))
      .toBe('첫 문단입니다.\n둘째 문단입니다.')
  })

  it('closes up a word hyphenated across lines', () => {
    expect(normalizeForSpeech('inter-\nnational')).toBe('international')
  })

  it('collapses runs of spaces, including the ones PDFs emit', () => {
    expect(normalizeForSpeech('a   b \t c')).toBe('a b c')
  })
})

describe('planning a document', () => {
  it('produces speakable chunks from raw extracted text', () => {
    // Blocks separated by a blank line, wrapped lines by a single one — the
    // contract normalizeForSpeech documents, and what an extractor produces.
    const raw = '제1조 목적\n\n이 계약은 갑과 을이\n체결한 것으로 한다. 총액은 1.5억 원이다.'
    expect(planSpeech(raw).chunks).toEqual([
      '제1조 목적',
      '이 계약은 갑과 을이 체결한 것으로 한다.',
      '총액은 1.5억 원이다.',
    ])
  })
})

describe('language selection', () => {
  it('reads a chunk containing Hangul as Korean', () => {
    // The realistic case: Korean prose with English terms embedded. The Korean
    // reader copes with Latin words; the English reader mangles Hangul.
    expect(languageFor('PDF 및 HWP 문서를 지원합니다.')).toBe('ko')
    expect(languageFor('한글')).toBe('ko')
  })

  it('falls back for text with no Hangul', () => {
    expect(languageFor('This is a plain English sentence.')).toBe('en')
    expect(languageFor('12345 .', 'en')).toBe('en')
  })
})
