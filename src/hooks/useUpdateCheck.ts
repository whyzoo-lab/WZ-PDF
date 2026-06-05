import { useState, useEffect } from 'react'

export interface AvailableUpdate {
  version: string
  downloadUrl: string
}

/** True if `latest` is a higher dotted-numeric version than `current`. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split('.').map(n => parseInt(n, 10) || 0)
  const b = current.split('.').map(n => parseInt(n, 10) || 0)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

/**
 * Background, optional update check — desktop only. A short while after launch
 * it asks the main process for the version manifest (no CORS) and, if a newer
 * version is published, returns it so the UI can show a dismissible toast.
 * Never blocks startup and never auto-installs.
 */
export function useUpdateCheck(): AvailableUpdate | null {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.checkUpdate) return // web build: nothing to download, skip

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const info = await api.checkUpdate!()
        if (cancelled || !info || info.available === false || !info.version) return
        if (isNewerVersion(info.version, __APP_VERSION__)) {
          setUpdate({
            version: info.version,
            downloadUrl: info.download_url || 'https://whyzoo.com/WzPDF/download.php',
          })
        }
      } catch {
        /* offline / endpoint down — silently ignore */
      }
    }, 3000) // let the app settle first

    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [])

  return update
}
