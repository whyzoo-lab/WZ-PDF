import { describe, it, expect } from 'vitest'
import {
  toScreenCoords,
  toStoredCoords,
  toScreenSize,
  toPdfLibY,
  hexToRgb,
} from '../coordinates'

describe('toScreenCoords', () => {
  it('scales stored coords by zoom', () => {
    expect(toScreenCoords(100, 150, 2)).toEqual({ x: 200, y: 300 })
  })
  it('returns same value at zoom=1', () => {
    expect(toScreenCoords(100, 150, 1)).toEqual({ x: 100, y: 150 })
  })
})

describe('toStoredCoords', () => {
  it('divides screen coords by zoom', () => {
    expect(toStoredCoords(200, 300, 2)).toEqual({ x: 100, y: 150 })
  })
})

describe('toScreenSize', () => {
  it('scales dimensions by zoom', () => {
    expect(toScreenSize(50, 30, 2)).toEqual({ width: 100, height: 60 })
  })
})

describe('toPdfLibY', () => {
  it('converts top-left origin to bottom-left origin', () => {
    // pageHeight=800, pdfJsY=100, pdfHeight=50 → 800-100-50=650
    expect(toPdfLibY(100, 50, 800)).toBe(650)
  })
  it('handles top-aligned element', () => {
    expect(toPdfLibY(0, 50, 800)).toBe(750)
  })
})

describe('hexToRgb', () => {
  it('converts red', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0])
  })
  it('converts black', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
  })
  it('converts white', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1])
  })
  it('converts mid-gray', () => {
    const [r] = hexToRgb('#888888')
    expect(r).toBeCloseTo(0.533, 2)
  })
})
