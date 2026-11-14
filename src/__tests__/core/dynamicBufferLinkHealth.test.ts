import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DynamicBufferManager } from '../../services/DynamicBufferManager'
import { PeerManager } from '../../p2p/PeerManager'
import { SuperPeerVoiceRelay } from '../../p2p/SuperPeerVoiceRelay'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'
import { useNetworkQualityStore } from '../../store/useNetworkQualityStore'

describe('DynamicBufferManager - Link Health Degraded P2P Upgrade', () => {
  beforeEach(() => {
    useMediaStore.setState({
      liveBufferMode: 'dynamic',
      liveBufferDelay: 1,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockStats(lossDelta: number, recvDelta: number, jitterSec = 0.01, isRelay = false) {
    const reports: any[] = [
      { id: 'cand-local', type: 'local-candidate', candidateType: isRelay ? 'relay' : 'srflx' },
      { id: 'cand-remote', type: 'remote-candidate', candidateType: isRelay ? 'relay' : 'host' },
      {
        id: 'active-pair',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'cand-local',
        remoteCandidateId: 'cand-remote',
        currentRoundTripTime: 0.035,
      },
      {
        id: 'transport-1',
        type: 'transport',
        selectedCandidatePairId: 'active-pair',
      },
      {
        type: 'inbound-rtp',
        kind: 'audio',
        packetsLost: lossDelta,
        packetsReceived: recvDelta,
        jitter: jitterSec,
      },
    ]

    return {
      forEach: (callback: (report: any) => void) => reports.forEach(callback),
    }
  }

  it('triggers forceDegradedUpgrade on direct P2P connection after 3 consecutive samples of high loss', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    const mockForceDegraded = vi.fn(async () => true)
    let cumulativeLoss = 0
    let cumulativeRecv = 0
    let currentStats = mockStats(0, 0)

    const pc: any = {
      getStats: vi.fn(async () => currentStats),
      forceDegradedUpgrade: mockForceDegraded,
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-zombie', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    // Sample 0: baseline (delta will be 0)
    currentStats = mockStats(cumulativeLoss, cumulativeRecv)
    await mgr.evaluateAndAdjustBuffer()
    expect(mockForceDegraded).not.toHaveBeenCalled()

    // Sample 1: 10% loss
    cumulativeLoss += 10
    cumulativeRecv += 90
    currentStats = mockStats(cumulativeLoss, cumulativeRecv)
    await mgr.evaluateAndAdjustBuffer()
    expect(mockForceDegraded).not.toHaveBeenCalled()

    // Sample 2: 10% loss
    cumulativeLoss += 10
    cumulativeRecv += 90
    currentStats = mockStats(cumulativeLoss, cumulativeRecv)
    await mgr.evaluateAndAdjustBuffer()
    expect(mockForceDegraded).not.toHaveBeenCalled()

    // Sample 3: 10% loss (3rd consecutive sample) -> triggers upgrade
    cumulativeLoss += 10
    cumulativeRecv += 90
    currentStats = mockStats(cumulativeLoss, cumulativeRecv)
    await mgr.evaluateAndAdjustBuffer()

    expect(mockForceDegraded).toHaveBeenCalledWith('sustained_packet_loss_or_jitter')
  })

  it('does NOT trigger upgrade if connection is already on a relay candidate', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    const mockForceDegraded = vi.fn(async () => true)
    let cumulativeLoss = 0
    let cumulativeRecv = 0
    let currentStats = mockStats(0, 0, 0.01, true)

    const pc: any = {
      getStats: vi.fn(async () => currentStats),
      forceDegradedUpgrade: mockForceDegraded,
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-relay', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    for (let i = 0; i < 4; i++) {
      cumulativeLoss += 20
      cumulativeRecv += 80
      currentStats = mockStats(cumulativeLoss, cumulativeRecv, 0.01, true)
      await mgr.evaluateAndAdjustBuffer()
    }

    expect(mockForceDegraded).not.toHaveBeenCalled()
  })

  it('does not log spam when forceDegradedUpgrade returns false (in cooldown or limit reached)', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    const mockForceDegraded = vi.fn(async () => false)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let cumulativeLoss = 0
    let cumulativeRecv = 0
    let currentStats = mockStats(0, 0)

    const pc: any = {
      getStats: vi.fn(async () => currentStats),
      forceDegradedUpgrade: mockForceDegraded,
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-cooldown', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    // 3 samples to trigger check
    for (let i = 0; i < 4; i++) {
      cumulativeLoss += 15
      cumulativeRecv += 85
      currentStats = mockStats(cumulativeLoss, cumulativeRecv)
      await mgr.evaluateAndAdjustBuffer()
    }

    expect(mockForceDegraded).toHaveBeenCalledTimes(1)
    // Warn must NOT be called because upgrade returned false
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[LinkHealth]'))

    // The next evaluation (sample 4) must NOT trigger upgrade again immediately
    cumulativeLoss += 15
    cumulativeRecv += 85
    currentStats = mockStats(cumulativeLoss, cumulativeRecv)
    await mgr.evaluateAndAdjustBuffer()
    expect(mockForceDegraded).toHaveBeenCalledTimes(1) // Still 1, history was cleared!
  })

  it('triggers upgrade when active transport pair is direct, even if an inactive relay pair exists', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    const mockForceDegraded = vi.fn(async () => true)
    let cumulativeLoss = 0
    let cumulativeRecv = 0

    // Reports have both direct active pair and an unselected relay pair
    const statsWithInactiveRelay = (loss: number, recv: number) => ({
      forEach: (cb: any) => [
        { id: 'cand-direct-local', type: 'local-candidate', candidateType: 'srflx' },
        { id: 'cand-direct-remote', type: 'remote-candidate', candidateType: 'host' },
        { id: 'cand-relay-local', type: 'local-candidate', candidateType: 'relay' },
        { id: 'cand-relay-remote', type: 'remote-candidate', candidateType: 'relay' },
        {
          id: 'pair-direct-active',
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: true,
          localCandidateId: 'cand-direct-local',
          remoteCandidateId: 'cand-direct-remote',
          currentRoundTripTime: 0.03,
        },
        {
          id: 'pair-relay-inactive',
          type: 'candidate-pair',
          state: 'succeeded',
          nominated: false, // Inactive!
          localCandidateId: 'cand-relay-local',
          remoteCandidateId: 'cand-relay-remote',
          currentRoundTripTime: 0.05,
        },
        {
          id: 'transport-1',
          type: 'transport',
          selectedCandidatePairId: 'pair-direct-active',
        },
        {
          type: 'inbound-rtp',
          kind: 'audio',
          packetsLost: loss,
          packetsReceived: recv,
          jitter: 0.01,
        },
      ].forEach(cb),
    })

    let currentStats = statsWithInactiveRelay(0, 0)
    const pc: any = {
      getStats: vi.fn(async () => currentStats),
      forceDegradedUpgrade: mockForceDegraded,
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-direct-active', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    for (let i = 0; i < 4; i++) {
      cumulativeLoss += 15
      cumulativeRecv += 85
      currentStats = statsWithInactiveRelay(cumulativeLoss, cumulativeRecv)
      await mgr.evaluateAndAdjustBuffer()
    }

    expect(mockForceDegraded).toHaveBeenCalledWith('sustained_packet_loss_or_jitter')
  })

  it('triggers Level 2 (Super-Peer Voice Relay) when available and host link is healthy', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    const mockForceDegraded = vi.fn(async () => true)
    const relay = SuperPeerVoiceRelay.getInstance()
    vi.spyOn(relay, 'isAvailable').mockReturnValue(true)
    const requestRelaySpy = vi.spyOn(relay, 'requestRelay').mockReturnValue(true)

    useGameStore.setState({
      roomCode: 'TEST',
      localPlayer: { id: 'peer-client' } as any,
      connectionHostId: 'peer-host',
    })
    useNetworkQualityStore.getState().setPeerQuality('peer-host', {
      pingMs: 25,
      lossPct: 0,
      jitterMs: 5,
    })

    let cumulativeLoss = 0
    let cumulativeRecv = 0
    let currentStats = mockStats(0, 0)

    const pc: any = {
      getStats: vi.fn(async () => currentStats),
      forceDegradedUpgrade: mockForceDegraded,
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-degraded', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    // Feed 3 lossy samples (10% loss)
    for (let i = 0; i < 4; i++) {
      cumulativeLoss += 10
      cumulativeRecv += 90
      currentStats = mockStats(cumulativeLoss, cumulativeRecv)
      await mgr.evaluateAndAdjustBuffer()
    }

    expect(requestRelaySpy).toHaveBeenCalledWith('peer-degraded')
    expect(mockForceDegraded).not.toHaveBeenCalled()
    expect(mgr.getPeerRoutingTier('peer-degraded')).toBe(2)
  })

  it('triggers Reverse Recovery from Level 2 to Level 1 when standby direct route stabilizes for 3 samples after hold time', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    const relay = SuperPeerVoiceRelay.getInstance()
    const stopRelaySpy = vi.spyOn(relay, 'stopRelay').mockImplementation(() => {})
    const restoreDirectSpy = vi.spyOn(MediaCallHandler, 'restorePeerDirectStream').mockImplementation(() => {})

    useGameStore.setState({
      roomCode: 'TEST',
      localPlayer: { id: 'peer-client' } as any,
      connectionHostId: 'peer-host',
    })
    const hostConn: any = { open: true }
    vi.spyOn(PeerManager.getInstance(), 'getConnection').mockReturnValue(hostConn)

    let cumulativeLoss = 0
    let cumulativeRecv = 0
    let currentStats = mockStats(0, 0)

    const pc: any = {
      getStats: vi.fn(async () => currentStats),
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-recovering', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    // Seed state directly into Tier 2 with start time > 45s ago
    const anyMgr = mgr as any
    anyMgr.peerRoutingState.set('peer-recovering', {
      tier: 2,
      tierStartedAt: Date.now() - 46000, // hold time satisfied!
      recoverySamples: [],
    })

    // Sample 0: baseline with slightly elevated jitter (> 40ms) so it does not count as recovery sample
    currentStats = mockStats(cumulativeLoss, cumulativeRecv, 0.05)
    await mgr.evaluateAndAdjustBuffer()
    expect(restoreDirectSpy).not.toHaveBeenCalled()

    // Sample 1: 0% loss, 10ms jitter (< 40ms) - 1st stable sample
    cumulativeRecv += 100
    currentStats = mockStats(cumulativeLoss, cumulativeRecv, 0.01)
    await mgr.evaluateAndAdjustBuffer()
    expect(restoreDirectSpy).not.toHaveBeenCalled()

    // Sample 2: 0% loss, 10ms jitter - 2nd stable sample
    cumulativeRecv += 100
    currentStats = mockStats(cumulativeLoss, cumulativeRecv, 0.01)
    await mgr.evaluateAndAdjustBuffer()
    expect(restoreDirectSpy).not.toHaveBeenCalled()

    // Sample 3: 0% loss, 10ms jitter (3rd stable sample) -> Triggers Reverse Recovery!
    cumulativeRecv += 100
    currentStats = mockStats(cumulativeLoss, cumulativeRecv, 0.01)
    await mgr.evaluateAndAdjustBuffer()

    expect(restoreDirectSpy).toHaveBeenCalledWith('peer-recovering')
    expect(stopRelaySpy).toHaveBeenCalledWith('peer-recovering')
    expect(mgr.getPeerRoutingTier('peer-recovering')).toBe(1)
  })

  it('escalates from Level 2 to Level 3 (Cloudflare TURN) when Super-Peer / host link fails', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    const mockForceDegraded = vi.fn(async () => true)
    const relay = SuperPeerVoiceRelay.getInstance()
    const stopRelaySpy = vi.spyOn(relay, 'stopRelay').mockImplementation(() => {})
    const restoreDirectSpy = vi.spyOn(MediaCallHandler, 'restorePeerDirectStream').mockImplementation(() => {})

    useGameStore.setState({
      roomCode: 'TEST',
      localPlayer: { id: 'peer-client' } as any,
      connectionHostId: 'peer-host',
    })

    // Host connection is broken/closed
    vi.spyOn(PeerManager.getInstance(), 'getConnection').mockReturnValue({ open: false } as any)

    const pc: any = {
      getStats: vi.fn(async () => mockStats(0, 100)),
      forceDegradedUpgrade: mockForceDegraded,
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-tier2', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    // Set peer in Tier 2
    const anyMgr = mgr as any
    anyMgr.peerRoutingState.set('peer-tier2', {
      tier: 2,
      tierStartedAt: Date.now(),
      recoverySamples: [],
    })

    await mgr.evaluateAndAdjustBuffer()

    expect(stopRelaySpy).toHaveBeenCalledWith('peer-tier2')
    expect(restoreDirectSpy).toHaveBeenCalledWith('peer-tier2')
    expect(mockForceDegraded).toHaveBeenCalledWith('superpeer_host_link_failing')
    expect(mgr.getPeerRoutingTier('peer-tier2')).toBe(3)
  })

  it('escalates from Level 2 to Level 3 when isRelayFailing is true even if host link is healthy', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    const mockForceDegraded = vi.fn(async () => true)
    const relay = SuperPeerVoiceRelay.getInstance()
    const stopRelaySpy = vi.spyOn(relay, 'stopRelay').mockImplementation(() => {})
    const restoreDirectSpy = vi.spyOn(MediaCallHandler, 'restorePeerDirectStream').mockImplementation(() => {})
    // Simulate sender leg loss / handshake failure detected by isRelayFailing
    vi.spyOn(relay, 'isRelayFailing').mockReturnValue(true)

    useGameStore.setState({
      roomCode: 'TEST',
      localPlayer: { id: 'peer-client' } as any,
      connectionHostId: 'peer-host',
    })

    // Host connection is open and healthy (0% loss, 20ms ping)
    vi.spyOn(PeerManager.getInstance(), 'getConnection').mockReturnValue({ open: true } as any)
    useNetworkQualityStore.getState().setPeerQuality('peer-host', {
      pingMs: 20,
      lossPct: 0,
      jitterMs: 5,
    })

    const pc: any = {
      getStats: vi.fn(async () => mockStats(0, 100)),
      forceDegradedUpgrade: mockForceDegraded,
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-sender-broken', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    // Set peer in Tier 2
    const anyMgr = mgr as any
    anyMgr.peerRoutingState.set('peer-sender-broken', {
      tier: 2,
      tierStartedAt: Date.now(),
      recoverySamples: [],
    })

    await mgr.evaluateAndAdjustBuffer()

    expect(stopRelaySpy).toHaveBeenCalledWith('peer-sender-broken')
    expect(restoreDirectSpy).toHaveBeenCalledWith('peer-sender-broken')
    expect(mockForceDegraded).toHaveBeenCalledWith('superpeer_relay_failing')
    expect(mgr.getPeerRoutingTier('peer-sender-broken')).toBe(3)
  })

  it('falls back to Level 1 when forceDegradedUpgrade returns false during Level 2 escalation', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    // forceDegradedUpgrade returns false (e.g. cooldown or limit)
    const mockForceDegraded = vi.fn(async () => false)
    const relay = SuperPeerVoiceRelay.getInstance()
    vi.spyOn(relay, 'stopRelay').mockImplementation(() => {})
    vi.spyOn(MediaCallHandler, 'restorePeerDirectStream').mockImplementation(() => {})
    vi.spyOn(relay, 'isRelayFailing').mockReturnValue(true)

    useGameStore.setState({
      roomCode: 'TEST',
      localPlayer: { id: 'peer-client' } as any,
      connectionHostId: 'peer-host',
    })
    vi.spyOn(PeerManager.getInstance(), 'getConnection').mockReturnValue({ open: true } as any)

    const pc: any = {
      getStats: vi.fn(async () => mockStats(0, 100)),
      forceDegradedUpgrade: mockForceDegraded,
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-cooldown-relay', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    const anyMgr = mgr as any
    anyMgr.peerRoutingState.set('peer-cooldown-relay', {
      tier: 2,
      tierStartedAt: Date.now(),
      recoverySamples: [],
    })

    await mgr.evaluateAndAdjustBuffer()

    expect(mockForceDegraded).toHaveBeenCalled()
    // When upgrade fails/rejected, peer tier falls back to 1 (not stuck in 2 with closed relay)
    expect(mgr.getPeerRoutingTier('peer-cooldown-relay')).toBe(1)
  })

  it('Level 3 (TURN) never performs reverse recovery even with clean stats', async () => {
    const mgr = DynamicBufferManager.getInstance()
    mgr.resetForNewCall()

    const relay = SuperPeerVoiceRelay.getInstance()
    const stopRelaySpy = vi.spyOn(relay, 'stopRelay').mockImplementation(() => {})
    const restoreDirectSpy = vi.spyOn(MediaCallHandler, 'restorePeerDirectStream').mockImplementation(() => {})

    const pc: any = {
      getStats: vi.fn(async () => mockStats(0, 100, 0.005, true)), // Relay stats
      getReceivers: () => [],
    }

    const mockCall: any = { peerConnection: pc }
    const mediaCalls = new Map<string, any>([['peer-tier3', mockCall]])
    vi.spyOn(PeerManager.getInstance(), 'getMediaCalls').mockReturnValue(mediaCalls)

    // Set in Tier 3
    const anyMgr = mgr as any
    anyMgr.peerRoutingState.set('peer-tier3', {
      tier: 3,
      tierStartedAt: Date.now() - 60000,
      recoverySamples: [],
    })

    for (let i = 0; i < 5; i++) {
      await mgr.evaluateAndAdjustBuffer()
    }

    // Never reverse recovery from Tier 3
    expect(restoreDirectSpy).not.toHaveBeenCalled()
    expect(stopRelaySpy).not.toHaveBeenCalled()
    expect(mgr.getPeerRoutingTier('peer-tier3')).toBe(3)
  })
})
