import { describe, it, expect } from 'vitest'
import { reducePresentTool, arrowHead, spotZoomStyle, DEFAULT_TOOL_STATE, MIN_PEN_WIDTH, MAX_PEN_WIDTH } from './presentTools'

describe('reducePresentTool', () => {
  it('maps tool letters to tool kinds (case-insensitive)', () => {
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'p')?.kind).toBe('pen')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'H')?.kind).toBe('highlighter')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'r')?.kind).toBe('rect')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'a')?.kind).toBe('arrow')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'l')?.kind).toBe('laser')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'z')?.kind).toBe('zoom')
  })

  it('toggles the active tool off when its key is pressed again', () => {
    const pen = reducePresentTool(DEFAULT_TOOL_STATE, 'p')!
    expect(reducePresentTool(pen, 'p')?.kind).toBeNull()
  })

  it('maps number keys 1-5 to colors', () => {
    expect(reducePresentTool(DEFAULT_TOOL_STATE, '2')?.color).toBe('#22c55e')
    expect(reducePresentTool(DEFAULT_TOOL_STATE, '5')?.color).toBe('#f97316')
  })

  it('adjusts and clamps width with [ and ]', () => {
    const wide = reducePresentTool({ ...DEFAULT_TOOL_STATE, width: MAX_PEN_WIDTH }, ']')!
    expect(wide.width).toBe(MAX_PEN_WIDTH)
    const thin = reducePresentTool({ ...DEFAULT_TOOL_STATE, width: MIN_PEN_WIDTH }, '[')!
    expect(thin.width).toBe(MIN_PEN_WIDTH)
    expect(reducePresentTool({ ...DEFAULT_TOOL_STATE, width: 8 }, '[')!.width).toBe(6)
  })

  it('returns null for keys it does not handle', () => {
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'q')).toBeNull()
    expect(reducePresentTool(DEFAULT_TOOL_STATE, 'ArrowRight')).toBeNull()
  })
})

describe('arrowHead', () => {
  it('returns three points with the tip at (x2,y2)', () => {
    const pts = arrowHead(0, 0, 10, 0, 6)
    expect(pts).toHaveLength(3)
    expect(pts[0]).toEqual([10, 0]) // tip
    expect(pts[1][0]).toBeLessThan(10) // barbs are behind the tip
    expect(pts[2][0]).toBeLessThan(10)
  })

  it('degenerates safely for a zero-length arrow', () => {
    expect(arrowHead(5, 5, 5, 5, 6)).toEqual([[5, 5], [5, 5], [5, 5]])
  })
})

describe('spotZoomStyle', () => {
  it('builds a scale transform anchored at the focal point', () => {
    expect(spotZoomStyle(2, 100, 200)).toEqual({ transform: 'scale(2)', transformOrigin: '100px 200px' })
  })
})
