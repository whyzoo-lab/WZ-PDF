import { useState } from 'react'
import { t } from '../i18n'

interface UpdateToastProps {
  /** The downloaded version, e.g. "1.21.0". */
  version: string
  /** Restart now and install it. */
  onInstall: () => void
}

/**
 * "A new version is ready", top-right, once the installed app has downloaded
 * an update in the background. Restarting installs it now; dismissing is
 * safe too, because it is installed when the app next closes — the toast says
 * so, or "later" would read as "never". It stays until answered: an update
 * that has already been downloaded is worth one deliberate glance.
 */
export function UpdateToast({ version, onInstall }: UpdateToastProps) {
  const [visible, setVisible] = useState(true)
  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-14 right-4 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-lg border border-sky-700/60 bg-gray-800/95 px-3 py-2 shadow-xl backdrop-blur wz-update-toast"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-300" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-xs font-semibold text-gray-100">
          {t('update.ready', { version: `v${version}` })}
        </span>
        <span className="block text-[11px] text-gray-400">{t('update.onQuit')}</span>
      </span>
      <button
        type="button"
        onClick={onInstall}
        className="ml-1 shrink-0 rounded-full bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
      >
        {t('update.restart')}
      </button>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label={t('update.later')}
        title={t('update.later')}
        className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
