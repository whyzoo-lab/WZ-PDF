import { t } from '../i18n'
import { LiveRegion } from './LiveRegion'
import { VOICE_LABELS } from '../services/ttsVoices'
import {
  IconNextSentence, IconPause, IconPlay, IconPrevSentence, IconSpeed, IconStop, IconVoice,
} from './toolbar/icons'

/**
 * The bar that appears while the document is being read, and the one-time
 * prompt that appears before it ever can be.
 *
 * The prompt is not a formality. The voice model is a 383 MB download, and a
 * feature that silently starts one is a feature that ambushes people on a
 * metered connection — so the size is stated before anything is fetched, and it
 * says the download happens once because that is the part that makes it
 * acceptable.
 *
 * **The playing bar is built to survive a 390px screen.** Its first version was
 * a row of Korean labels — 읽는 중 12/4794, 읽기 중지, 목소리, 속도, 적용 —
 * which on a phone had nowhere to go and wrapped one character per line, turning
 * the bar into a wall of vertical text. Everything that can be a glyph now is
 * one, the only text left is the speed readout and the Apply button, and the
 * slider is the single element allowed to absorb what space is left.
 */

const MB = 1024 * 1024

export interface TtsBarProps {
  status: 'idle' | 'preparing' | 'speaking' | 'paused'
  index: number
  chunkCount: number
  error: string | null
  /** Null until the renderer has asked; absent entirely outside the desktop app. */
  model: TtsModelStatus | null
  downloading: boolean
  downloadProgress: TtsDownloadProgress | null
  /** The consent prompt is showing, because the model is not on disk yet. */
  promptOpen: boolean
  /** What the controls show — the draft, not necessarily what is being spoken. */
  voice: string
  speed: number
  /** The draft differs from what is being spoken, so Apply has something to do. */
  canApply: boolean
  /** Apply was pressed and is not audible yet. Only now are the controls
   *  locked: the change cannot take effect before the sentence already sounding
   *  has finished, and without saying so the UI just looks unresponsive. */
  applying: boolean
  onDownload: () => void
  onCancelDownload: () => void
  onDismissPrompt: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  /** Back a sentence — or to the start of this one, if it is already under way. */
  onPrevious: () => void
  onNext: () => void
  onVoiceChange: (voice: string) => void
  onSpeedChange: (speed: number) => void
  onApply: () => void
}

const shell = 'no-print fixed bottom-3 left-1/2 -translate-x-1/2 z-40 '
  + 'rounded-xl bg-gray-900/95 text-gray-100 shadow-2xl ring-1 ring-white/10 backdrop-blur'

const ghost = 'rounded-full px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10 '
  + 'disabled:opacity-40 disabled:hover:bg-transparent transition-colors'

/** Round icon target, matching the toolbar's own controls. */
const iconBtn = 'flex items-center justify-center w-9 h-9 shrink-0 rounded-full '
  + 'text-gray-200 hover:bg-white/10 hover:text-white transition-colors '
  + 'disabled:opacity-40 disabled:hover:bg-transparent'

export function TtsBar(props: TtsBarProps) {
  const {
    status, index, chunkCount, error, model, downloading, downloadProgress,
    promptOpen, voice, speed, canApply, applying,
    onDownload, onCancelDownload, onDismissPrompt,
    onPause, onResume, onStop, onPrevious, onNext, onVoiceChange, onSpeedChange, onApply,
  } = props

  if (promptOpen && !downloading) {
    const size = `${Math.round((model?.bytesTotal ?? 0) / MB)} MB`
    return (
      // aria-modal + a focused button: pressing the read-aloud key put this
      // question on screen and then left focus on the body, so a reader using
      // the keyboard alone was waiting on a dialog with no way to find it.
      <div className={`${shell} max-w-[min(92vw,32rem)] px-4 py-3`}
        role="dialog" aria-modal="true" aria-label={t('tts.read')}>
        <p className="text-sm leading-6">{t('tts.needsModel', { size })}</p>
        {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
        <div className="mt-2 flex justify-end gap-1">
          <button type="button" className={ghost} onClick={onDismissPrompt}>{t('tts.cancel')}</button>
          <button
            type="button"
            autoFocus
            className={`${ghost} bg-blue-600/90 hover:bg-blue-500 text-white`}
            onClick={onDownload}
          >{t('tts.download')}</button>
        </div>
      </div>
    )
  }

  if (downloading) {
    const done = Math.round((downloadProgress?.bytesReceived ?? 0) / MB)
    const total = Math.round((downloadProgress?.bytesTotal ?? model?.bytesTotal ?? 0) / MB)
    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0
    return (
      <div className={`${shell} w-[min(92vw,28rem)] px-4 py-3`}
        role="group" aria-label={t('tts.read')}>
        {/* Announced in tenths. The visible figure changes many times a second;
            reading every one of them aloud would bury everything else. */}
        <LiveRegion message={t('tts.a11yDownloading', { pct: Math.round(pct / 10) * 10 })} />
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>{t('tts.downloading', { done, total })}</span>
          <button type="button" className={ghost} onClick={onCancelDownload}>{t('tts.cancel')}</button>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-blue-500 transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  if (status === 'idle') return null

  const paused = status === 'paused'
  const preparing = status === 'preparing'
  // How far in, as a hairline along the bottom edge. It replaces the "읽는 중
  // 12/4794" that used to sit at the front of the bar: the number was the widest
  // thing in the row and the least use — nobody is counting sentences.
  const progress = chunkCount > 0 ? Math.min(100, ((index + 1) / chunkCount) * 100) : 0

  return (
    <div
      // No `relative` here: it is a position utility and would override the
      // `fixed` in `shell`, dropping the bar out of its corner and into the
      // document flow just under the toolbar. `fixed` is already a containing
      // block, so the progress hairline below positions against it as it is.
      className={`${shell} overflow-hidden w-[min(94vw,34rem)] flex flex-wrap items-center gap-y-1 px-2 py-1.5`}
      // A group, not a status. As a live region this bar announced its whole
      // contents on every change — and its contents include the voice picker's
      // options, so a screen reader read out "목소리 F1 F2 F3 F4 F5 M1 M2 M3 M4
      // M5 속도 1.00x 적용". What is worth saying is said by SpeechAnnouncer.
      role="group"
      aria-label={t('tts.controls')}
    >
      {/* Two groups, allowed to wrap onto two lines. Adding the sentence
          controls to a single row left the speed slider with a track 0 px wide
          on a 390 px screen — the settings now drop to their own line instead,
          which is the one kind of stacking that stays legible. */}
      <div className="flex items-center gap-1 shrink-0">
      {/* Moving through the document, which is the whole difference between a
          document you can listen to and one you can only sit through: a reader
          who missed a sentence can hear it again instead of starting over. */}
      <button
        type="button"
        className={iconBtn}
        onClick={onPrevious}
        aria-label={t('tts.previous')}
        title={t('tts.previous')}
      ><IconPrevSentence /></button>

      {/* One button for play and pause, because they are one idea: whether the
          reader is speaking. Disabled while the first sentence is still being
          made, when there is nothing to pause. */}
      <button
        type="button"
        className={iconBtn}
        onClick={paused ? onResume : onPause}
        disabled={preparing}
        aria-label={paused ? t('tts.resume') : t('tts.pause')}
        title={preparing ? t('tts.preparing') : (paused ? t('tts.resume') : t('tts.pause'))}
      >{paused ? <IconPlay /> : <IconPause />}</button>

      <button
        type="button"
        className={iconBtn}
        onClick={onNext}
        aria-label={t('tts.next')}
        title={t('tts.next')}
      ><IconNextSentence /></button>

      {/* Stop is a separate control, not the other half of pause: it ends the
          session and takes the bar with it. */}
      <button
        type="button"
        className={iconBtn}
        onClick={onStop}
        aria-label={t('tts.stop')}
        title={t('tts.stop')}
      ><IconStop /></button>
      </div>

      {/* Wide enough that it takes a line of its own rather than being crushed. */}
      <div className="flex min-w-[13rem] flex-1 items-center gap-1">
      <label
        className="flex shrink-0 items-center gap-1 pl-1 text-gray-400"
        title={t('tts.voice')}
      >
        <span className="sr-only">{t('tts.voice')}</span>
        <IconVoice />
        <select
          value={voice}
          disabled={applying}
          onChange={e => onVoiceChange(e.target.value)}
          aria-label={t('tts.voice')}
          className="rounded bg-white/10 px-1 py-0.5 text-xs text-gray-100 outline-none
                     disabled:opacity-40 disabled:cursor-wait"
        >
          {VOICE_LABELS.map(v => (
            <option key={v.id} value={v.id} className="text-gray-900">{v.label}</option>
          ))}
        </select>
      </label>

      {/* The slider is the one element that gives up space; everything else is
          shrink-0, so a narrow screen shortens the track instead of stacking
          the row into columns of single characters. */}
      <label className="flex min-w-0 flex-1 items-center gap-1 pl-1 text-gray-400" title={t('tts.speed')}>
        <span className="sr-only">{t('tts.speed')}</span>
        <IconSpeed />
        <input
          type="range"
          min={0.8}
          max={2}
          step={0.05}
          value={speed}
          disabled={applying}
          onChange={e => onSpeedChange(Number(e.target.value))}
          aria-label={t('tts.speed')}
          className="min-w-0 flex-1 accent-blue-500 disabled:opacity-40 disabled:cursor-wait"
        />
        <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-gray-300">
          {speed.toFixed(2)}x
        </span>
      </label>

      {/* Changes are drafted, not live: picking a voice does not interrupt the
          sentence being read, and nothing is locked until this is pressed. */}
      <button
        type="button"
        onClick={onApply}
        disabled={!canApply || applying}
        title={applying ? t('tts.applying') : t('tts.apply')}
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
          canApply && !applying
            ? 'bg-blue-600/90 hover:bg-blue-500 text-white'
            : 'text-gray-500'
        } disabled:cursor-default`}
      >{t('tts.apply')}</button>
      </div>

      {error && <span className="shrink-0 text-xs text-red-300">{error}</span>}

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-blue-500/70 transition-[width]"
        style={{ width: `${progress}%` }}
        aria-hidden
      />
    </div>
  )
}
