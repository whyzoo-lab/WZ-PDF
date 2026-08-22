/**
 * The voices the model ships with.
 *
 * Supertonic names them F1–F5 and M1–M5 and nothing else, so the labels here
 * are ours. They stay deliberately plain — a made-up persona name would imply a
 * character the model does not actually have, and the numbers are what the
 * files are called, which is what someone comparing them will see.
 */
export const VOICE_LABELS: readonly { id: string; label: string }[] = [
  { id: 'F1', label: 'F1' },
  { id: 'F2', label: 'F2' },
  { id: 'F3', label: 'F3' },
  { id: 'F4', label: 'F4' },
  { id: 'F5', label: 'F5' },
  { id: 'M1', label: 'M1' },
  { id: 'M2', label: 'M2' },
  { id: 'M3', label: 'M3' },
  { id: 'M4', label: 'M4' },
  { id: 'M5', label: 'M5' },
]

export const DEFAULT_VOICE = 'F1'
