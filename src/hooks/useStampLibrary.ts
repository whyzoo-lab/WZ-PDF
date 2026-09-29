import { useCallback, useEffect, useState } from 'react'
import type { SavedStamp, StampSize } from '../services/stampLibrary'

/**
 * The reader's saved stamps ("내 도장"), loaded the first time the editor is
 * switched on — never at startup, where every millisecond is the first paint's.
 * The storage module is imported lazily for the same reason.
 */
export function useStampLibrary(enabled: boolean) {
  const [stamps, setStamps] = useState<SavedStamp[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    import('../services/stampLibrary')
      .then(lib => lib.listStamps())
      .then(list => { if (!cancelled) setStamps(list) }, () => {})
    return () => { cancelled = true }
  }, [enabled])

  /** Clean up an uploaded image and keep it. Resolves with the new stamp. */
  const upload = useCallback(async (file: File): Promise<SavedStamp> => {
    const [{ prepareStampImage }, lib] = await Promise.all([
      import('../utils/stampImage'),
      import('../services/stampLibrary'),
    ])
    const image = await prepareStampImage(file)
    const stamp: SavedStamp = {
      id: crypto.randomUUID(),
      name: file.name.replace(/\.[^.]+$/, '') || 'stamp',
      createdAt: Date.now(),
      ...image,
    }
    setStamps(await lib.addStamp(stamp))
    return stamp
  }, [])

  const remove = useCallback(async (id: string) => {
    const lib = await import('../services/stampLibrary')
    await lib.removeStamp(id)
    setStamps(await lib.listStamps())
  }, [])

  /** Remember the size a stamp was just given (preset id or `custom:<id>`). */
  const rememberSize = useCallback(async (key: string, size: StampSize) => {
    const lib = await import('../services/stampLibrary')
    await lib.rememberSize(key, size)
    const id = lib.customIdOf(key)
    if (id) setStamps(prev => prev.map(s => (s.id === id ? { ...s, ...size } : s)))
  }, [])

  const presetSize = useCallback(async (presetId: string): Promise<StampSize | null> => {
    const lib = await import('../services/stampLibrary')
    return lib.presetSize(presetId)
  }, [])

  return { stamps, upload, remove, rememberSize, presetSize }
}
