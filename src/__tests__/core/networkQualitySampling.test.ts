import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DynamicBufferManager } from '../../services/DynamicBufferManager'
import { PeerManager } from '../../p2p/PeerManager'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { useMediaStore } from '../../store/useMediaStore'
import { useNetworkQualityStore } from '../../store/useNetworkQualityStore'

const inbound = (id: string, received: number, lost: number, timestamp = 1000) => ({
  id, type: 'inbound-rtp', kind: 'audio', packetsReceived: received, packetsLost: lost, jitter: 0.001, timestamp,
})
const stats = (...rows: any[]) => new Map(rows.map(row => [row.id, row]))
let manager: DynamicBufferManager
let calls: Map<string, any>
const originalMedia = useMediaStore.getState()

beforeEach(() => {
  manager = DynamicBufferManager.getInstance()
  manager.stopMonitoring()
  manager.resetForNewCall()
  useMediaStore.setState({ liveBufferMode: 'dynamic' })
  calls = new Map()
  vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockImplementation(() => calls)
  vi.spyOn(MediaCallHandler, 'applyJitterBuffer').mockImplementation(() => {})
})
afterEach(() => {
  manager.resetForNewCall()
  manager.stopMonitoring()
  vi.restoreAllMocks()
  useMediaStore.setState(originalMedia)
})

describe('call quality sampling', () => {
  it('keeps each RTP stream separate instead of inventing loss between two audio streams', async () => {
    const getStats = vi.fn().mockResolvedValueOnce(stats(inbound('mic', 1000, 100), inbound('other', 100, 0)))
      .mockResolvedValueOnce(stats(inbound('mic', 1500, 100, 11000), inbound('other', 600, 0, 11000)))
    calls.set('peer', { peerConnection: { getStats } })
    await manager.evaluateAndAdjustBuffer()
    await manager.evaluateAndAdjustBuffer()
    expect(useNetworkQualityStore.getState().peerQualities.peer.lossPct).toBe(0)
  })

  it('baselines a replacement connection even if Chromium reuses its report ID', async () => {
    calls.set('peer', { peerConnection: { getStats: async () => stats(inbound('audio', 8000, 100)) } })
    await manager.evaluateAndAdjustBuffer()
    calls.set('peer', { peerConnection: { getStats: async () => stats(inbound('audio', 10, 200, 11000)) } })
    await manager.evaluateAndAdjustBuffer()
    expect(useNetworkQualityStore.getState().peerQualities.peer.lossPct).toBe(0)
  })

  it('reports real loss from the captured call without adding half a second of audio delay', async () => {
    const getStats = vi.fn().mockResolvedValueOnce(stats(inbound('audio', 6638, 5358)))
      .mockResolvedValueOnce(stats(inbound('audio', 6904, 5593, 11000)))
    calls.set('peer', { peerConnection: { getStats } })
    await manager.evaluateAndAdjustBuffer()
    const result = await manager.evaluateAndAdjustBuffer()
    expect(useNetworkQualityStore.getState().peerQualities.peer.lossPct).toBe(47)
    expect(result.audio).toBeLessThanOrEqual(50)
  })

  it('takes RTT from the selected candidate pair instead of a discarded route', async () => {
    calls.set('peer', { peerConnection: { getStats: async () => stats(
      { id: 'transport', type: 'transport', selectedCandidatePairId: 'active' },
      { id: 'active', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.030 },
      { id: 'old', type: 'candidate-pair', state: 'succeeded', currentRoundTripTime: 0.900 },
    ) } })
    await manager.evaluateAndAdjustBuffer()
    expect(useNetworkQualityStore.getState().peerQualities.peer.pingMs).toBe(30)
  })

  it('continues measuring quality in manual buffer mode without adjusting the buffers', async () => {
    useMediaStore.setState({ liveBufferMode: 'manual', liveBufferDelay: 100 })
    const getStats = vi.fn().mockResolvedValueOnce(stats(inbound('audio', 6638, 5358)))
      .mockResolvedValueOnce(stats(inbound('audio', 6904, 5593, 11000)))
    calls.set('peer', { peerConnection: { getStats } })
    await manager.evaluateAndAdjustBuffer()
    await manager.evaluateAndAdjustBuffer()
    expect(useNetworkQualityStore.getState().peerQualities.peer.lossPct).toBe(47)
    expect(useMediaStore.getState().liveBufferDelay).toBe(100)
    expect(MediaCallHandler.applyJitterBuffer).not.toHaveBeenCalled()
  })

  it('does not start overlapping polls while WebRTC statistics are pending', async () => {
    let finish!: (value: Map<string, any>) => void
    const getStats = vi.fn(() => new Promise<Map<string, any>>(resolve => { finish = resolve }))
    calls.set('peer', { peerConnection: { getStats } })
    const first = manager.evaluateAndAdjustBuffer()
    const second = manager.evaluateAndAdjustBuffer()
    expect(getStats).toHaveBeenCalledOnce()
    finish(stats(inbound('audio', 100, 0)))
    await Promise.all([first, second])
  })
})
