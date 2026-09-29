import { useCallback, useEffect, useState } from 'react'

export interface AutoUpdate {
  /** Null until known, and always in the web build. */
  state: UpdateState | null
  /** Turn automatic updates on or off (start screen). */
  setEnabled: (enabled: boolean) => Promise<void>
  /** Quit, install the waiting update and relaunch. Resolves false if nothing is waiting. */
  install: () => Promise<boolean>
}

/**
 * The installed app's automatic updates, seen from the renderer. The main
 * process does the checking and downloading (electron/autoUpdate.ts); this only
 * reports what it has and asks it to install. The state is read once on mount
 * as well as pushed, because a download can finish before this listener exists.
 */
export function useAutoUpdate(): AutoUpdate {
  const [state, setState] = useState<UpdateState | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.updateState) return
    let cancelled = false
    api.updateState().then(s => { if (!cancelled) setState(s) }, () => {})
    const off = api.onUpdateReady?.(version => setState(s => (s ? { ...s, ready: version } : s)))
    return () => { cancelled = true; off?.() }
  }, [])

  const setEnabled = useCallback(async (enabled: boolean) => {
    const next = await window.electronAPI?.setAutoUpdate?.(enabled)
    if (next) setState(next)
  }, [])

  const install = useCallback(async () => (await window.electronAPI?.installUpdate?.()) ?? false, [])

  return { state, setEnabled, install }
}
