import { PDFDocument } from '@cantoo/pdf-lib'
import { loadPdfForWriting } from './pdfLoad'
import { t } from '../i18n'

export type PageOpResult = {
  newBytes: ArrayBuffer
  pageMapping: Map<number, number>
}

/**
 * 편집을 위해 문서를 연다. 암호가 걸린 문서는 여기서 분명하게 막는다.
 *
 * pdf-lib는 복호화를 하지 못한다. `ignoreEncryption: true`를 주면 로드는 되지만
 * 콘텐츠 스트림은 암호화된 채로 남아, 페이지 수만 맞고 내용은 읽을 수 없는 파일이
 * 나온다 — 실패하는 것보다 나쁘다. 그래서 그 옵션을 쓰지 않고, pdf-lib의 개발자용
 * 영문 오류 대신 사용자가 이해할 수 있는 말로 바꿔서 던진다.
 */
async function loadForEditing(bytes: ArrayBuffer, password?: string): Promise<PDFDocument> {
  try {
    return await loadPdfForWriting(bytes, password)
  } catch (err) {
    if (err instanceof Error && /encrypted/i.test(err.message)) {
      throw new Error(t('pdf.encryptedNoEdit'), { cause: err })
    }
    throw err
  }
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
  password?: string,
): Promise<PageOpResult> {
  const srcDoc = await loadForEditing(bytes, password)
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
 * 선택한 페이지만 담은 새 PDF를 만든다. 원본은 건드리지 않는다.
 *
 * 페이지 CRUD와 달리 `PageOpResult`를 돌려주지 않는다 — 열려 있는 문서를 바꾸는
 * 것이 아니라 사본을 뽑는 것이므로 주석(annotation)을 재배치할 일이 없다.
 *
 * @param pageNums 1-based. 중복은 무시하고 항상 오름차순으로 담는다. 사용자가
 *   Ctrl-클릭한 순서대로 담으면 "3, 1, 2"처럼 문서 순서와 어긋난 PDF가 나온다.
 */
export async function extractPages(
  bytes: ArrayBuffer,
  pageNums: number[],
  password?: string,
): Promise<ArrayBuffer> {
  const srcDoc = await loadForEditing(bytes, password)
  const total = srcDoc.getPageCount()
  const wanted = [...new Set(pageNums)]
    .filter(n => n >= 1 && n <= total)
    .sort((a, b) => a - b)
  if (wanted.length === 0) throw new Error('저장할 페이지를 선택하세요.')

  const newDoc = await PDFDocument.create()
  // copyPages를 한 번에 호출한다. 페이지마다 부르면 공유 리소스(폰트·이미지)가
  // 매번 새로 복사되어 결과 파일이 몇 배로 커진다.
  const copied = await newDoc.copyPages(srcDoc, wanted.map(n => n - 1))
  for (const page of copied) newDoc.addPage(page)
  return toArrayBuffer(await newDoc.save())
}

/**
 * 지정 페이지 뒤에 빈 페이지를 삽입한다.
 * @param afterPage 삽입 위치 (0 = 맨 앞, 1-based). total보다 크면 맨 뒤에 삽입.
 * @returns pageMapping — 삽입된 빈 페이지는 "새 페이지"이므로 키에 없음.
 */
export async function insertBlankPage(
  bytes: ArrayBuffer,
  afterPage: number,
  password?: string,
): Promise<PageOpResult> {
  const srcDoc = await loadForEditing(bytes, password)
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
  password?: string,
): Promise<PageOpResult> {
  const destDoc = await loadForEditing(bytes, password)
  const srcDoc  = await loadForEditing(srcBytes)
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
  password?: string,
): Promise<PageOpResult> {
  const srcDoc = await loadForEditing(bytes, password)
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
