// Saving a PDF with a password on it.
import { describe, it, expect } from 'vitest'
import { PDFDocument } from '@cantoo/pdf-lib'
import { exportPdf } from './pdfExporter'

async function plainPdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  const bytes = await doc.save()
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function saved(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer()
}

describe('exportPdf', () => {
  it('암호를 주지 않으면 그냥 열리는 PDF를 만든다', async () => {
    const out = await saved(await exportPdf(await plainPdf(), []))
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(1)
  })

  it('암호를 주면 그 암호 없이는 열리지 않는다', async () => {
    const out = await saved(await exportPdf(await plainPdf(), [], { password: 'secret123' }))
    // 열쇠 없이 열려고 하면 거절당해야 한다. 이게 실제로 잠겼다는 유일한 증거다.
    await expect(PDFDocument.load(out)).rejects.toThrow()
    const doc = await PDFDocument.load(out, { password: 'secret123' })
    expect(doc.getPageCount()).toBe(1)
  })

  it('틀린 암호로는 열리지 않는다', async () => {
    const out = await saved(await exportPdf(await plainPdf(), [], { password: 'secret123' }))
    await expect(PDFDocument.load(out, { password: 'nope' })).rejects.toThrow()
  })

  it('빈 문자열은 암호를 걸지 않은 것으로 본다', async () => {
    // 취소와 "암호 없음"이 같은 값으로 들어와도 잠긴 빈-암호 파일이 되면 안 된다.
    const out = await saved(await exportPdf(await plainPdf(), [], { password: '' }))
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(1)
  })
})

describe('암호 제거', () => {
  async function lockedPdf(password: string): Promise<ArrayBuffer> {
    const doc = await PDFDocument.create()
    doc.addPage([612, 792])
    doc.encrypt({ userPassword: password, ownerPassword: password })
    const bytes = await doc.save()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }

  it('연 암호로 다시 열어서 암호 없이 저장한다', async () => {
    const locked = await lockedPdf('opensesame')
    const out = await saved(await exportPdf(locked, [], { sourcePassword: 'opensesame' }))
    // 이제 아무 암호 없이 열려야 한다 — 이게 "암호 제거"의 전부다.
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(1)
  })

  it('연 암호와 다른 새 암호로 바꿔 저장할 수 있다', async () => {
    const locked = await lockedPdf('old-one')
    const out = await saved(await exportPdf(locked, [], {
      sourcePassword: 'old-one', password: 'new-one',
    }))
    await expect(PDFDocument.load(out, { password: 'old-one' })).rejects.toThrow()
    const doc = await PDFDocument.load(out, { password: 'new-one' })
    expect(doc.getPageCount()).toBe(1)
  })

  it('암호를 모르면 저장 자체가 실패한다 — 깨진 파일을 쓰지 않는다', async () => {
    const locked = await lockedPdf('opensesame')
    await expect(exportPdf(locked, [], {})).rejects.toThrow()
  })
})

describe('우리가 건 암호를 우리가 다시 푸는 왕복', () => {
  it('암호를 걸어 저장한 파일을 열어 암호를 없애면 다시 편집할 수 있다', async () => {
    // 라이브러리가 암호화한 파일에는 옛 xref 스트림이 원시 바이트로 남는데, 그
    // 바이트에 /Encrypt가 들어 있어서 풀어서 저장한 파일을 pdf-lib이 다시
    // "암호가 걸렸다"고 거절했다. 우리 앱이 만든 파일을 우리 앱이 편집하지 못하는
    // 상황이라, 이 왕복이 실제로 도는지가 유일하게 의미 있는 확인이다.
    const locked = await saved(await exportPdf(await plainPdf(), [], { password: 'round-trip' }))
    const unlocked = await saved(await exportPdf(locked, [], { sourcePassword: 'round-trip' }))
    const doc = await PDFDocument.load(unlocked)
    expect(doc.getPageCount()).toBe(1)
  })
})
