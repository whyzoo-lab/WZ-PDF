import { PDFDocument } from '@cantoo/pdf-lib'
import { loadPdfForWriting } from './pdfLoad'
import { collectGarbage, insertDocument, pruneRemovedPages, setPageOrder } from './pdfStructure'
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
 * Save an edited document without what nothing refers to any more. Every
 * page operation edits the document in place: rebuilding it page by page
 * into a new one (as these did) dropped the bookmarks, the form, named
 * destinations and the document properties, and copied a font or image
 * shared by many pages once per page.
 */
async function saveCompact(doc: PDFDocument): Promise<ArrayBuffer> {
  collectGarbage(doc)
  return toArrayBuffer(await doc.save())
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
  const doc = await loadForEditing(bytes, password)
  const total = doc.getPageCount()
  const deleteSet = new Set(pageNums)
  if (deleteSet.size >= total) {
    throw new Error(t('pdf.cannotDeleteAll'))
  }
  const pageMapping = new Map<number, number>()
  let newPageNum = 1
  for (let i = 1; i <= total; i++) if (!deleteSet.has(i)) pageMapping.set(i, newPageNum++)
  // In place, last first, so the indexes still to come stay right.
  for (let i = total; i >= 1; i--) if (deleteSet.has(i)) doc.removePage(i - 1)
  pruneRemovedPages(doc)
  return { newBytes: await saveCompact(doc), pageMapping }
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
  if (wanted.length === 0) throw new Error(t('pdf.selectPages'))

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
  srcDoc.insertPage(afterPage, [width, height])
  const pageMapping = new Map<number, number>()
  for (let i = 1; i <= total; i++) pageMapping.set(i, i <= afterPage ? i : i + 1)
  return { newBytes: await saveCompact(srcDoc), pageMapping }
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
  /** The inserted file's name: its bookmarks come along under it. */
  srcName?: string,
): Promise<PageOpResult> {
  const destDoc = await loadForEditing(bytes, password)
  const srcDoc  = await loadForEditing(srcBytes)
  const destTotal = destDoc.getPageCount()
  const srcTotal  = srcDoc.getPageCount()
  afterPage = Math.max(0, Math.min(afterPage, destTotal))
  // Into the document itself, not a new one: its bookmarks, form, named
  // destinations and properties stay; the file's links, fields and bookmarks
  // come along working (services/pdfStructure).
  await insertDocument(destDoc, srcDoc, afterPage, (srcName ?? '').replace(/\.pdf$/i, '') || t('pdf.insertedFile'))
  const pageMapping = new Map<number, number>()
  for (let i = 1; i <= destTotal; i++) pageMapping.set(i, i <= afterPage ? i : i + srcTotal)
  return { newBytes: await saveCompact(destDoc), pageMapping }
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
  const doc = await loadForEditing(bytes, password)
  const pages = doc.getPages()
  const pageMapping = new Map<number, number>()
  // The same page objects in a new order, so links, fields and bookmarks
  // still point at them (setPageOrder; pdf-lib cannot reinsert pages into an
  // emptied tree).
  setPageOrder(doc, newOrder.map(n => pages[n - 1]))
  newOrder.forEach((oldPageNum, newIdx) => pageMapping.set(oldPageNum, newIdx + 1))
  return { newBytes: await saveCompact(doc), pageMapping }
}
