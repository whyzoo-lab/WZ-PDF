import { createContext } from 'react'
import type { FormValue } from '../../types/annotation'

/** What a page's form controls need from App (kept in context, like comments). */
export interface FormActions {
  /** Whether fields can be filled (not in the locked private web mode). */
  canFill: boolean
  /**
   * The reader set a field. `original` is the file's own value: setting a
   * field back to it drops the override, so the document reads as unchanged.
   */
  setField: (name: string, value: FormValue, page: number, original: FormValue) => void
}

export const FormContext = createContext<FormActions>({ canFill: false, setField: () => {} })
