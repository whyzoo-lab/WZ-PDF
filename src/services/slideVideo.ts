import {
  AudioSample, AudioSampleSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality,
  canEncodeAudio, canEncodeVideo,
} from 'mediabunny'
import { planSpeech } from './ttsText'
import type { Cue } from './captions'
import { frameTimes, pcmPieces, planSlide, snapToFrame, TIMING, type PlannedSlide, type SpokenSentence } from './slideTimeline'
import { addTx3gTrack } from './tx3g'
import { getPdfWorkerUrl } from './pdfjsWorker'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * A deck's slides with its speaker notes read over them, as one MP4 — the
 * slideshow with read-aloud, recorded.
 *
 * Slides come from the deck's PDF (the same print the "Save as PDF" writes, so
 * hidden slides are already out and every slide looks as it prints); the voice
 * is the read-aloud engine, sentence by sentence. The file is H.264 + AAC with
 * the script inside as a subtitle track a player can switch on and off
 * (services/tx3g.ts). Encoding is WebCodecs, through mediabunny — no FFmpeg.
 *
 * One file on purpose: the first version also wrote a copy with the captions
 * drawn in, a .srt and a .vtt, and four files for one talk was more than
 * anyone wanted — the subtitles inside the MP4 cover it.
 */

/** The voice engine: sentences in, one mono clip each out, in order. */
export type Synthesize = (texts: string[]) => Promise<{ pcm: Float32Array; sampleRate: number }[]>

export interface SlideVideoInput {
  /** One page per slide shown, in order. */
  pdf: Uint8Array
  /** The script for each page, '' for none. */
  notes: readonly string[]
  synthesize: Synthesize
  /** ISO 639-2/T for the subtitle and audio tracks, e.g. `kor`. */
  language: string
  /** Name of the subtitle track in players' menus. */
  captionName: string
  onProgress?: (progress: { slide: number; slides: number; sentence: number; sentences: number }) => void
  signal?: AbortSignal
}

export interface SlideVideoResult {
  mp4: Uint8Array
  /** Seconds. */
  duration: number
}

/** The largest frame: 1080p, the slide's own shape inside it. */
const MAX_W = 1920
const MAX_H = 1080
/** The read-aloud engine speaks at 44.1 kHz; everything is kept at that rate. */
const SAMPLE_RATE = 44100
/**
 * Longest stretch without a key frame. Every slide already starts with one, so
 * this only matters for a long slide; seeking inside it decodes from the
 * slide's start, which is a handful of near-empty frames.
 */
const KEY_FRAME_SECONDS = 60
/**
 * A frame at least this often even when nothing changes. Every frame costs
 * bytes even when it repeats the last one — the encoder keeps spending its
 * budget refining a still picture — so it is only as often as key frames and
 * seeking need.
 */
const HEARTBEAT_SECONDS = 5
/**
 * Sentences voiced per call. The engine does a batch in one pass of its model,
 * and five at a time ran 1.7x faster than one by one (electron/ttsBatch.ts).
 */
const VOICE_BATCH = 5
/** Sound is fed in pieces no longer than this — a second — interleaved with the frames. */
const AUDIO_PIECE = SAMPLE_RATE

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** The video frame for a slide of this shape: as large as fits in 1080p. */
export function frameSize(slideWidth: number, slideHeight: number): { width: number; height: number } {
  const scale = Math.min(MAX_W / slideWidth, MAX_H / slideHeight)
  return { width: even(slideWidth * scale), height: even(slideHeight * scale) }
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
}

/** Linear resampling, for an engine that does not answer at 44.1 kHz. */
function resample(pcm: Float32Array, from: number): Float32Array {
  if (from === SAMPLE_RATE) return pcm
  const out = new Float32Array(Math.round(pcm.length * SAMPLE_RATE / from))
  for (let i = 0; i < out.length; i++) {
    const x = i * from / SAMPLE_RATE
    const a = Math.floor(x)
    const b = Math.min(a + 1, pcm.length - 1)
    out[i] = pcm[a] + (pcm[b] - pcm[a]) * (x - a)
  }
  return out
}

async function openPdf(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist')
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = getPdfWorkerUrl()
  const base = new URL('./', document.baseURI)
  // The same options the viewer opens documents with (usePdfDocument.ts):
  // FontFace off because it can hang in Electron, and the wasm decoders,
  // standard fonts and CMaps it then needs from our own folders.
  return pdfjs.getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    wasmUrl: new URL('wasm/', base).href,
    standardFontDataUrl: new URL('standard_fonts/', base).href,
    cMapUrl: new URL('cmaps/', base).href,
    cMapPacked: true,
  })
}

/** One slide as a full frame: the page fitted inside, on black. */
async function renderSlide(doc: PDFDocumentProxy, pageNumber: number, width: number, height: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber)
  const unit = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: Math.min(width / unit.width, height / unit.height) })
  const pageCanvas = document.createElement('canvas')
  pageCanvas.width = Math.ceil(viewport.width)
  pageCanvas.height = Math.ceil(viewport.height)
  // The print intent, not display: display rendering paces itself with
  // requestAnimationFrame, which never fires while the window is hidden, so a
  // video started and then left to run behind another window stalled on its
  // first slide. Print renders straight through (verified in a hidden tab:
  // display never finished, print took 3 s).
  await page.render({ canvas: pageCanvas, viewport, intent: 'print' }).promise
  page.cleanup()
  const frame = document.createElement('canvas')
  frame.width = width
  frame.height = height
  const ctx = frame.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(pageCanvas, Math.round((width - pageCanvas.width) / 2), Math.round((height - pageCanvas.height) / 2))
  return frame
}

export async function buildSlideVideo(input: SlideVideoInput): Promise<SlideVideoResult> {
  const { signal } = input
  // pdfjs 6 destroys through the loading task, not the document (CLAUDE.md).
  const loading = await openPdf(input.pdf)
  const doc = await loading.promise
  let output: Output | null = null
  try {
    const pages = doc.numPages
    const first = (await doc.getPage(1)).getViewport({ scale: 1 })
    const { width, height } = frameSize(first.width, first.height)

    if (!(await canEncodeVideo('avc', { width, height }))) throw new Error('H.264 encoding is not available')
    if (!(await canEncodeAudio('aac', { numberOfChannels: 1, sampleRate: SAMPLE_RATE }))) throw new Error('AAC encoding is not available')

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    const target = new BufferTarget()
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
    // Slides are still pictures, so nearly all of a file is its key frames: one
    // every two seconds made a six-minute talk 46 MB. A key frame starts each
    // slide (forced where it is added), and otherwise only a long slide gets
    // another. 96 kbit/s is plenty for one voice.
    const video = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high'), keyFrameInterval: KEY_FRAME_SECONDS, latencyMode: 'quality', contentHint: 'text' })
    const audio = new AudioSampleSource({ codec: 'aac', quality: new Quality({ bitrate: 96_000 }) })
    output.addVideoTrack(video, { frameRate: 30 })
    output.addAudioTrack(audio, { languageCode: input.language })
    await output.start()

    const scripts = Array.from({ length: pages }, (_, i) => planSpeech(input.notes[i] ?? '').chunks)
    const sentences = scripts.reduce((n, s) => n + s.length, 0)
    let spoken = 0
    const report = (slide: number) => input.onProgress?.({ slide, slides: pages, sentence: spoken, sentences })

    const cues: Cue[] = []
    let audioAt = 0 // samples planned so far
    const addAudio = async (piece: { at: number; pcm: Float32Array }) => {
      const sample = new AudioSample({ data: piece.pcm, format: 'f32', numberOfChannels: 1, sampleRate: SAMPLE_RATE, timestamp: piece.at / SAMPLE_RATE })
      await audio.add(sample)
      sample.close()
    }

    let previous: HTMLCanvasElement | null = null
    let start = 0
    for (let p = 0; p < pages; p++) {
      aborted(signal)
      report(p + 1)
      // The voice first: it decides how long the slide stays up.
      const voiced: { pcm: Float32Array; sentence: SpokenSentence }[] = []
      for (let i = 0; i < scripts[p].length; i += VOICE_BATCH) {
        aborted(signal)
        const texts = scripts[p].slice(i, i + VOICE_BATCH)
        const clips = await input.synthesize(texts)
        if (clips.length !== texts.length) throw new Error('The voice engine returned the wrong number of sentences')
        for (const [k, { pcm, sampleRate }] of clips.entries()) {
          const speech = resample(pcm, sampleRate)
          voiced.push({ pcm: speech, sentence: { text: texts[k], duration: speech.length / SAMPLE_RATE } })
        }
        spoken += texts.length
        report(p + 1)
      }
      const slide: PlannedSlide = planSlide(start, voiced.map(v => v.sentence))
      cues.push(...slide.cues)

      // Sound: silence up to each sentence, the sentence, silence to the end —
      // in pieces of at most a second.
      const sound: { at: number; pcm: Float32Array }[] = []
      const pushSound = (pcm: Float32Array) => {
        // Copies, not views: see pcmPieces for what views did to the voice.
        for (const part of pcmPieces(pcm, AUDIO_PIECE)) {
          sound.push({ at: audioAt, pcm: part })
          audioAt += part.length
        }
      }
      const silenceUntil = (seconds: number) => {
        const target = Math.round(seconds * SAMPLE_RATE)
        if (target > audioAt) pushSound(new Float32Array(target - audioAt))
      }
      for (const [i, v] of voiced.entries()) {
        silenceUntil(slide.sentenceStarts[i])
        pushSound(v.pcm)
      }
      silenceUntil(slide.end)

      // Picture: only the frames where something changes (slideTimeline.ts).
      const current = await renderSlide(doc, p + 1, width, height)
      const times = frameTimes(slide, { fade: previous !== null, heartbeat: HEARTBEAT_SECONDS })
      // Sound and picture go in together, in time order: the muxer interleaves
      // the tracks and holds one back until the other catches up, so a whole
      // slide of sound ahead of its first frame waited forever.
      let s = 0
      for (const [i, t] of times.entries()) {
        aborted(signal)
        while (s < sound.length && sound[s].at / SAMPLE_RATE <= t) await addAudio(sound[s++])
        const next = i + 1 < times.length ? times[i + 1] : snapToFrame(slide.end)
        const fade = previous ? Math.min(1, (t - slide.start) / TIMING.fade) : 1
        ctx.globalAlpha = 1
        if (previous && fade < 1) {
          ctx.drawImage(previous, 0, 0)
          ctx.globalAlpha = fade
        }
        ctx.drawImage(current, 0, 0)
        ctx.globalAlpha = 1
        // A new slide starts with a key frame, so seeking to it is exact.
        await video.add(t, next - t, { keyFrame: i === 0 })
      }
      while (s < sound.length) await addAudio(sound[s++])
      previous = current
      start = slide.end
    }

    aborted(signal)
    await output.finalize()
    const duration = start
    const mp4 = addTx3gTrack(new Uint8Array(target.buffer!), {
      cues, duration, width, height, language: input.language, name: input.captionName,
    })
    return { mp4, duration }
  } catch (err) {
    // Cancelled or failed: release the encoder rather than leave it open.
    if (output?.state === 'started') await output.cancel().catch(() => undefined)
    throw err
  } finally {
    void loading.destroy()
  }
}
