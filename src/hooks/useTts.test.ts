import { describe, it, expect } from 'vitest'
import { previousTarget } from './useTts'

describe('where "back" goes', () => {
  it('re-reads the sentence once it is under way', () => {
    // The reason anyone presses back: they missed what was just said.
    expect(previousTarget(7, 4000)).toBe(7)
  })

  it('steps back when pressed straight away', () => {
    // Pressing again immediately means "no, the one before that".
    expect(previousTarget(7, 200)).toBe(6)
  })

  it('steps back from the very first moment of a sentence', () => {
    expect(previousTarget(7, 0)).toBe(6)
  })

  it('can go before the first sentence, for the caller to clamp', () => {
    // `jumpTo` clamps; keeping that out of here means the rule stays one idea.
    expect(previousTarget(0, 100)).toBe(-1)
  })
})
