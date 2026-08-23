import { useCallback, useEffect, useRef, useState } from 'react'
import { languageFor } from '../services/ttsText'

/**
 * Reading a document aloud.
 *
 * Synthesis happens in the main process (see electron/ttsWorker.ts); this hook
 * owns the part the listener actually experiences — when a sentence starts,
 * what is prepared next, and how quickly stopping takes effect.
 *
 * The design point is the look-ahead. Measured RTF is ~0.3x, so a sentence is
 * ready in roughly a third of the time it takes to say it; preparing the next
 * one or two while the current sentence plays means playback never waits, and
 * only the very first sentence has any delay at all. Preparing the whole
 * document up front would instead make the user wait for the last sentence
 * before hearing the first.
 */

/** Sentences to keep synthesized ahead of the one being spoken. */
const LOOKAHEAD = 2

/** Denoising steps. 8 is the engine default; fewer is faster and flatter. */
const TOTAL_STEP = 8

/** Plain speed. The engine's own examples use 1.05, but someone who has not
 *  touched the slider should hear the document at 1x, not slightly hurried. */
export const DEFAULT_SPEED = 1

export type TtsStatus = 'idle' | 'preparing' | 'speaking' | 'paused'

export interface TtsState {
  status: TtsStatus
  /** Index of the sentence currently sounding, or -1. */
  index: number
  /** Its text, for the highlighter to locate in the document. */
  currentText: string | null
  /** An applied change is not audible yet — the controls are locked meanwhile. */
  applying: boolean
  /** What the controls show. Only becomes `voice`/`speed` on apply. */
  draftVoice: string
  draftSpeed: number
  /** The draft differs from what is being spoken, so there is something to do. */
  canApply: boolean
  chunkCount: number
  error: string | null
  model: TtsModelStatus | null
  downloading: boolean
  downloadProgress: TtsDownloadProgress | null
  voice: string
  speed: number
}

export function useTts() {
  const [status, setStatus] = useState<TtsStatus>('idle')
  const [index, setIndex] = useState(-1)
  // The sentence itself, not just its number: the highlighter finds it in the
  // document by searching for these very characters.
  const [currentText, setCurrentText] = useState<string | null>(null)
  const [chunkCount, setChunkCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<TtsModelStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<TtsDownloadProgress | null>(null)
  const [voice, setVoice] = useState('F1')
  // What the controls show, which is not what is being spoken until the reader
  // presses Apply. Committing on every keystroke of a slider would mean
  // discarding and re-synthesizing the look-ahead on each intermediate value,
  // and locking the controls the instant they are touched — which is exactly
  // the friction this separation removes.
  const [draftVoice, setDraftVoice] = useState('F1')
  const [draftSpeed, setDraftSpeed] = useState(DEFAULT_SPEED)
  // True from Apply until a sentence made with the new setting starts playing.
  // Only then are the controls locked, and only because the change genuinely
  // cannot take effect before the sentence already sounding has finished.
  const [applying, setApplying] = useState(false)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)

  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const chunksRef = useRef<string[]>([])
  const cacheRef = useRef(new Map<number, { version: number; promise: Promise<AudioBuffer> }>())
  /** Bumped when the draft settings are applied; see `applySettings` below. */
  const versionRef = useRef(0)
  /**
   * Invalidates in-flight work. Every async step re-checks it, so a stop takes
   * effect immediately instead of being overwritten by a synthesis that was
   * already running when the user pressed the button.
   */
  const runRef = useRef(0)
  // Read inside the playback loop, which must see the latest value without
  // being restarted — changing the voice mid-document applies from the next
  // sentence rather than cutting the current one off.
  //
  // Written by the change handlers, in the same tick as the version bump. Going
  // through an effect instead would leave a gap in which the loop could
  // synthesize with the *old* voice and tag it with the *new* version, which
  // re-enables the controls while the previous voice is still being heard.
  const voiceRef = useRef(voice)
  const speedRef = useRef(speed)

  const refreshModel = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.ttsStatus) { setModel(null); return null }
    const status = await api.ttsStatus()
    setModel(status)
    return status
  }, [])

  // Deliberately not checked on mount: that would put sixteen stat() calls on
  // the startup path for a feature most sessions never open. The UI calls
  // refreshModel() when it is first shown.

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onTtsDownloadProgress) return
    return api.onTtsDownloadProgress(setDownloadProgress)
  }, [])

  const ensureContext = useCallback((): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext()
    }
    return ctxRef.current
  }, [])

  /** Synthesize one chunk, memoized so the look-ahead never pays twice. */
  const bufferFor = useCallback((i: number): Promise<AudioBuffer> => {
    const version = versionRef.current
    const cached = cacheRef.current.get(i)
    // A hit from before the settings changed is deliberately discarded: it was
    // synthesized in the old voice, and playing it would make the change look
    // like it had not registered.
    if (cached && cached.version === version) return cached.promise

    const text = chunksRef.current[i]
    const promise = (async () => {
      const api = window.electronAPI
      if (!api?.ttsSynthesize) throw new Error('Speech is only available in the desktop app')
      const { pcm, sampleRate } = await api.ttsSynthesize({
        text,
        voice: voiceRef.current,
        lang: languageFor(text),
        speed: speedRef.current,
        totalStep: TOTAL_STEP,
      })
      const ctx = ensureContext()
      // The engine returns 44.1 kHz; a device running at another rate resamples
      // this automatically when the buffer is played.
      const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
      // Written rather than copyToChannel'd: the PCM arrives over IPC typed as
      // Float32Array<ArrayBufferLike>, which that method's signature rejects.
      buffer.getChannelData(0).set(pcm)
      return buffer
    })()

    cacheRef.current.set(i, { version, promise })
    // A rejected entry must not poison the cache, or a retry replays the error
    // without ever calling the engine again.
    promise.catch(() => {
      if (cacheRef.current.get(i)?.promise === promise) cacheRef.current.delete(i)
    })
    return promise
  }, [ensureContext])

  const playBuffer = useCallback((buffer: AudioBuffer, run: number): Promise<void> => {
    const ctx = ensureContext()
    return new Promise<void>(resolve => {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.onended = () => {
        if (sourceRef.current === source) sourceRef.current = null
        resolve()
      }
      sourceRef.current = source
      if (runRef.current !== run) { resolve(); return }
      source.start()
    })
  }, [ensureContext])

  const stop = useCallback(() => {
    runRef.current++
    cacheRef.current.clear()
    chunksRef.current = []
    const source = sourceRef.current
    sourceRef.current = null
    if (source) {
      source.onended = null
      try { source.stop() } catch { /* already finished */ }
    }
    void ctxRef.current?.close().catch(() => undefined)
    ctxRef.current = null
    setStatus('idle')
    setIndex(-1)
    setCurrentText(null)
    setChunkCount(0)
    setApplying(false)
    // Nothing is left to apply once the bar is gone; carrying an unapplied
    // draft into the next document would show an Apply button for a change the
    // reader has long forgotten making.
    setDraftVoice(voiceRef.current)
    setDraftSpeed(speedRef.current)
    // Hand the ~570 MB back rather than leaving the worker resident.
    void window.electronAPI?.ttsStop?.()
  }, [])

  const speak = useCallback(async (chunks: string[]) => {
    stop()
    if (chunks.length === 0) return

    const run = ++runRef.current
    chunksRef.current = chunks
    setChunkCount(chunks.length)
    setError(null)
    setStatus('preparing')

    // Created inside the click that started playback, so the autoplay policy
    // lets it make sound.
    const ctx = ensureContext()
    if (ctx.state === 'suspended') await ctx.resume()

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (runRef.current !== run) return
        const buffer = await bufferFor(i)
        if (runRef.current !== run) return

        setIndex(i)
        setCurrentText(chunks[i])
        setStatus('speaking')
        // What is now audible was made with the settings currently selected, so
        // the controls are honest again.
        if (cacheRef.current.get(i)?.version === versionRef.current) setApplying(false)
        // Queue the next ones while this one is audible; failures here surface
        // when their turn comes, not now.
        for (let ahead = 1; ahead <= LOOKAHEAD; ahead++) {
          if (i + ahead < chunks.length) void bufferFor(i + ahead).catch(() => undefined)
        }
        await playBuffer(buffer, run)
        cacheRef.current.delete(i)
      }
      if (runRef.current === run) stop()
    } catch (err) {
      if (runRef.current !== run) return
      setError(err instanceof Error ? err.message : String(err))
      stop()
    }
  }, [bufferFor, ensureContext, playBuffer, stop])

  /**
   * Commit the draft settings, from the next sentence on.
   *
   * Two sentences are normally synthesized ahead, so without discarding them a
   * change would only be heard three sentences later — long enough that the
   * first thing a reader does is press again, thinking it did not take. Bumping
   * the version throws that work away; the sentence already sounding has to
   * finish either way, since it exists as rendered audio, and that is the whole
   * of the remaining wait.
   *
   * The refs are written here, in the same tick as the version bump. Syncing
   * them through an effect instead leaves a gap in which the playback loop can
   * synthesize with the *old* voice and tag it with the *new* version — which
   * unlocks the controls while the previous voice is still being heard.
   */
  const applySettings = useCallback(() => {
    if (draftVoice === voiceRef.current && draftSpeed === speedRef.current) return
    voiceRef.current = draftVoice
    speedRef.current = draftSpeed
    setVoice(draftVoice)
    setSpeed(draftSpeed)
    versionRef.current++
    // Only meaningful mid-document. When nothing is playing the next `speak`
    // starts fresh with the new settings, so there is nothing to wait for.
    if (chunksRef.current.length > 0) setApplying(true)
  }, [draftVoice, draftSpeed])

  const pause = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx || ctx.state !== 'running') return
    await ctx.suspend()
    setStatus('paused')
  }, [])

  const resume = useCallback(async () => {
    const ctx = ctxRef.current
    if (!ctx || ctx.state !== 'suspended') return
    await ctx.resume()
    setStatus('speaking')
  }, [])

  const download = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.ttsDownload) return
    setDownloading(true)
    setError(null)
    try {
      const result = await api.ttsDownload()
      if (!result.ok && result.error) setError(result.error)
    } finally {
      setDownloading(false)
      setDownloadProgress(null)
      await refreshModel()
    }
  }, [refreshModel])

  const cancelDownload = useCallback(() => {
    void window.electronAPI?.ttsCancelDownload?.()
  }, [])

  // Leaving the app mid-sentence must not leave a worker holding 570 MB.
  useEffect(() => stop, [stop])

  const state: TtsState = {
    status, index, currentText, applying, chunkCount, error, model, downloading,
    downloadProgress, voice, speed, draftVoice, draftSpeed,
    canApply: draftVoice !== voice || draftSpeed !== speed,
  }

  return {
    ...state,
    speak, pause, resume, stop,
    setVoice: setDraftVoice, setSpeed: setDraftSpeed, applySettings,
    download, cancelDownload, refreshModel,
  }
}
