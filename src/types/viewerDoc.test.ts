import { describe, it, expect } from 'vitest'
import type { ViewerDoc } from './viewerDoc'

describe('ViewerDoc', () => {
  it('accepts a pdfjs-shaped object structurally', () => {
    const fake: ViewerDoc = {
      numPages: 2,
      getPage: async () => ({
        getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }),
        render: () => ({ promise: Promise.resolve() }),
        getTextContent: async () => ({ items: [] }),
      }),
      destroy: () => {},
    }
    expect(fake.numPages).toBe(2)
  })
})
