import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { deletePages, insertBlankPage, insertPagesFromPdf, reorderPages } from './pdfPageService'

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
