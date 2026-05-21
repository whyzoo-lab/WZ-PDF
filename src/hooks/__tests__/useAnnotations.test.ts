import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAnnotations } from '../useAnnotations'
import type { StampAnnotation } from '../../types/annotation'

const makeStamp = (page = 1): Omit<StampAnnotation, 'id'> => ({
  type: 'stamp',
  page,
  x: 10,
  y: 10,
  width: 100,
  height: 40,
  rotation: 0,
  src: 'data:image/png;base64,abc',
})

describe('useAnnotations', () => {
  it('initialises with empty state', () => {
    const { result } = renderHook(() => useAnnotations())
    expect(result.current.annotations).toHaveLength(0)
    expect(result.current.selectedId).toBeNull()
    expect(result.current.activeMode).toBeNull()
  })

  it('addAnnotation adds annotation and selects it', () => {
    const { result } = renderHook(() => useAnnotations())
    let id!: string
    act(() => { id = result.current.addAnnotation(makeStamp()) })
    expect(result.current.annotations).toHaveLength(1)
    expect(result.current.annotations[0].id).toBe(id)
    expect(result.current.selectedId).toBe(id)
    expect(result.current.activeMode).toBe('select')
  })

  it('removeAnnotation removes the annotation', () => {
    const { result } = renderHook(() => useAnnotations())
    let id!: string
    act(() => { id = result.current.addAnnotation(makeStamp()) })
    act(() => { result.current.removeAnnotation(id) })
    expect(result.current.annotations).toHaveLength(0)
    expect(result.current.selectedId).toBeNull()
  })

  it('updateAnnotation updates matching annotation only', () => {
    const { result } = renderHook(() => useAnnotations())
    let id!: string
    act(() => { id = result.current.addAnnotation(makeStamp()) })
    act(() => { result.current.updateAnnotation(id, { x: 99 }) })
    expect(result.current.annotations[0].x).toBe(99)
  })

  it('setActiveMode clears selectedId', () => {
    const { result } = renderHook(() => useAnnotations())
    let id!: string
    act(() => { id = result.current.addAnnotation(makeStamp()) })
    expect(result.current.selectedId).toBe(id)
    act(() => { result.current.setActiveMode('stamp') })
    expect(result.current.selectedId).toBeNull()
  })
})
