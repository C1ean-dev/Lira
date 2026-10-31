import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FullScreenLiveOverlay } from '../../components/grid/FullScreenLiveOverlay'
import { useLiveViewBox } from '../../hooks/useLiveViewBox'

const metadata = vi.hoisted(() => ({ aspectRatio: null as number | null }))

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    useState: (initial: unknown) => actual.useState(initial === null ? metadata.aspectRatio : initial),
  }
})
vi.mock('../../hooks/useLiveGate', () => ({
  useLiveGate: () => ({ needsClick: false, watching: true, connecting: false }),
}))
vi.mock('../../hooks/useLiveViewBox', () => ({ useLiveViewBox: vi.fn() }))
vi.mock('../../hooks/useLiveTransmissionStats', () => ({ useLiveTransmissionStats: () => [] }))
vi.mock('../../store/useMediaStore', () => ({
  useMediaStore: (select: any) => select({ removeCaptureBorder: false }),
}))

describe('fullscreen live sizing', () => {
  it('replaces the live label with the information icon and requests full source quality', () => {
    const html = renderToStaticMarkup(
      <FullScreenLiveOverlay user={{ id: 'presenter', name: 'Ana', stream: null, isScreenSharing: true }} onClose={() => {}} />,
    )
    expect(html).toContain('aria-label="Informações da transmissão"')
    expect(html).not.toContain('AO VIVO')
    expect(useLiveViewBox).toHaveBeenLastCalledWith('presenter', expect.any(Object), 'contain', true, 'full')
  })
  it.each([null, 1366 / 768, 16 / 9, 9 / 16, 4 / 3])(
    'fills the viewport before and after video metadata loads (aspect ratio: %s)',
    (aspectRatio) => {
      metadata.aspectRatio = aspectRatio
      const html = renderToStaticMarkup(
        <FullScreenLiveOverlay user={{ id: 'presenter', name: 'Ana', stream: null, isScreenSharing: true }} onClose={() => {}} />,
      )
      const frame = html.match(/<div[^>]*>(?=<video)/)?.[0] ?? ''
      const video = html.match(/<video[^>]*>/)?.[0] ?? ''

      // A ratio-only flex child can shrink to the stream's intrinsic dimensions.
      const frameClasses = frame.match(/class="([^"]*)"/)?.[1].split(' ') ?? []
      expect(frameClasses).toContain('w-full')
      expect(frameClasses).toContain('h-full')
      expect(frame).not.toContain('aspect-ratio:')
      expect(video).toContain('w-full h-full object-contain')
      expect(video).not.toContain('object-cover')
    },
  )
})
