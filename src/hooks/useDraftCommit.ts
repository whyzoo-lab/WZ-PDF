// A text field over a stored value: typed into freely, stored when the reader
// pauses (`delay`), leaves the field, or it unmounts — so one pause is one undo
// step, not one per letter, and a save made while the caret is still in the
// field (Ctrl+S) has what was typed up to the pause.
//
// The field is controlled by a draft keyed to the stored value it started
// from: a change from outside (undo, the same field on another page) shows at
// once, while storing the draft does not touch the field — the caret stays.

import { useCallback, useEffect, useRef, useState } from 'react'

export function useDraftCommit(value: string, commit: (next: string) => void, delay = 700): {
  shown: string
  onChange: (next: string) => void
  flush: () => void
} {
  const [draft, setDraft] = useState<{ from: string; value: string }>({ from: value, value })
  const shown = draft.from === value ? draft.value : value
  const pending = useRef<{ value: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const commitRef = useRef(commit)
  const valueRef = useRef(value)
  useEffect(() => { commitRef.current = commit; valueRef.current = value })

  const flush = useCallback(() => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    if (p.value !== valueRef.current) commitRef.current(p.value)
  }, [])

  const onChange = useCallback((next: string) => {
    setDraft({ from: valueRef.current, value: next })
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { value: next, timer: setTimeout(flush, delay) }
  }, [delay, flush])

  // Leaving the page (it scrolled out and unmounted) keeps what was typed.
  useEffect(() => flush, [flush])

  return { shown, onChange, flush }
}
