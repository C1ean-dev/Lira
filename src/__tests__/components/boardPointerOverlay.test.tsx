import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoardPointerOverlay } from '../../components/collaboration/BoardPointerOverlay'
import { useBoardPointerStore } from '../../store/useBoardPointerStore'
vi.mock('../../store/useBoardPointerStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useBoardPointerStore')>()
  return { ...actual, useBoardPointerStore: Object.assign((select: any) => select(actual.useBoardPointerStore.getState()), actual.useBoardPointerStore) }
})
afterEach(() => { useBoardPointerStore.getState().reset(); vi.restoreAllMocks() })
describe('temporary cursor effects', () => {
  it('renders a remote laser and fading trail in board coordinates at the viewer zoom', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1200)
    const store = useBoardPointerStore.getState()
    store.update('alice', { x: 100, y: 200 }, 1, 1000, 'laser', 'Alice')
    store.update('alice', { x: 150, y: 250 }, 2, 1100, 'laser', 'Alice')
    const html = renderToStaticMarkup(<BoardPointerOverlay zoom={2} />)
    expect(html).toContain('data-pointer-kind="laser"')
    expect(html).toContain('cx="150" cy="250" r="2"')
    expect(html).toContain('<line')
    expect(html).toContain('Alice')
    expect(html).toContain('pointer-events="none"')
    vi.mocked(Date.now).mockReturnValue(2000)
    expect(renderToStaticMarkup(<BoardPointerOverlay zoom={2} />)).not.toContain('<circle')
  })
  it('keeps the eraser ring visible while hovering and removes it when leaving the board', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2000)
    useBoardPointerStore.getState().update('$local', { x: 80, y: 90 }, 1, 1000, 'eraser')
    expect(renderToStaticMarkup(<BoardPointerOverlay zoom={1} />)).toContain('cx="80" cy="90" r="10"')
    useBoardPointerStore.getState().remove('$local')
    expect(renderToStaticMarkup(<BoardPointerOverlay zoom={1} />)).not.toContain('<circle')
  })
})
