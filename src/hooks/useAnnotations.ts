import { useState, useCallback } from 'react'
import type { Annotation, ActiveMode, OmitId } from '../types/annotation'

interface AnnotationState {
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
}

export interface UseAnnotationsReturn extends AnnotationState {
  addAnnotation: (annotation: OmitId<Annotation>) => string
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void
  removeAnnotation: (id: string) => void
  selectAnnotation: (id: string | null) => void
  setActiveMode: (mode: ActiveMode) => void
  remapAnnotations: (mapping: Map<number, number>) => void
}

export function useAnnotations(): UseAnnotationsReturn {
  const [state, setState] = useState<AnnotationState>({
    annotations: [],
    selectedId: null,
    activeMode: null,
  })

  const addAnnotation = useCallback((annotation: OmitId<Annotation>): string => {
    const id = crypto.randomUUID()
    setState(prev => ({
      ...prev,
      annotations: [...prev.annotations, { ...annotation, id } as Annotation],
      selectedId: id,
      activeMode: 'select',
    }))
    return id
  }, [])

  const updateAnnotation = useCallback((id: string, updates: Partial<Annotation>) => {
    setState(prev => ({
      ...prev,
      annotations: prev.annotations.map(a => (a.id === id ? { ...a, ...updates } as Annotation : a)),
    }))
  }, [])

  const removeAnnotation = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      annotations: prev.annotations.filter(a => a.id !== id),
      selectedId: prev.selectedId === id ? null : prev.selectedId,
    }))
  }, [])

  const selectAnnotation = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, selectedId: id }))
  }, [])

  const setActiveMode = useCallback((mode: ActiveMode) => {
    setState(prev => ({ ...prev, activeMode: mode, selectedId: null }))
  }, [])

  const remapAnnotations = useCallback((mapping: Map<number, number>) => {
    setState(prev => {
      const remapped: Annotation[] = []
      for (const ann of prev.annotations) {
        // allPages 워터마크는 특정 페이지에 종속되지 않으므로 항상 유지
        if (ann.type === 'watermark' && ann.allPages) {
          remapped.push(ann)
          continue
        }
        const newPage = mapping.get(ann.page)
        if (newPage !== undefined) {
          remapped.push({ ...ann, page: newPage } as Annotation)
        }
        // newPage가 undefined면 해당 페이지 삭제 → 어노테이션도 제거
      }
      return { ...prev, annotations: remapped, selectedId: null }
    })
  }, [])

  return { ...state, addAnnotation, updateAnnotation, removeAnnotation, selectAnnotation, setActiveMode, remapAnnotations }
}
