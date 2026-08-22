import path from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { modelStatus } from './ttsModel'
import type { TtsResponse, TtsSynthesizeRequest } from './ttsWorker'

/**
 * Main-process side of text-to-speech: owns the worker's lifetime and turns its
 * message stream back into promises.
 *
 * The worker holds ~570 MB once loaded (see ttsWorker.ts), so it is spawned on
 * first use and killed when playback stops or after a spell of silence. Every
 * wait has a deadline for the reason the console converters do: without one the
 * caller hangs forever on a child that died, and nothing in the UI ever says so.
 */

/** Cold start reads 383 MB of weights; on a slow disk that is not quick. */
const LOAD_TIMEOUT_MS = 120_000
/** A sentence is ~3 s at RTF 0.29x. This only catches a wedged worker. */
const SYNTH_TIMEOUT_MS = 60_000
/** Release the memory if the user stopped listening and forgot about it. */
const IDLE_SHUTDOWN_MS = 5 * 60_000

export interface SynthesizeOptions {
  text: string
  voice: string
  lang: string
  speed: number
  totalStep: number
}

export interface SynthesizedAudio {
  pcm: Float32Array
  sampleRate: number
}

interface Pending {
  resolve: (audio: SynthesizedAudio) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

let child: UtilityProcess | null = null
let ready: Promise<void> | null = null
let nextId = 1
let idleTimer: NodeJS.Timeout | null = null
const pending = new Map<number, Pending>()

function rejectAll(reason: string): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
  }
  pending.clear()
}

/** Kill the worker and forget it; the next request starts a fresh one. */
export function shutdown(): void {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  rejectAll('Speech stopped')
  child?.kill()
  child = null
  ready = null
}

function touchIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(shutdown, IDLE_SHUTDOWN_MS)
}

function handleMessage(message: TtsResponse): void {
  if (message.type === 'audio') {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    entry.resolve({ pcm: message.pcm, sampleRate: message.sampleRate })
    return
  }
  if (message.type === 'error' && message.id !== null) {
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    entry.reject(new Error(message.message))
  }
}

function start(): Promise<void> {
  const status = modelStatus()
  if (!status.ready) {
    return Promise.reject(new Error('The speech model is not downloaded yet'))
  }

  return new Promise<void>((resolve, reject) => {
    const worker = utilityProcess.fork(path.join(__dirname, 'ttsWorker.js'), [], {
      serviceName: 'wz-pdf-tts',
      // Inherited so a failure inside the worker is visible in a dev terminal
      // instead of vanishing into a silent exit.
      stdio: 'inherit',
    })
    child = worker

    const timer = setTimeout(() => {
      shutdown()
      reject(new Error('Speech engine did not start in time'))
    }, LOAD_TIMEOUT_MS)

    worker.on('message', (message: TtsResponse) => {
      if (message.type === 'ready') {
        clearTimeout(timer)
        resolve()
        return
      }
      // A load failure arrives with no id, and must fail the start, not sit in
      // the pending map waiting for a request that will never match it.
      if (message.type === 'error' && message.id === null) {
        clearTimeout(timer)
        const reason = message.message
        shutdown()
        reject(new Error(reason))
        return
      }
      handleMessage(message)
    })

    worker.on('exit', () => {
      clearTimeout(timer)
      // Only tear down if this is still the current worker: a late exit event
      // from a killed one must not clobber its replacement.
      if (child === worker) {
        child = null
        ready = null
        rejectAll('Speech engine stopped unexpectedly')
      }
      reject(new Error('Speech engine stopped unexpectedly'))
    })

    worker.postMessage({ type: 'load', modelDir: status.dir })
  })
}

export function ensureReady(): Promise<void> {
  if (!ready) ready = start().catch(err => { ready = null; throw err })
  return ready
}

export async function synthesize(options: SynthesizeOptions): Promise<SynthesizedAudio> {
  await ensureReady()
  const worker = child
  if (!worker) throw new Error('Speech engine is not running')

  const id = nextId++
  const request: TtsSynthesizeRequest = { type: 'synthesize', id, ...options }

  return new Promise<SynthesizedAudio>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Speech synthesis timed out'))
    }, SYNTH_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    worker.postMessage(request)
    touchIdleTimer()
  })
}
