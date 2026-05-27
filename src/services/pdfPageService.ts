import { PDFDocument } from 'pdf-lib'

export type PageOpResult = {
  newBytes: ArrayBuffer
  pageMapping: Map<number, number>
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

export async function deletePages(
  bytes: ArrayBuffer,
  pageNums: number[],
): Promise<PageOpResult> {
  const srcDoc = await PDFDocument.load(bytes)
  const total = srcDoc.getPageCount()
  const deleteSet = new Set(pageNums)
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

export async function insertBlankPage(
  bytes: ArrayBuffer,
  afterPage: number,
): Promise<PageOpResult> {
  const srcDoc = await PDFDocument.load(bytes)
  const total = srcDoc.getPageCount()
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
