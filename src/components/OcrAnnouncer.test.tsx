import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OcrAnnouncer } from './OcrAnnouncer'

const said = () => screen.getByRole('status').textContent ?? ''

describe('announcing text recognition', () => {
  it('says nothing until something is running', () => {
    render(<OcrAnnouncer progress={null} />)
    expect(said()).toBe('')
  })

  it('speaks while recognising', () => {
    render(<OcrAnnouncer progress={{ done: 1, total: 10 }} />)
    expect(said()).toMatch(/인식|Recognizing/i)
  })

  it('does not speak on every page of a long document', () => {
    // 200 pages announced one by one would talk over everything else for
    // minutes. The message may only change about ten times over the run.
    const { rerender } = render(<OcrAnnouncer progress={{ done: 0, total: 200 }} />)
    const spoken = new Set<string>()
    for (let done = 0; done <= 200; done++) {
      rerender(<OcrAnnouncer progress={{ done, total: 200 }} />)
      spoken.add(said())
    }
    expect(spoken.size).toBeLessThanOrEqual(11)
  })

  it('still speaks a few times on a short document', () => {
    const { rerender } = render(<OcrAnnouncer progress={{ done: 0, total: 3 }} />)
    const spoken = new Set<string>()
    for (let done = 0; done <= 3; done++) {
      rerender(<OcrAnnouncer progress={{ done, total: 3 }} />)
      spoken.add(said())
    }
    expect(spoken.size).toBeGreaterThan(1)
  })

  it('says when it is finished', () => {
    // The part that matters: after a long wait, silence and success sound alike.
    const { rerender } = render(<OcrAnnouncer progress={{ done: 2, total: 4 }} />)
    rerender(<OcrAnnouncer progress={null} />)
    expect(said()).toMatch(/마쳤|finished/i)
  })

  it('does not announce a finish that never started', () => {
    const { rerender } = render(<OcrAnnouncer progress={null} />)
    rerender(<OcrAnnouncer progress={null} />)
    expect(said()).toBe('')
  })
})

describe('recognising a single page', () => {
  it('does not count pages when there is only one', () => {
    render(<OcrAnnouncer progress={{ done: 0, total: 1 }} />)
    expect(said()).not.toMatch(/1.*0|0.*1/)
    expect(said()).toMatch(/인식|Recognizing/i)
  })
})
