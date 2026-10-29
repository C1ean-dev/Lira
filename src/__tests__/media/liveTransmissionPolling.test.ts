import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLiveTransmissionStats } from '../../hooks/useLiveTransmissionStats'

const hooks = vi.hoisted(() => ({
  effect: null as null | (() => void | (() => void)),
  setStats: vi.fn(), getMediaCalls: vi.fn(),
}))
vi.mock('react', () => ({
  useState: () => [[], hooks.setStats],
  useEffect: (effect: () => void) => { hooks.effect = effect },
}))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ getMediaCalls: hooks.getMediaCalls }) } }))

const track = { id: 'screen', kind: 'video', readyState: 'live' } as MediaStreamTrack
const stream = { getVideoTracks: () => [track] } as MediaStream
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); hooks.effect = null })
afterEach(() => vi.useRealTimers())

it('does not collect connection statistics while the information panel is closed', () => {
  useLiveTransmissionStats(false, stream, true)
  hooks.effect!()
  expect(hooks.getMediaCalls).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('polls only while open and cancels the next sample on close', async () => {
  const getStats = vi.fn(async () => new Map())
  hooks.getMediaCalls.mockReturnValue(new Map([['viewer', { peerConnection: {
    getStats, getSenders: () => [{ track }], connectionState: 'connected',
  } }]]))
  useLiveTransmissionStats(true, stream, true)
  const close = hooks.effect!() as () => void
  await vi.advanceTimersByTimeAsync(0)
  expect(getStats).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1000)
  expect(getStats).toHaveBeenCalledTimes(2)
  close()
  await vi.advanceTimersByTimeAsync(5000)
  expect(getStats).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

it('ignores an in-flight sample that finishes after the panel is closed', async () => {
  let resolve!: (value: Map<string, unknown>) => void
  hooks.getMediaCalls.mockReturnValue(new Map([['viewer', { peerConnection: {
    getStats: () => new Promise(done => { resolve = done }),
    getSenders: () => [{ track }], connectionState: 'connected',
  } }]]))
  useLiveTransmissionStats(true, stream, true)
  const close = hooks.effect!() as () => void
  close()
  const calls = hooks.setStats.mock.calls.length
  resolve(new Map())
  await vi.advanceTimersByTimeAsync(0)
  expect(hooks.setStats).toHaveBeenCalledTimes(calls)
  expect(vi.getTimerCount()).toBe(0)
})
