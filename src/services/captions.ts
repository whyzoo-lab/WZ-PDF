/**
 * A subtitle of a narrated slide video (services/slideVideo.ts): one spoken
 * sentence and when it is on screen. Written into the MP4 as its subtitle
 * track by services/tx3g.ts.
 */
export interface Cue {
  /** Seconds. */
  start: number
  end: number
  text: string
}
