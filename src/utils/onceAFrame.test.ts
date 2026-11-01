import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onceAFrame } from './onceAFrame'

describe('onceAFrame', () => {
  let frames: FrameRequestCallback[]
  beforeEach(() => {
    frames = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('runs once for any number of calls in a frame, and again in the next', () => {
    const fn = vi.fn()
    const run = onceAFrame(fn)
    run(); run(); run()
    expect(fn).not.toHaveBeenCalled()
    frames.splice(0).forEach(cb => cb(0))
    expect(fn).toHaveBeenCalledTimes(1)
    run()
    frames.splice(0).forEach(cb => cb(0))
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('runs nothing after cancel, and can be used again', () => {
    const fn = vi.fn()
    const run = onceAFrame(fn)
    run()
    run.cancel()
    expect(frames).toHaveLength(0)
    run()
    frames.splice(0).forEach(cb => cb(0))
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
