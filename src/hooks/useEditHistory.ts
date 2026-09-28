import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** How many steps back are kept. Snapshots share their unchanged parts. */
export const HISTORY_LIMIT = 100

export interface EditHistory {
  /** Call BEFORE a change: remembers the state it is about to replace. */
  record: () => void
  /** Go back one step. False when there is nothing to undo. */
  undo: () => boolean
  /** Go forward one step. False when there is nothing to redo. */
  redo: () => boolean
  /** Forget everything — a different document was opened. */
  reset: () => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * Undo / redo over whole snapshots of the editable state.
 *
 * Snapshots rather than inverse operations: the state is small and immutable
 * (an annotation array, and the document's bytes as one `File` object), so a
 * snapshot is just a few references, and one mechanism covers every kind of
 * change — placing or moving a stamp, deleting or reordering pages — without a
 * hand-written "undo" for each. Before, none of these could be taken back:
 * a stray stamp or a deleted page stayed that way.
 *
 * `current` is read at the moment of each call, not captured at render, so a
 * `record()` fired from an event handler snapshots what is actually on screen.
 */
export function useEditHistory<S>(current: S, restore: (snapshot: S) => void): EditHistory {
  const latest = useRef(current)
  useLayoutEffect(() => { latest.current = current })
  const past = useRef<S[]>([])
  const future = useRef<S[]>([])
  // The stacks live in refs (handlers read and write them synchronously); this
  // mirrors their sizes into render for the toolbar's enabled state.
  const [sizes, setSizes] = useState({ past: 0, future: 0 })
  const sync = useCallback(() => setSizes({ past: past.current.length, future: future.current.length }), [])

  const record = useCallback(() => {
    past.current.push(latest.current)
    if (past.current.length > HISTORY_LIMIT) past.current.shift()
    future.current = []
    sync()
  }, [sync])

  const undo = useCallback(() => {
    const previous = past.current.pop()
    if (previous === undefined) return false
    future.current.push(latest.current)
    latest.current = previous
    restore(previous)
    sync()
    return true
  }, [restore, sync])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (next === undefined) return false
    past.current.push(latest.current)
    latest.current = next
    restore(next)
    sync()
    return true
  }, [restore, sync])

  const reset = useCallback(() => {
    past.current = []
    future.current = []
    sync()
  }, [sync])

  return { record, undo, redo, reset, canUndo: sizes.past > 0, canRedo: sizes.future > 0 }
}
