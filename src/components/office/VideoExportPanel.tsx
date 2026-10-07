import { t } from '../../i18n'

export interface VideoProgress {
  phase: 'preparing' | 'making' | 'saving'
  slide: number
  slides: number
  sentence: number
  sentences: number
}

/**
 * What a narrated video is doing, and a way to stop it. Making one takes about
 * a third of the talk's length — the voice is the slow part — so it says how
 * far along it is rather than leaving a spinner up for minutes.
 */
export function VideoExportPanel({ progress, onCancel }: { progress: VideoProgress; onCancel: () => void }) {
  const { phase, slide, slides, sentence, sentences } = progress
  // Sentences are most of the time; slides without any still take a moment.
  const fraction = phase === 'saving' ? 1
    : phase === 'making' && slides > 0 ? (sentence + slide) / (sentences + slides)
      : 0
  const label = phase === 'preparing' ? t('video.preparing')
    : phase === 'saving' ? t('video.saving')
      : t('video.progress', { slide, slides, sentence, sentences })
  return (
    <div
      role="group"
      aria-label={label}
      className="no-print fixed bottom-16 left-1/2 z-40 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-xl bg-gray-800/95 px-4 py-3 text-sm text-gray-100 shadow-2xl ring-1 ring-white/10"
    >
      <div className="flex items-center gap-3">
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {phase !== 'saving' && (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-full px-3 py-1 text-xs text-gray-200 hover:bg-white/10"
          >{t('video.cancel')}</button>
        )}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div className="h-full bg-sky-400 transition-[width] duration-300" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </div>
  )
}
