import { useState, useCallback } from 'react'
import type { Annotation, ActiveMode } from '../types/annotation'

interface AnnotationState {
  annotations: Annotation[]
  selectedId: string | null
  activeMode: ActiveMode
}

export interface UseAnnotationsReturn extends AnnotationState {
  addAnnotation: (annotation: Omit<Annotation, 'id'>) => string
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void
  removeAnnotation: (id: string) => void
  selectAnnotation: (id: string | null) => void
  setActiveMode: (mode: ActiveMode) => void
}

export function useAnnotations(): UseAnnotationsReturn {
  const [state, setState] = useState<AnnotationState>({
    annotations: [],
    selectedId: null,
    activeMode: null,
  })

  const addAnnotation = useCallback((annotation: Omit<Annotation, 'id'>): string => {
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
      annotations: prev.annotations.map(a => (a.id === id ? { ...a, ...updates } : a)),
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

  return { ...state, addAnnotation, updateAnnotation, removeAnnotation, selectAnnotation, setActiveMode }
}
