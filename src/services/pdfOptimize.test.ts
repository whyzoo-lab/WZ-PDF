// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { deflateSync } from 'node:zlib'
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from '@cantoo/pdf-lib'
import { imageUses, optimizePdf, scanContent, PRESETS, type ImageCodec } from './pdfOptimize'

const N = (s: string) => PDFName.of(s)

/** A noisy RGB image (so Flate cannot shrink it much), as an image XObject. */
function noisyImage(doc: PDFDocument, w: number, h: number): PDFRef {
  const raw = new Uint8Array(w * h * 3)
  let s = 12345
  for (let i = 0; i < raw.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; raw[i] = s & 0xff }
  return doc.context.register(doc.context.flateStream(raw, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }))
}

async function sample(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create()
  const img = noisyImage(doc, 600, 600)
  // The same picture embedded a second time (as inserting a file can leave it).
  const twin = noisyImage(doc, 600, 600)
  for (const [ref, size] of [[img, 144], [twin, 144]] as const) {
    const page = doc.addPage([400, 400])
    page.node.set(N('Resources'), doc.context.obj({ XObject: { Im1: ref } }))
    // Drawn 144 pt (2 in) wide: 600 px over 2 in = 300 ppi. An uncompressed content stream.
    const content = doc.context.stream(`q ${size} 0 0 ${size} 50 50 cm /Im1 Do Q\n` + '% padding to compress\n'.repeat(20))
    page.node.set(N('Contents'), doc.context.register(content))
  }
  const bytes = await doc.save({ useObjectStreams: false })
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('reading content', () => {
  it('finds operators past strings, dictionaries and inline images', () => {
    const ops = scanContent(new TextEncoder().encode('BT (a Do\\) (nested (x)) z) Tj ET q 1 0 0 1 5 5 cm BI /W 1 /H 1 ID \x00EI\x01 EI Q /P <</MCID 3>> BDC EMC'))
    expect(ops.map(o => o.op)).toEqual(['BT', 'Tj', 'ET', 'q', 'cm', 'BI', 'Q', 'BDC', 'EMC'])
    expect(ops[4].args).toEqual([1, 0, 0, 1, 5, 5])
  })

  it('measures where pages draw each image', async () => {
    const doc = await PDFDocument.load(await sample())
    const uses = [...imageUses(doc).values()]
    expect(uses).toEqual([{ w: 144, h: 144 }, { w: 144, h: 144 }])
  })
})

describe('optimizing', () => {
  const codec = (): ImageCodec & { calls: unknown[] } => {
    const calls: unknown[] = []
    return {
      calls,
      resample: vi.fn(async (input, w, h, q) => { calls.push({ w, h, q, jpeg: 'jpeg' in input }); return new Uint8Array(5000).fill(7) }),
    }
  }

  it('resamples images above the threshold, merges the twin, compresses plain streams', async () => {
    const src = await sample()
    const c = codec()
    const { bytes, report } = await optimizePdf(src, PRESETS.standard, c)
    // 300 ppi > 225 → 150 ppi: 600 px becomes 300.
    expect(c.calls).toContainEqual({ w: 300, h: 300, q: 0.75, jpeg: false })
    expect(report.imagesResampled).toBeGreaterThan(0)
    expect(report.objectsMerged).toBeGreaterThan(0)
    expect(report.after).toBeLessThan(report.before / 10)
    const back = await PDFDocument.load(bytes)
    const refs = back.getPages().map(p => String(p.node.Resources()!.lookup(N('XObject'), PDFDict).get(N('Im1'))))
    expect(refs[0]).toBe(refs[1]) // one image, drawn on both pages
    const img = back.context.lookup(back.getPages()[0].node.Resources()!.lookup(N('XObject'), PDFDict).get(N('Im1')) as PDFRef) as PDFRawStream
    expect(String(img.dict.get(N('Filter')))).toBe('/DCTDecode')
    expect(String(img.dict.get(N('Width')))).toBe('300')
    const content = back.context.lookup(back.getPages()[0].node.get(N('Contents')) as PDFRef) as PDFRawStream
    expect(String(content.dict.get(N('Filter')))).toBe('/FlateDecode')
  })

  it('leaves an image alone when the result would not be smaller', async () => {
    const big: ImageCodec = { resample: async () => new Uint8Array(5_000_000) }
    const { report } = await optimizePdf(await sample(), PRESETS.standard, big)
    expect(report.imagesResampled).toBe(0)
  })

  it('leaves images drawn at their resolution alone', async () => {
    const c = codec()
    await optimizePdf(await sample(), { above: 400, target: 150, quality: 0.75 }, c)
    expect(c.calls).toEqual([])
  })

  it('keeps a flate image with a predictor as it is', async () => {
    const doc = await PDFDocument.create()
    const raw = deflateSync(Buffer.alloc(10 * 10 * 3 + 10, 1))
    const ref = doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 10, Height: 10, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode', DecodeParms: { Predictor: 15, Colors: 3, Columns: 10 } }) as PDFDict, raw))
    const page = doc.addPage([100, 100])
    page.node.set(N('Resources'), doc.context.obj({ XObject: { Im1: ref } }))
    page.node.set(N('Contents'), doc.context.register(doc.context.stream('q 1 0 0 1 0 0 cm /Im1 Do Q')))
    const bytes = await doc.save()
    const c = codec()
    await optimizePdf(bytes.buffer.slice(0) as ArrayBuffer, PRESETS.screen, c)
    expect(c.calls).toEqual([])
  })
})
