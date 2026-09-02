import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { LiveRegion } from './LiveRegion'

export type SpeechStatus = 'idle' | 'preparing' | 'speaking' | 'paused'

/**
 * Says out loud what the reader is doing.
 *
 * Someone who cannot see the playing bar otherwise has only the speech itself
 * to go on, which says nothing about *preparing* (silence that might be a
 * failure) or about the difference between a pause and the end of the document
 * (also silence). Each of those is one short sentence.
 *
 * **It says each thing once per session.** Moving a sentence at a time runs
 * through preparing → speaking every time, and announcing that on each press
 * would talk over the very sentence the reader jumped to hear. So the opening
 * pair is announced only until speech is actually under way; after that only a
 * pause or the end has anything new to say.
 *
 * The first of those announcements carries the keys, because a reader who
 * cannot see the bar has no other way to discover them — and they are the
 * difference between a document you can move around in and one you can only sit
 * through.
 *
 * Kept apart from `TtsBar` because the bar is unmounted when reading stops, and
 * the end of reading is exactly the moment worth announcing.
 */
export function SpeechAnnouncer({ status }: { status: SpeechStatus }) {
  const [message, setMessage] = useState('')
  /** Whether this reading session has already got as far as speaking. */
  const underway = useRef(false)

  useEffect(() => {
    if (status === 'idle') underway.current = false
    setMessage(current => {
      if (status === 'preparing') return underway.current ? current : t('tts.a11yPreparing')
      if (status === 'speaking') {
        if (underway.current) return current
        underway.current = true
        return t('tts.a11ySpeaking')
      }
      if (status === 'paused') return t('tts.a11yPaused')
      // Reaching idle is only worth saying if something was going on.
      return current ? t('tts.a11yStopped') : ''
    })
  }, [status])

  return <LiveRegion message={message} />
}
