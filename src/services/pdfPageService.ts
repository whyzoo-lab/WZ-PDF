import { PDFDocument } from 'pdf-lib'

export type PageOpResult = {
  newBytes: ArrayBuffer
  pageMapping: Map<number, number>
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

/**
 * 지정한 페이지들을 삭제한다.
 * @param pageNums 삭제할 페이지 번호 배열 (1-based). 전체 삭제 시 오류를 던진다.
 * @returns pageMapping — 키: 기존 페이지 번호, 값: 새 페이지 번호. 삭제된 페이지는 키에 없음.
 */
export async function deletePages(
  bytes: ArrayBuffer,
  pageNums: number[],
): Promise<PageOpResult> {
  const srcDoc = await PDFDocument.load(bytes)
  const total = srcDoc.getPageCount()
  const deleteSet = new Set(pageNums)
  if (deleteSet.size >= total) {
    throw new Error(`페이지를 모두 삭제할 수 없습니다. 최소 1개 페이지는 유지해야 합니다.`)
  }
  const newDoc = await PDFDocument.create()
  const pageMapping = new Map<number, number>()
  let newPageNum = 1
  for (let i = 1; i <= total; i++) {
    if (!deleteSet.has(i)) {
      const [p] = await newDoc.copyPages(srcDoc, [i - 1])
      newDoc.addPage(p)
      pageMapping.set(i, newPageNum++)
    }
  }
  return { newBytes: toArrayBuffer(await newDoc.save()), pageMapping }
}

/**
 * 지정 페이지 뒤에 빈 페이지를 삽입한다.
 * @param afterPage 삽입 위치 (0 = 맨 앞, 1-based). total보다 크면 맨 뒤에 삽입.
 * @returns pageMapping — 삽입된 빈 페이지는 "새 페이지"이므로 키에 없음.
 */
export async function insertBlankPage(
  bytes: ArrayBuffer,
  afterPage: number,
): Promise<PageOpResult> {
  const srcDoc = await PDFDocument.load(bytes)
  const total = srcDoc.getPageCount()
  afterPage = Math.min(afterPage, total)
  const refIdx = afterPage > 0 ? afterPage - 1 : 0
  const { width, height } = srcDoc.getPage(refIdx).getSize()
  const newDoc = await PDFDocument.create()
  const pageMapping = new Map<number, number>()
  for (let i = 1; i <= afterPage; i++) {
    const [p] = await newDoc.copyPages(srcDoc, [i - 1])
    newDoc.addPage(p)
    pageMapping.set(i, i)
  }
  newDoc.addPage([width, height])
  for (let i = afterPage + 1; i <= total; i++) {
    const [p] = await newDoc.copyPages(srcDoc, [i - 1])
    newDoc.addPage(p)
    pageMapping.set(i, i + 1)
  }
  return { newBytes: toArrayBuffer(await newDoc.save()), pageMapping }
}

/**
 * 지정 페이지 뒤에 다른 PDF의 모든 페이지를 삽입한다.
 * @param afterPage 삽입 위치 (0 = 맨 앞, 1-based)
 * @returns pageMapping — 삽입된 src 페이지는 키에 없음 (새 페이지). dest 페이지만 매핑됨.
 */
export async function insertPagesFromPdf(
  bytes: ArrayBuffer,
  srcBytes: ArrayBuffer,
  afterPage: number,
): Promise<PageOpResult> {
  const destDoc = await PDFDocument.load(bytes)
  const srcDoc  = await PDFDocument.load(srcBytes)
  const destTotal = destDoc.getPageCount()
  const srcTotal  = srcDoc.getPageCount()
  const newDoc = await PDFDocument.create()
  const pageMapping = new Map<number, number>()
  for (let i = 1; i <= afterPage; i++) {
    const [p] = await newDoc.copyPages(destDoc, [i - 1])
    newDoc.addPage(p)
    pageMapping.set(i, i)
  }
  for (let i = 0; i < srcTotal; i++) {
    const [p] = await newDoc.copyPages(srcDoc, [i])
    newDoc.addPage(p)
  }
  for (let i = afterPage + 1; i <= destTotal; i++) {
    const [p] = await newDoc.copyPages(destDoc, [i - 1])
    newDoc.addPage(p)
    pageMapping.set(i, i + srcTotal)
  }
  return { newBytes: toArrayBuffer(await newDoc.save()), pageMapping }
}

/**
 * 페이지 순서를 재배열한다.
 * @param newOrder 새 순서 배열. newOrder[i] = 새 i+1번째 위치에 놓일 원래 페이지 번호 (1-based)
 *                 예: [3, 1, 2] → 기존 3번이 1번, 1번이 2번, 2번이 3번이 됨
 */
export async function reorderPages(
  bytes: ArrayBuffer,
  newOrder: number[],
): Promise<PageOpResult> {
  const srcDoc = await PDFDocument.load(bytes)
  const newDoc = await PDFDocument.create()
  const pageMapping = new Map<number, number>()
  for (let newIdx = 0; newIdx < newOrder.length; newIdx++) {
    const oldPageNum = newOrder[newIdx]
    const [p] = await newDoc.copyPages(srcDoc, [oldPageNum - 1])
    newDoc.addPage(p)
    pageMapping.set(oldPageNum, newIdx + 1)
  }
  return { newBytes: toArrayBuffer(await newDoc.save()), pageMapping }
}
