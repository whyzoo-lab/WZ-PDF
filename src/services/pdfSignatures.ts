// Digital signatures: reading and checking the ones a PDF has, and adding one
// with a certificate file (.pfx / .p12). After PdfCraft's `crates/sign`
// (Apache-2.0/MIT): a signature covers the bytes of the file as it was when
// signed (/ByteRange, everything but the signature itself); anything saved
// after it must be appended (an incremental update), or it no longer covers
// the file. CMS (PKCS #7) is handled by pkijs over WebCrypto.
//
// What "valid" means here: the bytes it covers are unchanged and the signature
// over them verifies with the certificate it carries. Whether that certificate
// belongs to who it names would take a trust list (the AATL, a national CA),
// which this app does not have — so identity is reported as not checked.

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, PDFFont, StandardFonts } from '@cantoo/pdf-lib'
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'

const N = (s: string) => PDFName.of(s)

export interface SignatureInfo {
  /** The signature field's name. */
  field: string
  /** Common name from the certificate, else the signature's /Name. */
  signer: string
  /** From the signed attributes, else /M. */
  signedAt: Date | null
  reason: string
  location: string
  /** 1-based page of a visible signature. */
  page: number | null
  /** The bytes it covers are intact and the signature verifies. */
  status: 'valid' | 'invalid' | 'unknown'
  /** Why it is not valid or could not be checked. */
  problem?: string
  /** It covers the whole file; otherwise changes were saved after it. */
  coversWholeFile: boolean
  /** A certification signature (/DocMDP): 1 no changes, 2 form filling and signing, 3 also comments. */
  certifies: 1 | 2 | 3 | null
  subFilter: string
}

function text(o: unknown): string {
  return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : ''
}

function pdfDateToJs(s: string): Date | null {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(s)
  if (!m) return null
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)
  if (tz === '+' || tz === '-') ms -= (tz === '+' ? 1 : -1) * (+th * 60 + +tm) * 60000
  return new Date(ms)
}

function commonName(cert: pkijs.Certificate | undefined): string {
  const cn = cert?.subject.typesAndValues.find(t => t.type === '2.5.4.3')
  return cn ? String(cn.value.valueBlock.value) : ''
}

/** Signature fields with a value, walking the field tree. */
function signatureFields(doc: PDFDocument): { name: string; field: PDFDict; sig: PDFDict; sigRef?: PDFRef }[] {
  const form = doc.catalog.lookupMaybe(N('AcroForm'), PDFDict)
  const fields = form?.lookupMaybe(N('Fields'), PDFArray)
  const out: { name: string; field: PDFDict; sig: PDFDict; sigRef?: PDFRef }[] = []
  const walk = (ref: unknown, prefix: string, depth: number) => {
    const node = ref instanceof PDFRef ? doc.context.lookup(ref) : ref
    if (!(node instanceof PDFDict) || depth > 32) return
    const t = text(node.get(N('T')))
    const name = t ? (prefix ? `${prefix}.${t}` : t) : prefix
    const kids = node.lookupMaybe(N('Kids'), PDFArray)
    if (node.get(N('FT')) === N('Sig') && node.has(N('V'))) {
      const v = node.get(N('V'))
      const sig = v instanceof PDFRef ? doc.context.lookup(v) : v
      if (sig instanceof PDFDict) out.push({ name, field: node, sig, sigRef: v instanceof PDFRef ? v : undefined })
      return
    }
    for (const k of kids?.asArray() ?? []) walk(k, name, depth + 1)
  }
  for (const f of fields?.asArray() ?? []) walk(f, '', 0)
  return out
}

function pageOfWidget(doc: PDFDocument, field: PDFDict): number | null {
  const pages = doc.getPages()
  const widget = field.get(N('Subtype')) === N('Widget') ? field : field.lookupMaybe(N('Kids'), PDFArray)?.lookup(0)
  // An invisible signature has an empty box: it is on no page anyone can see.
  const rect = widget instanceof PDFDict ? widget.lookupMaybe(N('Rect'), PDFArray)?.asArray().map(n => (n instanceof PDFNumber ? n.asNumber() : 0)) : undefined
  if (!rect || rect.length < 4 || Math.abs(rect[2] - rect[0]) < 1 || Math.abs(rect[3] - rect[1]) < 1) return null
  const p = widget instanceof PDFDict ? widget.get(N('P')) : undefined
  if (p instanceof PDFRef) {
    const i = pages.findIndex(pg => pg.ref === p || pg.ref.toString() === p.toString())
    if (i >= 0) return i + 1
  }
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.Annots()
    if (annots?.asArray().some(a => a instanceof PDFRef && doc.context.lookup(a) === widget)) return i + 1
  }
  return null
}

function docMdpPermissions(doc: PDFDocument, sig: PDFDict): 1 | 2 | 3 | null {
  const refs = sig.lookupMaybe(N('Reference'), PDFArray)
  for (const r of refs?.asArray() ?? []) {
    const ref = r instanceof PDFRef ? doc.context.lookup(r) : r
    if (!(ref instanceof PDFDict) || ref.get(N('TransformMethod')) !== N('DocMDP')) continue
    const p = ref.lookupMaybe(N('TransformParams'), PDFDict)?.get(N('P'))
    const n = p instanceof PDFNumber ? p.asNumber() : 2
    return (n === 1 || n === 3 ? n : 2) as 1 | 2 | 3
  }
  return null
}

function bytesOfContents(sig: PDFDict): Uint8Array | null {
  const c = sig.get(N('Contents'))
  if (c instanceof PDFHexString || c instanceof PDFString) return c.asBytes()
  return null
}

/** The bytes a /ByteRange covers. */
function covered(file: Uint8Array, range: number[]): Uint8Array | null {
  if (range.length !== 4 || range.some(n => !Number.isInteger(n) || n < 0)) return null
  const [a, b, c, d] = range
  if (a + b > file.length || c + d > file.length || c < a + b) return null
  const out = new Uint8Array(b + d)
  out.set(file.subarray(a, a + b), 0)
  out.set(file.subarray(c, c + d), b)
  return out
}

/** CMS bytes without the zero padding the placeholder leaves after them. */
function trimDer(bytes: Uint8Array): ArrayBuffer {
  let end = bytes.length
  if (bytes[0] === 0x30 && bytes.length > 2) {
    // Definite length: tag, then length octets.
    const l = bytes[1]
    if (l < 0x80) end = 2 + l
    else {
      const n = l & 0x7f
      let len = 0
      for (let i = 0; i < n; i++) len = len * 256 + bytes[2 + i]
      end = 2 + n + len
    }
  }
  return bytes.slice(0, Math.min(end, bytes.length)).buffer as ArrayBuffer
}

async function verifyOne(file: Uint8Array, sig: PDFDict): Promise<Pick<SignatureInfo, 'status' | 'problem' | 'signer' | 'signedAt'>> {
  const range = sig.lookupMaybe(N('ByteRange'), PDFArray)?.asArray().map(n => (n instanceof PDFNumber ? n.asNumber() : NaN)) ?? []
  const data = covered(file, range)
  const contents = bytesOfContents(sig)
  if (!data || !contents) return { status: 'invalid', problem: 'range', signer: '', signedAt: null }
  try {
    const cms = pkijs.ContentInfo.fromBER(trimDer(contents))
    const signed = new pkijs.SignedData({ schema: cms.content })
    const signerCert = signed.certificates?.find((c): c is pkijs.Certificate => c instanceof pkijs.Certificate &&
      signed.signerInfos[0]?.sid instanceof pkijs.IssuerAndSerialNumber &&
      c.serialNumber.isEqual(signed.signerInfos[0].sid.serialNumber))
      ?? signed.certificates?.find((c): c is pkijs.Certificate => c instanceof pkijs.Certificate)
    const timeAttr = signed.signerInfos[0]?.signedAttrs?.attributes.find(a => a.type === '1.2.840.113549.1.9.5')
    const signedAt = timeAttr ? (timeAttr.values[0] as asn1js.UTCTime).toDate?.() ?? null : null
    const subFilter = text(sig.get(N('SubFilter')))
    let ok: boolean
    if (subFilter === 'adbe.pkcs7.sha1' && signed.encapContentInfo.eContent) {
      // The SHA-1 of the covered bytes is the signed content.
      ok = await signed.verify({ signer: 0, checkChain: false })
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data as Uint8Array<ArrayBuffer>))
      const inside = new Uint8Array(signed.encapContentInfo.eContent.valueBlock.valueHexView)
      ok = ok && digest.length === inside.length && digest.every((v, i) => v === inside[i])
    } else {
      ok = await signed.verify({ signer: 0, data: data.buffer as ArrayBuffer, checkChain: false })
    }
    return { status: ok ? 'valid' : 'invalid', problem: ok ? undefined : 'changed', signer: commonName(signerCert), signedAt }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // A digest that does not match is a changed document, not an unreadable signature.
    if (/digest|messageDigest|not equal|signature/i.test(message)) return { status: 'invalid', problem: 'changed', signer: '', signedAt: null }
    return { status: 'unknown', problem: message, signer: '', signedAt: null }
  }
}

/** Every signature in the file, checked. Empty for an unsigned (or unreadable) file. */
export async function readSignatures(bytes: Uint8Array): Promise<SignatureInfo[]> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  } catch {
    return []
  }
  const out: SignatureInfo[] = []
  for (const { name, field, sig } of signatureFields(doc)) {
    const range = sig.lookupMaybe(N('ByteRange'), PDFArray)?.asArray().map(n => (n instanceof PDFNumber ? n.asNumber() : 0)) ?? []
    const checked = await verifyOne(bytes, sig)
    out.push({
      field: name,
      signer: checked.signer || text(sig.get(N('Name'))) || name,
      signedAt: checked.signedAt ?? pdfDateToJs(text(sig.get(N('M')))),
      reason: text(sig.get(N('Reason'))),
      location: text(sig.get(N('Location'))),
      page: pageOfWidget(doc, field),
      status: checked.status,
      problem: checked.problem,
      coversWholeFile: range.length === 4 && range[2] + range[3] >= trimmedLength(bytes),
      certifies: docMdpPermissions(doc, sig),
      subFilter: text(sig.get(N('SubFilter'))),
    })
  }
  return out
}

/** The file's length without trailing whitespace after %%EOF. */
function trimmedLength(bytes: Uint8Array): number {
  let n = bytes.length
  while (n > 0 && (bytes[n - 1] === 0x0a || bytes[n - 1] === 0x0d || bytes[n - 1] === 0x20 || bytes[n - 1] === 0x00)) n--
  return n
}

// ── Signing ─────────────────────────────────────────────────────────────────

export interface SigningKey {
  privateKey: CryptoKey
  /** The signer's certificate first, then any chain the file carried. */
  certificates: pkijs.Certificate[]
  /** Common name of the signer. */
  name: string
}

export class CertificateFileError extends Error {
  readonly kind: 'password' | 'unsupported' | 'nokey'
  constructor(kind: 'password' | 'unsupported' | 'nokey', message: string) {
    super(message)
    this.kind = kind
  }
}

/**
 * The key and certificates in a .pfx / .p12 file. Files protected with
 * PBES2 (AES — what OpenSSL 3 and current Windows write) open here; the old
 * TripleDES/RC2 kind needs a re-export with AES, since WebCrypto has no DES.
 */
export async function readPfx(file: ArrayBuffer, password: string): Promise<SigningKey> {
  const pwd = new TextEncoder().encode(password).buffer as ArrayBuffer
  let pfx: pkijs.PFX
  try { pfx = pkijs.PFX.fromBER(file) } catch { throw new CertificateFileError('unsupported', 'not a certificate file') }
  try {
    await pfx.parseInternalValues({ password: pwd, checkIntegrity: true })
  } catch (err) {
    throw new CertificateFileError(/integrity|mac|password/i.test(String(err)) ? 'password' : 'unsupported', String(err))
  }
  const safe = pfx.parsedValue?.authenticatedSafe
  if (!safe) throw new CertificateFileError('unsupported', 'no contents')
  try {
    await safe.parseInternalValues({ safeContents: safe.safeContents.map(() => ({ password: pwd })) })
  } catch (err) {
    throw new CertificateFileError(/password|decrypt|operation/i.test(String(err)) ? 'password' : 'unsupported', String(err))
  }
  let keyInfo: pkijs.PrivateKeyInfo | null = null
  const certs: pkijs.Certificate[] = []
  for (const contents of safe.parsedValue?.safeContents ?? []) {
    for (const bag of contents.value.safeBags) {
      if (bag.bagValue instanceof pkijs.PKCS8ShroudedKeyBag) {
        await bag.bagValue.parseInternalValues({ password: pwd })
        keyInfo = bag.bagValue.parsedValue ?? null
      } else if (bag.bagValue instanceof pkijs.PrivateKeyInfo) {
        keyInfo = bag.bagValue
      } else if (bag.bagValue instanceof pkijs.CertBag && bag.bagValue.parsedValue instanceof pkijs.Certificate) {
        certs.push(bag.bagValue.parsedValue)
      }
    }
  }
  if (!keyInfo || certs.length === 0) throw new CertificateFileError('nokey', 'no key or certificate')
  const algorithm = keyInfo.privateKeyAlgorithm.algorithmId
  const der = keyInfo.toSchema().toBER(false)
  let privateKey: CryptoKey
  if (algorithm === '1.2.840.113549.1.1.1') {
    privateKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  } else if (algorithm === '1.2.840.10045.2.1') {
    const curveOid = (keyInfo.privateKeyAlgorithm.algorithmParams as asn1js.ObjectIdentifier | undefined)?.valueBlock.toString()
    const namedCurve = curveOid === '1.3.132.0.34' ? 'P-384' : curveOid === '1.3.132.0.35' ? 'P-521' : 'P-256'
    privateKey = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve }, false, ['sign'])
  } else {
    throw new CertificateFileError('unsupported', `key algorithm ${algorithm}`)
  }
  // The signer's certificate is the one whose public key matches the key; with
  // one key in the file, the end-entity (not a CA) is a good guess.
  const leaf = certs.find(c => !c.extensions?.some(e => e.extnID === '2.5.29.19' && (e.parsedValue as pkijs.BasicConstraints | undefined)?.cA)) ?? certs[0]
  return { privateKey, certificates: [leaf, ...certs.filter(c => c !== leaf)], name: commonName(leaf) }
}

export interface SignOptions {
  key: SigningKey
  reason?: string
  location?: string
  /** A visible signature: 1-based page and box in viewport points. Absent = invisible. */
  visible?: { page: number; rect: { x: number; y: number; width: number; height: number }; lines: string[]; font?: PDFFont }
  /** For the Korean text of a visible signature. */
  embedFont?: (doc: PDFDocument) => Promise<PDFFont>
  now?: Date
}

/** Room reserved for the signature: certificates and a timestamp fit in 16 KB. */
const SIG_BYTES = 16384
const RANGE_PLACEHOLDER = '/**********'

/**
 * Sign the file. It is loaded for an incremental update, so the bytes it had
 * — and any signatures already in them — stay exactly as they were.
 */
export async function signPdf(bytes: Uint8Array, opts: SignOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { forIncrementalUpdate: true, updateMetadata: false })
  if (doc.isEncrypted) throw new Error('encrypted')
  const ctx = doc.context
  const now = opts.now ?? new Date()
  const pdfNow = `D:${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`

  const sig = ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
    ByteRange: [0, N(RANGE_PLACEHOLDER.slice(1)), N(RANGE_PLACEHOLDER.slice(1)), N(RANGE_PLACEHOLDER.slice(1))],
    M: PDFString.of(pdfNow),
  }) as PDFDict
  sig.set(N('Contents'), PDFHexString.of('0'.repeat(SIG_BYTES * 2)))
  sig.set(N('Name'), PDFHexString.fromText(opts.key.name))
  if (opts.reason) sig.set(N('Reason'), PDFHexString.fromText(opts.reason))
  if (opts.location) sig.set(N('Location'), PDFHexString.fromText(opts.location))
  const sigRef = ctx.register(sig)

  // The field, merged with its widget.
  const form = doc.catalog.getOrCreateAcroForm().dict
  let fields = form.lookupMaybe(N('Fields'), PDFArray)
  if (!fields) { fields = ctx.obj([]); form.set(N('Fields'), fields) }
  const taken = new Set(signatureFields(doc).map(f => f.name))
  let n = 1
  while (taken.has(`Signature${n}`)) n++
  const pages = doc.getPages()
  const pageNo = opts.visible ? Math.min(Math.max(opts.visible.page, 1), pages.length) : 1
  const page = pages[pageNo - 1]
  const widget = ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', F: 132 /* Print, Locked */, P: page.ref }) as PDFDict
  widget.set(N('T'), PDFHexString.fromText(`Signature${n}`))
  widget.set(N('V'), sigRef)
  if (opts.visible) {
    const { pageSpaceOf, viewportToPdf } = await import('./pdfComments')
    const space = pageSpaceOf(page)
    const r = opts.visible.rect
    const a = viewportToPdf(space, r.x, r.y), b = viewportToPdf(space, r.x + r.width, r.y + r.height)
    const rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
    widget.set(N('Rect'), ctx.obj(rect))
    const korean = opts.visible.lines.some(l => [...l].some(c => c.charCodeAt(0) > 0xff))
    const font = korean && opts.embedFont ? await opts.embedFont(doc) : await doc.embedFont(StandardFonts.Helvetica)
    widget.set(N('AP'), ctx.obj({ N: appearance(doc, font, rect[2] - rect[0], rect[3] - rect[1], opts.visible.lines, space.rotate) }))
  } else {
    widget.set(N('Rect'), ctx.obj([0, 0, 0, 0]))
  }
  const widgetRef = ctx.register(widget)
  fields.push(widgetRef)
  page.node.addAnnot(widgetRef)
  form.set(N('SigFlags'), PDFNumber.of(3))

  // Plain objects (no object streams), so the placeholders can be found and filled.
  const saved = await doc.save({ useObjectStreams: false })
  return fillSignature(saved, opts.key, now)
}

/** The visible signature's look: a light box with the lines of text. */
function appearance(doc: PDFDocument, font: PDFFont, w: number, h: number, lines: string[], rotate: number): PDFRef {
  const size = Math.max(5, Math.min(12, (h - 6) / Math.max(1, lines.length) / 1.25, ...lines.map(l => (w - 8) / Math.max(1, font.widthOfTextAtSize(l, 1)))))
  // On a turned page the box is turned too; the text should read upright.
  const turned = rotate === 90 || rotate === 270
  const bw = turned ? h : w, bh = turned ? w : h
  const m = rotate === 90 ? `0 1 -1 0 ${w} 0 cm` : rotate === 180 ? `-1 0 0 -1 ${w} ${h} cm` : rotate === 270 ? `0 -1 1 0 0 ${h} cm` : ''
  const ops = [`q ${m}`, '0.96 0.97 1 rg 0.15 0.39 0.92 RG 0.8 w', `0.4 0.4 ${bw - 0.8} ${bh - 0.8} re B`, 'BT 0.1 0.1 0.2 rg']
  lines.forEach((line, i) => {
    const y = bh - 4 - size * (i + 1) * 1.2 + size * 0.25
    ops.push(`/F1 ${size.toFixed(2)} Tf 1 0 0 1 4 ${y.toFixed(2)} Tm ${font.encodeText(line).toString()} Tj`)
  })
  ops.push('ET Q')
  return doc.context.register(doc.context.stream(ops.join('\n'), {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: { Font: { F1: font.ref } },
  }))
}

function indexOfBytes(hay: Uint8Array, needle: string, from = hay.length): number {
  const n = new TextEncoder().encode(needle)
  outer: for (let i = Math.min(from, hay.length - n.length); i >= 0; i--) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer
    return i
  }
  return -1
}

/** Find the placeholders of the last signature, cover the rest of the file, sign, and write the signature in. */
async function fillSignature(file: Uint8Array, key: SigningKey, now: Date): Promise<Uint8Array> {
  const out = file.slice()
  // As pdf-lib writes an array: "[ 0 /a /b /c ]".
  const rangeText = `[ 0 ${RANGE_PLACEHOLDER} ${RANGE_PLACEHOLDER} ${RANGE_PLACEHOLDER} ]`
  const rangeAt = indexOfBytes(out, rangeText)
  const zeros = '<' + '0'.repeat(SIG_BYTES * 2) + '>'
  const contentsAt = indexOfBytes(out, zeros)
  if (rangeAt < 0 || contentsAt < 0) throw new Error('signature placeholder not found')
  const start = contentsAt, end = contentsAt + zeros.length
  const range = [0, start, end, out.length - end]
  const written = `[${range.join(' ')}]`
  if (written.length > rangeText.length) throw new Error('file too large to sign')
  out.set(new TextEncoder().encode(written.padEnd(rangeText.length, ' ')), rangeAt)

  const data = new Uint8Array(start + (out.length - end))
  data.set(out.subarray(0, start), 0)
  data.set(out.subarray(end), start)
  const cms = await buildCms(data, key, now)
  const hex = Array.from(new Uint8Array(cms), b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  if (hex.length > SIG_BYTES * 2) throw new Error('signature too large')
  out.set(new TextEncoder().encode(hex.padEnd(SIG_BYTES * 2, '0')), start + 1)
  return out
}

async function buildCms(data: Uint8Array, key: SigningKey, now: Date): Promise<ArrayBuffer> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  const signer = key.certificates[0]
  const signed = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: '1.2.840.113549.1.7.1' }),
    signerInfos: [new pkijs.SignerInfo({
      version: 1,
      sid: new pkijs.IssuerAndSerialNumber({ issuer: signer.issuer, serialNumber: signer.serialNumber }),
      signedAttrs: new pkijs.SignedAndUnsignedAttributes({
        type: 0,
        attributes: [
          new pkijs.Attribute({ type: '1.2.840.113549.1.9.3', values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.7.1' })] }),
          new pkijs.Attribute({ type: '1.2.840.113549.1.9.5', values: [new asn1js.UTCTime({ valueDate: now })] }),
          new pkijs.Attribute({ type: '1.2.840.113549.1.9.4', values: [new asn1js.OctetString({ valueHex: digest })] }),
        ],
      }),
    })],
    certificates: key.certificates,
  })
  await signed.sign(key.privateKey, 0, 'SHA-256', data as Uint8Array<ArrayBuffer>)
  const info = new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: signed.toSchema(true) })
  return info.toSchema().toBER(false)
}
