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

  it('remapAnnotations: 매핑된 페이지 번호로 어노테이션을 이동시킨다', () => {
    const { result } = renderHook(() => useAnnotations())
    let id1!: string, id2!: string, id3!: string
    act(() => { id1 = result.current.addAnnotation(makeStamp(1)) })
    act(() => { id2 = result.current.addAnnotation(makeStamp(2)) })
    act(() => { id3 = result.current.addAnnotation(makeStamp(3)) })

    // 2번 페이지 삭제: {1→1, 3→2}
    const mapping = new Map([[1, 1], [3, 2]])
    act(() => { result.current.remapAnnotations(mapping) })

    const anns = result.current.annotations
    expect(anns).toHaveLength(2)
    expect(anns.find(a => a.id === id1)?.page).toBe(1)
    expect(anns.find(a => a.id === id2)).toBeUndefined()
    expect(anns.find(a => a.id === id3)?.page).toBe(2)
    expect(result.current.selectedId).toBeNull()
  })

  it('addAnnotation: pen/rectangle은 activeMode/selectedId를 변경하지 않는다 (휘발성)', () => {
    const { result } = renderHook(() => useAnnotations())
    act(() => { result.current.setActiveMode('pen') })
    expect(result.current.activeMode).toBe('pen')
    expect(result.current.selectedId).toBeNull()
    act(() => {
      result.current.addAnnotation({
        type: 'pen',
        page: 1,
        x: 0, y: 0, width: 0, height: 0,
        rotation: 0,
        points: [10, 20, 30, 40],
        color: '#FFFF00',
        strokeWidth: 14,
        opacity: 0.4,
      })
    })
    // 펜 추가 후에도 activeMode는 'pen' 유지, selectedId도 변경되지 않음
    expect(result.current.activeMode).toBe('pen')
    expect(result.current.selectedId).toBeNull()
  })

  it('clearMarkups: pen/rectangle 어노테이션만 제거하고 stamp 선택은 유지', () => {
    const { result } = renderHook(() => useAnnotations())
    let stampId!: string
    act(() => { stampId = result.current.addAnnotation(makeStamp()) })
    expect(result.current.selectedId).toBe(stampId)
    act(() => {
      result.current.addAnnotation({
        type: 'pen',
        page: 1,
        x: 0, y: 0, width: 0, height: 0,
        rotation: 0,
        points: [10, 20, 30, 40],
        color: '#FFFF00',
        strokeWidth: 14,
        opacity: 0.4,
      })
    })
    act(() => {
      result.current.addAnnotation({
        type: 'rectangle',
        page: 1,
        x: 5, y: 5, width: 50, height: 30,
        rotation: 0,
        color: '#FF0000',
        strokeWidth: 2,
      })
    })
    expect(result.current.annotations).toHaveLength(3)

    act(() => { result.current.clearMarkups() })

    expect(result.current.annotations).toHaveLength(1)
    expect(result.current.annotations[0].id).toBe(stampId)
    // stamp는 휘발성이 아니므로 선택 유지
    expect(result.current.selectedId).toBe(stampId)
  })

  it('remapAnnotations: allPages 워터마크는 매핑에 관계없이 유지된다', () => {
    const { result } = renderHook(() => useAnnotations())
    act(() => {
      result.current.addAnnotation({
        type: 'watermark',
        page: 1,
        x: 0, y: 0, width: 0, height: 0,
        rotation: 0,
        text: 'DRAFT',
        opacity: 0.5,
        fontSize: 48,
        color: '#888888',
        allPages: true,
      })
    })
    // 빈 매핑 (모든 페이지 삭제)이어도 allPages 워터마크는 유지됨
    const mapping = new Map<number, number>()
    act(() => { result.current.remapAnnotations(mapping) })
    expect(result.current.annotations).toHaveLength(1)
  })
})
