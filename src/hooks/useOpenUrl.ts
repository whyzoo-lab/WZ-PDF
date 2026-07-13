import { useState, useCallback, useEffect, useRef } from 'react'
import { t } from '../i18n'

/**
 * "Open from URL" feature bundle: the modal open/loading/error state, the
 * fetch-and-load handler (Electron uses the main process to sidestep CORS; the
 * web build uses fetch()), and the one-shot `?url=`/`?file=` auto-open used for
 * iframe embedding. Errors are non-blocking (toast + inline) — never alert(),
 * which would freeze an embedded iframe.
 */
export function useOpenUrl(loadPdfFile: (f: File) => void, showToast: (message: string) => void) {
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [urlLoading, setUrlLoading] = useState(false)
  // Last URL-load error, shown inline (esp. for embed mode where there's no
  // modal and a blocking alert() would freeze the iframe).
  const [urlError, setUrlError] = useState<string | null>(null)

  const handleOpenUrl = useCallback(async (rawUrl: string) => {
    const url = rawUrl.trim()
    setUrlError(null)
    if (!/^https?:\/\//i.test(url)) {
      const m = t('url.invalid')
      setUrlError(m); showToast(m)
      return
    }
    setUrlLoading(true)
    try {
      let bytes: ArrayBuffer
      if (window.electronAPI?.fetchUrl) {
        bytes = await window.electronAPI.fetchUrl(url)
      } else {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        bytes = await res.arrayBuffer()
      }
      const name = (() => {
        try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') } catch { return '' }
      })() || 'document.pdf'
      const filename = name || 'document.pdf'
      loadPdfFile(new File([bytes], filename))
      setShowUrlModal(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // On the web, a thrown TypeError usually means a CORS block.
      const isCors = !window.electronAPI && err instanceof TypeError
      const friendly = isCors ? t('url.corsBlocked') : t('url.loadFailed', { error: msg })
      setUrlError(friendly)
      showToast(friendly)
      setShowUrlModal(false)
    } finally {
      setUrlLoading(false)
    }
  }, [loadPdfFile, showToast])

  // Embed: auto-open the PDF passed via ?url= (or ?file=). Lets the app be
  // dropped into a website with <iframe src="https://…/WZ-PDF/?url=ENCODED&embed=1">
  // so a PDF is shown inline without the user downloading it. Runs once.
  const autoLoadedRef = useRef(false)
  useEffect(() => {
    if (autoLoadedRef.current) return
    autoLoadedRef.current = true
    let url: string | null = null
    try {
      const params = new URLSearchParams(window.location.search)
      url = params.get('url') || params.get('file')
    } catch { /* no query string */ }
    if (url) handleOpenUrl(url)
  }, [handleOpenUrl])

  return { showUrlModal, setShowUrlModal, urlLoading, urlError, handleOpenUrl }
}
