import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SpeechAnnouncer } from './SpeechAnnouncer'

const said = () => screen.getByRole('status').textContent ?? ''

describe('announcing read-aloud', () => {
  it('is present and silent before anything happens', () => {
    // Present matters: a live region inserted with its text already in it is
    // not announced — it has to exist first and then change.
    render(<SpeechAnnouncer status="idle" />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(said()).toBe('')
  })

  it('says it is getting ready, then that it is reading', () => {
    const { rerender } = render(<SpeechAnnouncer status="idle" />)
    rerender(<SpeechAnnouncer status="preparing" />)
    expect(said()).toMatch(/준비|ready/i)
    rerender(<SpeechAnnouncer status="speaking" />)
    expect(said()).toMatch(/읽는|Reading the/i)
  })

  it('distinguishes a pause from the end', () => {
    // Both are silence. Only the announcement tells them apart.
    const { rerender } = render(<SpeechAnnouncer status="speaking" />)
    rerender(<SpeechAnnouncer status="paused" />)
    const paused = said()
    rerender(<SpeechAnnouncer status="idle" />)
    expect(said()).not.toBe(paused)
    expect(said()).toMatch(/마쳤|finished/i)
  })

  it('says nothing when it was never reading', () => {
    const { rerender } = render(<SpeechAnnouncer status="idle" />)
    rerender(<SpeechAnnouncer status="idle" />)
    expect(said()).toBe('')
  })
})

describe('moving through the document', () => {
  it('does not repeat itself on every jump', () => {
    // Each jump goes preparing -> speaking again. Announcing that every time
    // would talk over the very sentence the reader jumped to hear.
    const { rerender } = render(<SpeechAnnouncer status="idle" />)
    rerender(<SpeechAnnouncer status="preparing" />)
    rerender(<SpeechAnnouncer status="speaking" />)
    const opening = said()

    rerender(<SpeechAnnouncer status="preparing" />)
    expect(said()).toBe(opening)
    rerender(<SpeechAnnouncer status="speaking" />)
    expect(said()).toBe(opening)
  })

  it('tells the reader which keys move it, once', () => {
    // Someone who cannot see the bar has no other way to find them.
    const { rerender } = render(<SpeechAnnouncer status="idle" />)
    rerender(<SpeechAnnouncer status="speaking" />)
    expect(said()).toMatch(/Alt/i)
  })

  it('starts explaining again for the next document', () => {
    const { rerender } = render(<SpeechAnnouncer status="speaking" />)
    rerender(<SpeechAnnouncer status="idle" />)
    rerender(<SpeechAnnouncer status="preparing" />)
    expect(said()).toMatch(/준비|ready/i)
  })

  it('still reports a pause after a jump', () => {
    const { rerender } = render(<SpeechAnnouncer status="speaking" />)
    rerender(<SpeechAnnouncer status="preparing" />)
    rerender(<SpeechAnnouncer status="speaking" />)
    rerender(<SpeechAnnouncer status="paused" />)
    expect(said()).toMatch(/일시정지|paused/i)
  })
})
