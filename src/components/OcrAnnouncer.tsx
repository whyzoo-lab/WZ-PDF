import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { LiveRegion } from './LiveRegion'

export interface OcrAnnouncerProps {
  /** Null when nothing is being recognised. */
  progress: { done: number; total: number } | null
}

/**
 * Says how far text recognition has got, occasionally.
 *
 * Occasionally is the point. Recognition reports every page, and a document can
 * have hundreds — announcing each one would talk over everything else for
 * minutes and tell the reader nothing they could act on. The message therefore
 * only changes about ten times over the whole run, and once more at the end,
 * which is the part that actually matters: silence after a long wait is
 * indistinguishable from a hang.
 */
export function OcrAnnouncer({ progress }: OcrAnnouncerProps) {
  const [message, setMessage] = useState('')

  // Rounded down to a tenth of the document, so a 30-page scan speaks three
  // times and a 300-page one still speaks ten.
  const step = progress ? Math.max(1, Math.ceil(progress.total / 10)) : 1
  const milestone = progress ? Math.floor(progress.done / step) : -1

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- announcing a transition, which only exists between renders
    setMessage(current => {
      // "1쪽 가운데 0쪽" is a silly way to say "this page".
      if (progress) {
        return progress.total === 1 ? t('ocr.a11ySingle') : t('ocr.a11yProgress', progress)
      }
      // Only worth saying if something was running.
      return current ? t('ocr.a11yDone') : ''
    })
    // `milestone` is what gates this, not `progress` itself: the object changes
    // on every page and would defeat the throttling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestone, !progress])

  return <LiveRegion message={message} />
}
