// The name written on new comments and replies (/T in the saved PDF).
// Desktop: userData/comment-author.json through IPC, starting as the OS account
// name (electron/commentAuthor.ts) — never localStorage there, whose first
// access freezes the packaged app. Web: localStorage, empty until set.

import { useCallback, useEffect, useState } from 'react'
import { canPersistOverride } from '../i18n'

const STORAGE_KEY = 'wz-comment-author'

export function useCommentAuthor(): [string, (name: string) => void] {
  const [author, setAuthorState] = useState('')

  useEffect(() => {
    const api = window.electronAPI
    if (api?.commentAuthorGet) {
      api.commentAuthorGet().then(v => setAuthorState(typeof v === 'string' ? v : ''), () => {})
      return
    }
    if (!canPersistOverride(window.location.protocol)) return
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from storage on mount
      setAuthorState(localStorage.getItem(STORAGE_KEY) ?? '')
    } catch { /* private mode */ }
  }, [])

  const setAuthor = useCallback((name: string) => {
    const clean = name.trim().slice(0, 64)
    setAuthorState(clean)
    const api = window.electronAPI
    if (api?.commentAuthorSet) {
      // The main process falls back to the account name for an empty one.
      api.commentAuthorSet(clean).then(v => { if (typeof v === 'string') setAuthorState(v) }, () => {})
      return
    }
    if (!canPersistOverride(window.location.protocol)) return
    try { localStorage.setItem(STORAGE_KEY, clean) } catch { /* private mode */ }
  }, [])

  return [author, setAuthor]
}
