import { describe, it, expect, vi } from 'vitest'
import { drawAnnotations } from './annotationCanvas'
import type { Annotation } from '../types/annotation'

function recordingContext(width = 300, height = 400) {
  const calls: string[] = []
  const ctx = new Proxy({ canvas: { width, height } } as Record<string, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop as string]
      return (...args: unknown[]) => { calls.push(`${String(prop)}(${args.map(a => typeof a === 'number' ? Math.round(a) : String(a)).join(',')})`) }
    },
    set(target, prop, value) { calls.push(`${String(prop)}=${value}`); target[prop as string] = value; return true },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const base = { page: 1, x: 10, y: 20, width: 100, height: 30, rotation: 0 }

describe('drawAnnotations', () => {
  it('draws lasting annotations at the canvas scale and skips volatile markups', async () => {
    const annotations = [
      { ...base, id: 'p', type: 'pen', points: [0, 0, 5, 5], color: '#ff0', strokeWidth: 2, opacity: 1 },
      { ...base, id: 'r', type: 'rectangle', color: '#f00', strokeWidth: 2 },
      { ...base, id: 't', type: 'textEdit', text: '수정됨', fontSize: 12, color: '#000', background: '#fff' },
      { ...base, id: 'w', type: 'watermark', text: '대외비', fontSize: 40, color: '#f00', opacity: 0.3, allPages: true },
    ] as unknown as Annotation[]
    const { ctx, calls } = recordingContext()
    await drawAnnotations(ctx, annotations, 1, 2)

    // textEdit: the covering box and the new text, both at 2x.
    expect(calls).toContain('fillRect(20,40,200,60)')
    expect(calls).toContain('fillText(수정됨,22,42)')
    // watermark: centred on the canvas.
    expect(calls).toContain('translate(150,200)')
    expect(calls).toContain('fillText(대외비,0,0)')
    // Nothing from pen/rectangle: neither strokes nor lines.
    expect(calls.some(c => /^(stroke|lineTo|moveTo)\(/.test(c))).toBe(false)
  })

  it('leaves out a stamp whose image will not decode instead of failing the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stamp = { ...base, id: 's', type: 'stamp', src: 'data:image/png;base64,broken' } as unknown as Annotation
    const { ctx, calls } = recordingContext()
    const OriginalImage = globalThis.Image
    globalThis.Image = class { onerror: (() => void) | null = null; set src(_v: string) { queueMicrotask(() => this.onerror?.()) } } as never
    try {
      await expect(drawAnnotations(ctx, [stamp], 1, 1)).resolves.toBeUndefined()
      expect(calls.some(c => c.startsWith('drawImage'))).toBe(false)
    } finally {
      globalThis.Image = OriginalImage
    }
  })
})
