import { createContext } from 'react'

/** A box dragged on a page with the signing tool armed: where the visible signature goes. */
export const SignAreaContext = createContext<((page: number, rect: { x: number; y: number; width: number; height: number }) => void) | null>(null)
