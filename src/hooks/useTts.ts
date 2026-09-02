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

/**
 * Sentences kept behind the one being spoken.
 *
 * Played audio used to be discarded immediately. Going back then had to
 * synthesize again, and the pause before hearing a sentence you just missed is
 * the one place a wait is least welcome. Four buffers of a few seconds each cost
 * a couple of megabytes.
 */
const KEEP_BEHIND = 2

/**
 * How far into a sentence "previous" starts meaning "this one again".
 *
 * Someone who missed what was just said presses back to hear it again — that is
 * what the control does on every audio player they have used. Pressing it again
 * straight away, before this much has elapsed, goes to the sentence before.
 */
const RESTART_AFTER_MS = 1500

/**
 * Where "back" goes: this sentence again, or the one before it.
 *
 * Split out because it is the only judgement in the transport, and through the
 * app it cannot be observed cleanly — playback keeps advancing on its own while
 * a test is measuring.
 */
export function previousTarget(cursor: number, msIntoSentence: number): number {
  return msIntoSentence > RESTART_AFTER_MS ? cursor : cursor - 1
}

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
  /**
   * The sentence the playback loop should speak next. It is a ref rather than a
   * loop variable because moving through the document is something the *reader*
   * does, from outside the loop, while it is awaiting audio.
   */
  const cursorRef = useRef(0)
  /** When the sentence now sounding began, for the back-versus-again decision. */
  const startedAtRef = useRef(0)
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
    cursorRef.current = 0
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
      cursorRef.current = 0
      // Driven by the cursor rather than a counter: `previous` and `next` move
      // it from outside while this loop is awaiting audio, and the loop simply
      // speaks wherever it points next.
      while (cursorRef.current < chunks.length) {
        const i = cursorRef.current
        if (runRef.current !== run) return
        // Jumping past the look-ahead lands on a sentence that has not been
        // made yet, and the wait should be reported like the first one is.
        if (!cacheRef.current.has(i)) setStatus('preparing')
        const buffer = await bufferFor(i)
        if (runRef.current !== run) return
        // A jump made while this sentence was being synthesized wins. Without
        // this the loop plays where the reader *was* when they pressed, and the
        // press looks ignored — which is most of the time, because jumping past
        // the look-ahead is exactly what puts us in this wait.
        if (cursorRef.current !== i) continue

        setIndex(i)
        setCurrentText(chunks[i])
        setStatus('speaking')
        startedAtRef.current = Date.now()
        // What is now audible was made with the settings currently selected, so
        // the controls are honest again.
        if (cacheRef.current.get(i)?.version === versionRef.current) setApplying(false)
        // Queue the next ones while this one is audible; failures here surface
        // when their turn comes, not now.
        for (let ahead = 1; ahead <= LOOKAHEAD; ahead++) {
          if (i + ahead < chunks.length) void bufferFor(i + ahead).catch(() => undefined)
        }
        await playBuffer(buffer, run)

        // Advance only if nothing moved the cursor while this sentence played;
        // if something did, that jump is where to go next.
        if (cursorRef.current === i) cursorRef.current = i + 1
        // Keep a short tail so going back is instant, and drop the rest.
        for (const key of cacheRef.current.keys()) {
          if (key < cursorRef.current - KEEP_BEHIND) cacheRef.current.delete(key)
        }
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

  /**
   * End the sentence that is sounding without ending the session.
   *
   * Deliberately not `stop()`: that one clears `onended` first, so the playback
   * loop's promise never settles and the loop is abandoned. Here the handler is
   * left in place, so cutting the audio short is exactly what lets the loop come
   * round again and read the cursor.
   */
  const cutCurrent = useCallback(() => {
    const source = sourceRef.current
    sourceRef.current = null
    if (source) {
      try { source.stop() } catch { /* already finished */ }
    }
  }, [])

  const jumpTo = useCallback((target: number) => {
    const total = chunksRef.current.length
    if (total === 0) return
    cursorRef.current = Math.max(0, Math.min(total - 1, target))
    // A jump made while paused would otherwise queue silently — the loop cannot
    // reach the next sentence until the context is running again. Pressing a
    // transport control means "play this", so play it.
    const ctx = ctxRef.current
    if (ctx?.state === 'suspended') {
      void ctx.resume().then(() => setStatus('speaking'))
    }
    cutCurrent()
  }, [cutCurrent])

  const next = useCallback(() => jumpTo(cursorRef.current + 1), [jumpTo])

  /** Back one sentence — or the start of this one, if it is already under way. */
  const previous = useCallback(() => {
    jumpTo(previousTarget(cursorRef.current, Date.now() - startedAtRef.current))
  }, [jumpTo])

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
    speak, pause, resume, stop, previous, next,
    setVoice: setDraftVoice, setSpeed: setDraftSpeed, applySettings,
    download, cancelDownload, refreshModel,
  }
}
