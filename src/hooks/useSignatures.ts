// The open PDF's digital signatures, read and checked whenever its bytes
// change (services/pdfSignatures, lazily: pkijs is only fetched for a file
// that has a /ByteRange at all).

import { useEffect, useState } from 'react'
import type { DocKind } from '../types/viewerDoc'
import type { SignatureInfo } from '../services/pdfSignatures'

export function useSignatures(bytes: ArrayBuffer | null, kind: DocKind): SignatureInfo[] {
  const [state, setState] = useState<{ bytes: ArrayBuffer | null; list: SignatureInfo[] }>({ bytes: null, list: [] })
  useEffect(() => {
    if (!bytes || kind !== 'pdf') return
    let cancelled = false
    void (async () => {
      const { hasSignatures } = await import('../services/pdfExporter')
      if (!hasSignatures(bytes)) { if (!cancelled) setState({ bytes, list: [] }); return }
      const { readSignatures } = await import('../services/pdfSignatures')
      const list = await readSignatures(new Uint8Array(bytes)).catch(() => [])
      if (!cancelled) setState({ bytes, list })
    })()
    return () => { cancelled = true }
  }, [bytes, kind])
  return state.bytes === bytes ? state.list : []
}
