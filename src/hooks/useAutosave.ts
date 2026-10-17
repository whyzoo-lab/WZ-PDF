// Autosave for crash recovery (desktop app only).
//
// While the open document has unsaved changes, its state is handed to the
// main process every AUTOSAVE_MS (electron/recovery.ts): the document's bytes
// once per version of the file, and the lasting annotations or the Markdown
// being edited each time they change. When the changes are saved or thrown
// away the entry is removed, and a normal quit removes whatever is left — so
// what the next start finds is what a crash left behind.
//
// What is never written: an encrypted document (its contents would sit on disk
// in the clear), a document paged in by range (too large; it is view-only
// anyway), and an image collection whose page list was edited (its manifest
// names pictures by in-memory ids that mean nothing after a restart).

import { useEffect, useRef } from 'react'
import { isRangedFile, type DocumentFile } from '../services/documentSource'
import { IMAGE_SET_MIME } from '../types/viewerDoc'
import type { Annotation } from '../types/annotation'

export const AUTOSAVE_MS = 15_000
/** Bytes larger than this are not autosaved (matches MAX_BODY_BYTES in electron/recovery.ts). */
const MAX_BODY_BYTES = 200 * 1024 * 1024

export interface AutosaveState {
  /** The current document (a page edit replaces it). */
  file: DocumentFile | null
  /** The document as it was opened, before any page edit. */
  openedFile: DocumentFile | null
  /** Where it was opened from, when from disk. */
  path?: string
  unsaved: boolean
  /** It was opened with a password. */
  encrypted: boolean
  annotations: readonly Annotation[]
  /** The Markdown editor's text, when Markdown is what is unsaved. */
  markdownText: () => string | null
}

/** Whether this document's state may be written to disk at all. */
export function canAutosave(s: Pick<AutosaveState, 'file' | 'openedFile' | 'encrypted'>): boolean {
  if (!s.file || !s.openedFile || s.encrypted) return false
  if (isRangedFile(s.file)) return false
  if (s.file !== s.openedFile && s.file.type === IMAGE_SET_MIME) return false
  return s.file.size <= MAX_BODY_BYTES
}

/**
 * Keeps the open document's recovery entry, keyed by `keyRef` (a new key per
 * opened document; a recovered one keeps its key so it is overwritten, not
 * duplicated).
 */
export function useAutosave(state: AutosaveState, keyRef: { current: string }, keep?: (key: string) => boolean): void {
  const latest = useRef(state)
  const keepRef = useRef(keep)
  useEffect(() => { latest.current = state; keepRef.current = keep })
  // What was last written for which key, so an unchanged state is not
  // rewritten every tick. Annotations are immutable, so a changed list is a
  // different array.
  const written = useRef<{ key: string; bodyOf: DocumentFile; annotations: readonly Annotation[]; markdown?: string } | null>(null)
  const busy = useRef(false)

  // Saved, undone back to the saved state, or replaced by another document:
  // the entry goes.
  const { unsaved, openedFile } = state
  useEffect(() => {
    const w = written.current
    if (!w) return
    if (unsaved && keyRef.current === w.key) return
    written.current = null
    // A tab moved to the back with unsaved work keeps its entry: it is still open.
    if (keyRef.current !== w.key && keepRef.current?.(w.key)) return
    void window.electronAPI?.recoveryRemove?.(w.key).catch(() => {})
  }, [unsaved, openedFile, keyRef])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.recoverySave) return
    const tick = async () => {
      const s = latest.current
      if (busy.current || !s.unsaved || !canAutosave(s)) return
      const key = keyRef.current
      const markdownText = s.markdownText() ?? undefined
      const file = s.file as File
      const modified = file !== s.openedFile
      const prev = written.current?.key === key ? written.current : null
      if (prev && prev.bodyOf === file && prev.annotations === s.annotations && prev.markdown === markdownText) return
      busy.current = true
      try {
        const body = prev?.bodyOf === file ? null : await file.arrayBuffer()
        await api.recoverySave!({
          key, name: file.name, path: s.path, modified,
          annotations: s.annotations as unknown[], markdownText,
        }, body)
        // Only if nothing moved on meanwhile (another document opened).
        if (keyRef.current === key) written.current = { key, bodyOf: file, annotations: s.annotations, markdown: markdownText }
      } catch (err) {
        console.warn('Autosave failed:', err)
      } finally {
        busy.current = false
      }
    }
    const timer = window.setInterval(() => { void tick() }, AUTOSAVE_MS)
    return () => window.clearInterval(timer)
  }, [keyRef])
}

/** A fresh recovery key for a newly opened document. */
export function newRecoveryKey(): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).slice(2, 18)
  return `${Date.now().toString(36)}-${rnd}`.toLowerCase()
}
