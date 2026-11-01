import { useCallback, useEffect, useRef } from 'react'

/**
 * `fn`, at most once per animation frame, for as long as the component lives.
 * For scroll handlers that measure — see utils/onceAFrame, the same thing for
 * listeners added in an effect. Pass a stable `fn`.
 */
export function useOnceAFrame(fn: () => void): () => void {
  const frame = useRef(0)
  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
  }, [])
  return useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      fn()
    })
  }, [fn])
}
