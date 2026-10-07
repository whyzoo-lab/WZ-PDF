import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { importEsm } from './esm'
import { canBatch, splitBatch } from './ttsBatch'

/**
 * Text-to-speech, run in a `utilityProcess` — not the main process.
 *
 * Measured on the packaged runtime: loading Supertonic 3 takes the process from
 * 64 MB to 499 MB, and 631 MB after a few sentences. A document viewer's main
 * process must not carry that for the rest of the session, and it does not have
 * to: this process is spawned when the user starts listening and killed when
 * they stop, which returns every byte to the OS. Isolating a native module
 * (onnxruntime-node) from the process that owns the window is a second reason —
 * a crash in it closes a helper, not the app.
 *
 * Speed is the same as everywhere else worth having: RTF 0.29x on CPU, matching
 * WebGPU in the renderer and beating renderer WASM (0.93x) more than threefold.
 * That is why synthesis lives here rather than beside the OCR runtime.
 *
 * Protocol: one request in, one reply out, correlated by `id`. See ttsEngine.ts.
 */

// Only what we call. The vendored helper ships no type declarations, and
// spelling the shape out here is what makes an upstream signature change a
// compile error instead of a runtime one.
interface VoiceStyle { ttl: { dims: number[] } }

interface TextToSpeech {
  sampleRate: number
  call(
    text: string,
    lang: string,
    style: VoiceStyle,
    totalStep: number,
    speed?: number,
    silenceDuration?: number,
  ): Promise<{ wav: number[]; duration: number[] }>
  batch(
    texts: string[],
    langs: string[],
    style: VoiceStyle,
    totalStep: number,
    speed?: number,
  ): Promise<{ wav: number[]; duration: number[] }>
}

interface SupertonicHelper {
  loadTextToSpeech(onnxDir: string, useGpu?: boolean): Promise<TextToSpeech>
  loadVoiceStyle(voiceStylePaths: string[], verbose?: boolean): VoiceStyle
}

export interface TtsLoadRequest {
  type: 'load'
  modelDir: string
}

export interface TtsSynthesizeRequest {
  type: 'synthesize'
  id: number
  text: string
  lang: string
  voice: string
  speed: number
  totalStep: number
}

/** Several sentences at once, for a narrated video (see ttsBatch.ts). */
export interface TtsSynthesizeBatchRequest {
  type: 'synthesize-batch'
  id: number
  texts: string[]
  langs: string[]
  voice: string
  speed: number
  totalStep: number
}

export type TtsRequest = TtsLoadRequest | TtsSynthesizeRequest | TtsSynthesizeBatchRequest

export type TtsResponse =
  | { type: 'ready'; sampleRate: number }
  | { type: 'audio'; id: number; pcm: Float32Array; sampleRate: number }
  | { type: 'audio-batch'; id: number; pcms: Float32Array[]; sampleRate: number }
  | { type: 'error'; id: number | null; message: string }

let engine: TextToSpeech | null = null
let helper: SupertonicHelper | null = null
const styles = new Map<string, VoiceStyle>()

function send(message: TtsResponse): void {
  process.parentPort.postMessage(message)
}

async function load(modelDir: string): Promise<void> {
  // The helper resolves `onnxruntime-node` and `fft.js` as bare specifiers, so
  // it must be imported from its own location for Node to find them.
  const helperPath = path.join(__dirname, 'vendor', 'supertonic', 'helper.js')
  helper = await importEsm<SupertonicHelper>(pathToFileURL(helperPath).href)
  // `false` selects CPU. The helper throws outright on `true` — its GPU path is
  // not implemented — so this argument is not a preference, it is the only
  // value that works.
  engine = await helper.loadTextToSpeech(path.join(modelDir, 'onnx'), false)
  send({ type: 'ready', sampleRate: engine.sampleRate })
}

function styleFor(modelDir: string, voice: string, count = 1): VoiceStyle {
  const key = `${voice}x${count}`
  const cached = styles.get(key)
  if (cached) return cached
  if (!helper) throw new Error('engine is not loaded')
  // loadVoiceStyle takes an ARRAY of paths — it batches speakers. Passing the
  // string reads its first character as a filename, which fails with an ENOENT
  // naming a single letter and no hint about why. A batch needs one entry per
  // sentence, even when they are all the same voice.
  const file = path.join(modelDir, 'voice_styles', `${voice}.json`)
  const style = helper.loadVoiceStyle(Array.from({ length: count }, () => file))
  styles.set(key, style)
  return style
}

async function synthesize(modelDir: string, request: TtsSynthesizeRequest): Promise<void> {
  if (!engine) throw new Error('engine is not loaded')
  const style = styleFor(modelDir, request.voice)
  const { wav } = await engine.call(
    request.text, request.lang, style, request.totalStep, request.speed)
  // The helper returns a plain number[]; structured-cloning 450k boxed numbers
  // per sentence is far slower than the synthesis itself.
  send({
    type: 'audio',
    id: request.id,
    pcm: Float32Array.from(wav),
    sampleRate: engine.sampleRate,
  })
}

async function synthesizeBatch(modelDir: string, request: TtsSynthesizeBatchRequest): Promise<void> {
  if (!engine) throw new Error('engine is not loaded')
  const { texts, langs, voice, totalStep, speed } = request
  let pcms: Float32Array[]
  if (canBatch(texts, langs)) {
    const { wav, duration } = await engine.batch(texts, langs, styleFor(modelDir, voice, texts.length), totalStep, speed)
    pcms = splitBatch(wav, duration, engine.sampleRate)
  } else {
    // One sentence, or one too long to go through in a single piece.
    pcms = []
    for (const [i, text] of texts.entries()) {
      const { wav } = await engine.call(text, langs[i], styleFor(modelDir, voice), totalStep, speed)
      pcms.push(Float32Array.from(wav))
    }
  }
  send({ type: 'audio-batch', id: request.id, pcms, sampleRate: engine.sampleRate })
}

let modelDir = ''

process.parentPort.on('message', event => {
  const request = event.data as TtsRequest
  const failed = (id: number | null) => (err: unknown) =>
    send({ type: 'error', id, message: err instanceof Error ? err.message : String(err) })

  if (request.type === 'load') {
    modelDir = request.modelDir
    load(modelDir).catch(failed(null))
    return
  }
  if (request.type === 'synthesize') {
    synthesize(modelDir, request).catch(failed(request.id))
  }
  if (request.type === 'synthesize-batch') {
    synthesizeBatch(modelDir, request).catch(failed(request.id))
  }
})
