import { describe, it, expect } from 'vitest'
import { PDFDocument } from '@cantoo/pdf-lib'
import { deletePages, extractPages, insertBlankPage, insertPagesFromPdf, reorderPages } from './pdfPageService'

async function makeTestPdf(pageCount: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([612, 792])
  }
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function pageCount(bytes: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPageCount()
}

/** Each page gets a distinct width, so a page can be identified after copying. */
async function makeNumberedPdf(pageCount: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  for (let i = 1; i <= pageCount; i++) doc.addPage([100 + i, 792])
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Which source pages a produced document holds, read back from their widths. */
async function pageOrder(bytes: ArrayBuffer): Promise<number[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map(p => Math.round(p.getWidth()) - 100)
}

describe('deletePages', () => {
  it('단일 페이지 삭제 후 페이지 수가 줄고 매핑이 정확하다', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await deletePages(bytes, [2])
    expect(await pageCount(newBytes)).toBe(2)
    expect(pageMapping.get(1)).toBe(1)
    expect(pageMapping.has(2)).toBe(false)
    expect(pageMapping.get(3)).toBe(2)
  })

  it('여러 페이지 삭제', async () => {
    const bytes = await makeTestPdf(5)
    const { newBytes, pageMapping } = await deletePages(bytes, [2, 4])
    expect(await pageCount(newBytes)).toBe(3)
    expect(pageMapping.get(1)).toBe(1)
    expect(pageMapping.has(2)).toBe(false)
    expect(pageMapping.get(3)).toBe(2)
    expect(pageMapping.has(4)).toBe(false)
    expect(pageMapping.get(5)).toBe(3)
  })
})

describe('insertBlankPage', () => {
  it('지정 페이지 뒤에 빈 페이지 삽입', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await insertBlankPage(bytes, 1)
    expect(await pageCount(newBytes)).toBe(4)
    expect(pageMapping.get(1)).toBe(1)
    expect(pageMapping.get(2)).toBe(3)
    expect(pageMapping.get(3)).toBe(4)
  })

  it('afterPage=0 이면 맨 앞에 삽입', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await insertBlankPage(bytes, 0)
    expect(await pageCount(newBytes)).toBe(4)
    expect(pageMapping.get(1)).toBe(2)
    expect(pageMapping.get(2)).toBe(3)
    expect(pageMapping.get(3)).toBe(4)
  })

  it('afterPage = 마지막 페이지면 맨 뒤에 삽입', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await insertBlankPage(bytes, 3)
    expect(await pageCount(newBytes)).toBe(4)
    expect(pageMapping.get(1)).toBe(1)
    expect(pageMapping.get(2)).toBe(2)
    expect(pageMapping.get(3)).toBe(3)
  })
})

describe('insertPagesFromPdf', () => {
  it('다른 PDF의 모든 페이지를 지정 위치 뒤에 삽입', async () => {
    const dest = await makeTestPdf(3)
    const src  = await makeTestPdf(2)
    const { newBytes, pageMapping } = await insertPagesFromPdf(dest, src, 1)
    expect(await pageCount(newBytes)).toBe(5)
    expect(pageMapping.get(1)).toBe(1)
    expect(pageMapping.get(2)).toBe(4)
    expect(pageMapping.get(3)).toBe(5)
  })
})

describe('reorderPages', () => {
  it('newOrder 배열 순서대로 페이지를 재배열하고 매핑을 반환한다', async () => {
    const bytes = await makeTestPdf(3)
    const { newBytes, pageMapping } = await reorderPages(bytes, [3, 1, 2])
    expect(await pageCount(newBytes)).toBe(3)
    expect(pageMapping.get(3)).toBe(1)
    expect(pageMapping.get(1)).toBe(2)
    expect(pageMapping.get(2)).toBe(3)
  })

  it('역순 재배열', async () => {
    const bytes = await makeTestPdf(4)
    const { newBytes, pageMapping } = await reorderPages(bytes, [4, 3, 2, 1])
    expect(await pageCount(newBytes)).toBe(4)
    expect(pageMapping.get(4)).toBe(1)
    expect(pageMapping.get(1)).toBe(4)
  })
})

describe('extractPages', () => {
  it('선택한 페이지만 담은 새 문서를 만든다', async () => {
    const bytes = await makeNumberedPdf(5)
    const out = await extractPages(bytes, [2, 4])
    expect(await pageOrder(out)).toEqual([2, 4])
  })

  it('한 페이지만 선택해도 동작한다', async () => {
    const bytes = await makeNumberedPdf(3)
    expect(await pageOrder(await extractPages(bytes, [3]))).toEqual([3])
  })

  it('선택 순서와 상관없이 문서 순서대로 담는다', async () => {
    // Ctrl-클릭 순서를 그대로 쓰면 "3, 1, 2"짜리 PDF가 나온다.
    const bytes = await makeNumberedPdf(4)
    expect(await pageOrder(await extractPages(bytes, [3, 1, 2]))).toEqual([1, 2, 3])
  })

  it('중복 선택은 한 번만 담는다', async () => {
    const bytes = await makeNumberedPdf(3)
    expect(await pageOrder(await extractPages(bytes, [2, 2, 2]))).toEqual([2])
  })

  it('범위를 벗어난 번호는 무시한다', async () => {
    const bytes = await makeNumberedPdf(3)
    expect(await pageOrder(await extractPages(bytes, [0, 2, 9]))).toEqual([2])
  })

  it('남는 페이지가 없으면 조용히 빈 PDF를 만들지 않고 실패한다', async () => {
    const bytes = await makeNumberedPdf(3)
    await expect(extractPages(bytes, [])).rejects.toThrow()
    await expect(extractPages(bytes, [7, 8])).rejects.toThrow()
  })

  it('원본 문서는 그대로 둔다', async () => {
    const bytes = await makeNumberedPdf(4)
    await extractPages(bytes, [1, 2])
    expect(await pageCount(bytes)).toBe(4)
  })
})

describe('암호가 걸린 문서', () => {
  async function makeLockedPdf(): Promise<ArrayBuffer> {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.encrypt({ userPassword: 'pw', ownerPassword: 'pw' })
    const bytes = await doc.save()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }

  // pdf-lib은 복호화를 못 한다. `ignoreEncryption`으로 열면 콘텐츠 스트림이
  // 암호화된 채로 남아, 페이지 수만 맞고 열리지 않는 파일이 나온다. 그래서 조용히
  // 망가진 결과를 내놓는 대신 알아볼 수 있는 말로 거절해야 한다.
  it('페이지를 저장하려 하면 사람이 읽을 수 있는 말로 거절한다', async () => {
    const bytes = await makeLockedPdf()
    await expect(extractPages(bytes, [1])).rejects.toThrow(/암호|password/i)
  })

  it('삭제·삽입·재정렬도 같은 이유로 거절한다', async () => {
    const bytes = await makeLockedPdf()
    await expect(deletePages(bytes, [1])).rejects.toThrow(/암호|password/i)
    await expect(insertBlankPage(bytes, 1)).rejects.toThrow(/암호|password/i)
    await expect(reorderPages(bytes, [1])).rejects.toThrow(/암호|password/i)
  })

  it('pdf-lib의 개발자용 영문 오류를 그대로 흘리지 않는다', async () => {
    const bytes = await makeLockedPdf()
    // 원문에는 `ignoreEncryption: true`를 쓰라는 안내가 들어 있는데, 그 옵션이
    // 바로 깨진 파일을 만드는 길이라 사용자에게 보여선 안 된다.
    const err = await extractPages(bytes, [1]).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toMatch(/ignoreEncryption/)
    // 원래 오류는 버리지 않고 cause로 붙여 둔다 — 디버깅에는 여전히 필요하다.
    expect((err as Error).cause).toBeInstanceOf(Error)
  })
})
