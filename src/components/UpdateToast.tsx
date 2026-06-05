import { useEffect, useState } from 'react'
import { t } from '../i18n'

interface UpdateToastProps {
  /** The newer version string, e.g. "1.2.2". */
  version: string
  /** Open the download page. */
  onDownload: () => void
  /** Auto-dismiss after this many ms (default 12s). */
  duration?: number
}

/**
 * Optional, dismissible "update available" popup, top-right. Clicking it opens
 * the download page; it also auto-dismisses after `duration` and can be closed
 * manually with the ✕. Never forces anything.
 */
export function UpdateToast({ version, onDownload, duration = 12000 }: UpdateToastProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const id = window.setTimeout(() => setVisible(false), duration)
    return () => window.clearTimeout(id)
  }, [duration])

  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-14 right-4 z-[60] flex items-center gap-2 rounded-lg border border-sky-700/60 bg-gray-800/95 px-3 py-2 shadow-xl backdrop-blur wz-update-toast"
    >
      <button
        type="button"
        onClick={onDownload}
        className="flex items-center gap-2 text-left"
        title={t('update.download')}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-300">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
        </span>
        <span className="leading-tight">
          <span className="block text-xs font-semibold text-gray-100">
            {t('update.available').replace('{version}', `v${version}`)}
          </span>
          <span className="block text-[11px] text-sky-300">{t('update.download')}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label={t('update.dismiss')}
        title={t('update.dismiss')}
        className="ml-1 shrink-0 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
