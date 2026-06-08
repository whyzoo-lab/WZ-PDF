import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { PresentationOverlay } from './PresentationOverlay'
import { DEFAULT_TOOL_STATE } from '../../utils/presentTools'
import type { PresentStroke } from '../../types/present'

const strokes: PresentStroke[] = [
  { id: 'a', kind: 'pen', color: '#ef4444', width: 4, points: [0, 0, 10, 10] },
  { id: 'b', kind: 'rect', color: '#3b82f6', width: 4, x1: 5, y1: 5, x2: 25, y2: 35 },
  { id: 'c', kind: 'arrow', color: '#22c55e', width: 4, x1: 0, y1: 0, x2: 40, y2: 0 },
]

describe('PresentationOverlay', () => {
  it('renders committed strokes (polyline + rect + arrow group)', () => {
    const { container } = render(
      <PresentationOverlay strokes={strokes} tool={DEFAULT_TOOL_STATE} onAddStroke={() => {}} />,
    )
    expect(container.querySelector('polyline')).not.toBeNull()
    expect(container.querySelector('rect')).not.toBeNull()
    expect(container.querySelector('line')).not.toBeNull()
    expect(container.querySelector('polygon')).not.toBeNull()
  })

  it('does not capture pointer events when no drawing tool is active', () => {
    const { container } = render(
      <PresentationOverlay strokes={[]} tool={{ ...DEFAULT_TOOL_STATE, kind: null }} onAddStroke={() => {}} />,
    )
    const svg = container.querySelector('svg') as SVGElement
    expect(getComputedStyle(svg).pointerEvents).toBe('none')
  })

  it('commits a rectangle stroke on pointer down→move→up', () => {
    const onAddStroke = vi.fn()
    const { container } = render(
      <PresentationOverlay strokes={[]} tool={{ kind: 'rect', color: '#ef4444', width: 4 }} onAddStroke={onAddStroke} />,
    )
    const svg = container.querySelector('svg') as SVGElement
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(svg, { clientX: 30, clientY: 50 })
    fireEvent.pointerUp(svg, { clientX: 30, clientY: 50 })
    expect(onAddStroke).toHaveBeenCalledTimes(1)
    expect(onAddStroke.mock.calls[0][0]).toMatchObject({ kind: 'rect', x1: 10, y1: 10, x2: 30, y2: 50 })
  })

  it('shows a laser dot when the laser tool is active', () => {
    const { container } = render(
      <PresentationOverlay strokes={[]} tool={{ kind: 'laser', color: '#ef4444', width: 4 }} onAddStroke={() => {}} />,
    )
    fireEvent.pointerMove(window, { clientX: 100, clientY: 120 })
    expect(container.querySelector('.wz-laser-dot')).not.toBeNull()
  })
})
