import { createContext } from 'react'
import type { Annotation, FillMark } from '../../types/annotation'

/** What the Fill & Sign tool places: a mark, typed text, or today's date (text). */
export type FillTool = FillMark | 'date'

export interface FillActions {
  tool: FillTool
  /** Whether fill items can be moved, typed in and deleted (editing is on). */
  canEdit: boolean
  remove: (id: string) => void
  update: (id: string, updates: Partial<Annotation>) => void
}

export const FillContext = createContext<FillActions>({ tool: 'text', canEdit: false, remove: () => {}, update: () => {} })
