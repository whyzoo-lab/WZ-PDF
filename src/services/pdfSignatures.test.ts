// @vitest-environment node
//
// Signing and checking signatures, with throwaway test certificates
// (__fixtures__/test-signer*.p12, self-signed, password "test1234", made with
// OpenSSL 3 — AES-256 / PBKDF2, as current tools write them).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { readPfx, readSignatures, signPdf, CertificateFileError } from './pdfSignatures'
import { exportPdf } from './pdfExporter'
import type { Annotation } from '../types/annotation'

const fixture = (name: string) => {
  const b = readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

async function contract(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([400, 300]).drawText('Agreement between A and B', { x: 30, y: 250, size: 14, font })
  return doc.save()
}

describe('certificate files', () => {
  it('opens an RSA and an EC key with their certificate', async () => {
    const rsa = await readPfx(fixture('test-signer.p12'), 'test1234')
    expect(rsa.name).toBe('Test Signer')
    expect(rsa.privateKey.algorithm.name).toBe('RSASSA-PKCS1-v1_5')
    const ec = await readPfx(fixture('test-signer-ec.p12'), 'test1234')
    expect(ec.name).toBe('EC Signer')
    expect(ec.privateKey.algorithm.name).toBe('ECDSA')
  })

  it('says when the password is wrong', async () => {
    await expect(readPfx(fixture('test-signer.p12'), 'nope')).rejects.toMatchObject({ kind: 'password' })
    await expect(readPfx(new ArrayBuffer(8), 'x')).rejects.toBeInstanceOf(CertificateFileError)
  })
})

describe('signing', () => {
  it('signs, and the signature checks out and covers the file', async () => {
    const key = await readPfx(fixture('test-signer.p12'), 'test1234')
    const signed = await signPdf(await contract(), { key, reason: '계약 승인', location: 'Seoul' })
    const [sig] = await readSignatures(signed)
    expect(sig).toMatchObject({ signer: 'Test Signer', status: 'valid', coversWholeFile: true, reason: '계약 승인', location: 'Seoul', subFilter: 'adbe.pkcs7.detached' })
    expect(sig.signedAt).toBeInstanceOf(Date)
  })

  it('keeps the first signature when a second is added (incremental update)', async () => {
    const rsa = await readPfx(fixture('test-signer.p12'), 'test1234')
    const ec = await readPfx(fixture('test-signer-ec.p12'), 'test1234')
    const once = await signPdf(await contract(), { key: rsa })
    const twice = await signPdf(once, { key: ec, visible: { page: 1, rect: { x: 200, y: 200, width: 160, height: 50 }, lines: ['Signed by EC Signer', '2026-10-17'] } })
    // The first file is the start of the second, byte for byte.
    expect(Buffer.from(twice.subarray(0, once.length)).equals(Buffer.from(once))).toBe(true)
    const sigs = await readSignatures(twice)
    expect(sigs.map(s => [s.signer, s.status, s.coversWholeFile])).toEqual([
      ['Test Signer', 'valid', false],
      ['EC Signer', 'valid', true],
    ])
    expect(sigs[1].page).toBe(1)
  })

  it('reports a file changed after signing as invalid', async () => {
    const key = await readPfx(fixture('test-signer.p12'), 'test1234')
    const signed = await signPdf(await contract(), { key })
    const tampered = signed.slice()
    // Flip one bit inside what the signature covers (page content is compressed,
    // so any byte of it will do).
    const at = Buffer.from(tampered).indexOf('stream') + 20
    tampered[at] ^= 1
    const [sig] = await readSignatures(tampered)
    expect(sig.status).toBe('invalid')
  })

  it('finds no signatures in an unsigned file', async () => {
    expect(await readSignatures(await contract())).toEqual([])
  })
})

describe('saving a signed file', () => {
  it('appends the changes, so the signature still covers what was signed', async () => {
    const key = await readPfx(fixture('test-signer.p12'), 'test1234')
    const signed = await signPdf(await contract(), { key })
    const note: Annotation = { id: 'n', type: 'note', page: 1, x: 300, y: 40, width: 20, height: 20, rotation: 0, color: '#FFC21A', contents: 'ok', author: 'B', createdAt: 0, replies: [] }
    const saved = new Uint8Array(await (await exportPdf(signed.buffer.slice(0) as ArrayBuffer, [note])).arrayBuffer())
    expect(Buffer.from(saved.subarray(0, signed.length)).equals(Buffer.from(signed))).toBe(true)
    const [sig] = await readSignatures(saved)
    expect(sig).toMatchObject({ status: 'valid', coversWholeFile: false })
  })
})
