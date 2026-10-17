import { createContext } from 'react'
import type { ChangeKind } from '../../services/textCompare'

/** One change as marked on a page of the open document. */
export interface CompareMark {
  index: number
  kind: ChangeKind
  rects: { x: number; y: number; width: number; height: number }[]
  /** Where deleted words were: a bar beside this box. */
  near?: { x: number; y: number; width: number; height: number }
}

export interface CompareView {
  /** By page (1-based). Empty when nothing is being compared. */
  marks: Map<number, CompareMark[]>
  /** The change picked in the list. */
  active: number | null
}

export const CompareContext = createContext<CompareView>({ marks: new Map(), active: null })
