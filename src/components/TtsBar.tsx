import { t } from '../i18n'
import { VOICE_LABELS } from '../services/ttsVoices'

/**
 * The bar that appears while the document is being read, and the one-time
 * prompt that appears before it ever can be.
 *
 * The prompt is not a formality. The voice model is a 383 MB download, and a
 * feature that silently starts one is a feature that ambushes people on a
 * metered connection — so the size is stated before anything is fetched, and it
 * says the download happens once because that is the part that makes it
 * acceptable.
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
  voice: string
  speed: number
  /** A change has been made but is not audible yet — the controls are locked
   *  until it is, so the delay reads as "working" rather than "ignored". */
  applying: boolean
  onDownload: () => void
  onCancelDownload: () => void
  onDismissPrompt: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onVoiceChange: (voice: string) => void
  onSpeedChange: (speed: number) => void
}

const shell = 'no-print fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[min(92vw,44rem)] '
  + 'rounded-xl bg-gray-900/95 text-gray-100 shadow-2xl ring-1 ring-white/10 backdrop-blur'

const ghost = 'rounded-full px-3 py-1.5 text-sm text-gray-200 hover:bg-white/10 '
  + 'disabled:opacity-40 disabled:hover:bg-transparent transition-colors'

export function TtsBar(props: TtsBarProps) {
  const {
    status, index, chunkCount, error, model, downloading, downloadProgress,
    promptOpen, voice, speed, applying,
    onDownload, onCancelDownload, onDismissPrompt,
    onPause, onResume, onStop, onVoiceChange, onSpeedChange,
  } = props

  if (promptOpen && !downloading) {
    const size = `${Math.round((model?.bytesTotal ?? 0) / MB)} MB`
    return (
      <div className={`${shell} px-4 py-3`} role="dialog" aria-label={t('tts.read')}>
        <p className="text-sm leading-6">{t('tts.needsModel', { size })}</p>
        {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
        <div className="mt-2 flex justify-end gap-1">
          <button type="button" className={ghost} onClick={onDismissPrompt}>{t('tts.cancel')}</button>
          <button
            type="button"
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
      <div className={`${shell} px-4 py-3 w-[28rem]`} role="status">
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

  return (
    <div className={`${shell} flex items-center gap-2 px-3 py-2`} role="status" aria-live="polite">
      <span className="px-1 text-sm tabular-nums text-gray-300">
        {status === 'preparing'
          ? t('tts.preparing')
          : t('tts.reading', { done: index + 1, total: chunkCount })}
      </span>

      <button
        type="button"
        className={ghost}
        onClick={status === 'paused' ? onResume : onPause}
        disabled={status === 'preparing'}
      >{status === 'paused' ? '▶' : '⏸'}</button>

      <button type="button" className={ghost} onClick={onStop}>{t('tts.stop')}</button>

      <label
        className="ml-1 flex items-center gap-1 text-xs text-gray-400"
        title={applying ? t('tts.applying') : undefined}
      >
        {t('tts.voice')}
        <select
          value={voice}
          disabled={applying}
          onChange={e => onVoiceChange(e.target.value)}
          className="rounded bg-white/10 px-1 py-0.5 text-gray-100 outline-none
                     disabled:opacity-40 disabled:cursor-wait"
        >
          {VOICE_LABELS.map(v => (
            <option key={v.id} value={v.id} className="text-gray-900">{v.label}</option>
          ))}
        </select>
      </label>

      <label
        className="flex items-center gap-1 text-xs text-gray-400"
        title={applying ? t('tts.applying') : undefined}
      >
        {t('tts.speed')}
        <input
          type="range"
          min={0.8}
          max={1.5}
          step={0.05}
          value={speed}
          disabled={applying}
          onChange={e => onSpeedChange(Number(e.target.value))}
          className="w-20 accent-blue-500 disabled:opacity-40 disabled:cursor-wait"
        />
        <span className="w-8 tabular-nums text-gray-300">{speed.toFixed(2)}x</span>
      </label>

      {error && <span className="text-xs text-red-300">{error}</span>}
    </div>
  )
}
