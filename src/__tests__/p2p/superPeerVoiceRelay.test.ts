import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SuperPeerVoiceRelay,
  MAGIC_BYTE,
  VOICE_RELAY_CHANNEL_LABEL,
  VoiceRelayControlMessage,
} from '../../p2p/SuperPeerVoiceRelay'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { PeerManager } from '../../p2p/PeerManager'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'

describe('SuperPeerVoiceRelay - Regras 1, 2 e 3 (UDP Sem Head-of-Line, Coordenação e Make-Before-Break)', () => {
  let relay: SuperPeerVoiceRelay

  beforeEach(() => {
    relay = SuperPeerVoiceRelay.getInstance()
    relay.reset()
    MediaCallHandler.directPeerStreams.clear()

    useGameStore.setState({
      roomCode: 'TEST',
      localPlayer: { id: 'peer-b', name: 'Bob' } as any,
      connectionHostId: 'peer-host',
      remotePlayers: {},
    })

    useMediaStore.setState({
      peerStreams: {},
      isMuted: false,
    })
  })

  afterEach(() => {
    relay.reset()
    vi.restoreAllMocks()
  })

  it('REGRA 1: attaches dedicated non-ordered, non-retransmitting data channel', () => {
    let createdChannelConfig: any = null
    const mockChannel: any = {
      label: VOICE_RELAY_CHANNEL_LABEL,
      binaryType: 'blob',
      addEventListener: vi.fn(),
      close: vi.fn(),
    }

    const mockPc: any = {
      signalingState: 'stable',
      createDataChannel: vi.fn((label: string, config: any) => {
        createdChannelConfig = config
        return mockChannel
      }),
      addEventListener: vi.fn(),
    }

    relay.attachPeerConnection('peer-host', mockPc, false)

    expect(mockPc.createDataChannel).toHaveBeenCalledWith(VOICE_RELAY_CHANNEL_LABEL, {
      ordered: false,
      maxRetransmits: 0,
    })
    expect(createdChannelConfig.ordered).toBe(false)
    expect(createdChannelConfig.maxRetransmits).toBe(0)
    expect(mockChannel.binaryType).toBe('arraybuffer')
  })

  it('REGRA 2: Super-Peer validates both legs and coordinates relay request', () => {
    const peerMgr = PeerManager.getInstance()
    peerMgr.isHost = true
    useGameStore.setState({ localPlayer: { id: 'peer-host', name: 'Host' } as any })

    const sendControlSpy = vi.spyOn(peerMgr, 'sendVoiceRelayControl').mockImplementation(() => {})
    const mockConnA: any = { open: true, peer: 'peer-a' }
    const mockConnB: any = { open: true, peer: 'peer-b' }

    vi.spyOn(peerMgr, 'getConnection').mockImplementation((pid: string) => {
      if (pid === 'peer-a') return mockConnA
      if (pid === 'peer-b') return mockConnB
      return undefined
    })

    // Peer B requests relay for incoming audio from Peer A
    const reqMsg: VoiceRelayControlMessage = {
      type: 'VOICE_RELAY_REQUEST',
      sourcePeer: 'peer-a',
      targetPeer: 'peer-b',
    }

    relay.handleControlMessage(reqMsg, 'peer-b')

    // Host must instruct Peer A to transmit and Peer B to accept
    expect(sendControlSpy).toHaveBeenCalledWith('peer-a', {
      type: 'VOICE_RELAY_INSTRUCT_START',
      sourcePeer: 'peer-a',
      targetPeer: 'peer-b',
    })
    expect(sendControlSpy).toHaveBeenCalledWith('peer-b', {
      type: 'VOICE_RELAY_ACCEPT',
      sourcePeer: 'peer-a',
      targetPeer: 'peer-b',
    })
  })

  it('REGRA 2: Super-Peer rejects relay if either leg is not connected', () => {
    const peerMgr = PeerManager.getInstance()
    peerMgr.isHost = true
    useGameStore.setState({ localPlayer: { id: 'peer-host', name: 'Host' } as any })

    const sendControlSpy = vi.spyOn(peerMgr, 'sendVoiceRelayControl').mockImplementation(() => {})
    const mockConnA: any = { open: false, peer: 'peer-a' } // broken leg!

    vi.spyOn(peerMgr, 'getConnection').mockImplementation((pid: string) => {
      if (pid === 'peer-a') return mockConnA
      return undefined
    })

    const reqMsg: VoiceRelayControlMessage = {
      type: 'VOICE_RELAY_REQUEST',
      sourcePeer: 'peer-a',
      targetPeer: 'peer-b',
    }

    relay.handleControlMessage(reqMsg, 'peer-b')
    expect(sendControlSpy).not.toHaveBeenCalled()
  })

  it('REGRA 1 & 2: Super-Peer forwards binary frames without audio re-encoding', () => {
    const peerMgr = PeerManager.getInstance()
    peerMgr.isHost = true
    useGameStore.setState({ localPlayer: { id: 'peer-host', name: 'Host' } as any })

    const mockConnA: any = { open: true }
    const mockConnB: any = { open: true }
    vi.spyOn(peerMgr, 'getConnection').mockImplementation((pid: string) => {
      if (pid === 'peer-a') return mockConnA
      if (pid === 'peer-b') return mockConnB
      return undefined
    })

    // Establish active relay on Host
    relay.handleControlMessage({
      type: 'VOICE_RELAY_REQUEST',
      sourcePeer: 'peer-a',
      targetPeer: 'peer-b',
    }, 'peer-b')

    // Target channel for Peer B
    let sentBuffer: ArrayBuffer | null = null
    const targetChannel: any = {
      label: VOICE_RELAY_CHANNEL_LABEL,
      readyState: 'open',
      binaryType: 'arraybuffer',
      send: vi.fn((buf: ArrayBuffer) => {
        sentBuffer = buf
      }),
      close: vi.fn(),
    }

    let hostDatachannelListener: ((event: any) => void) | null = null
    const hostPc: any = {
      signalingState: 'stable',
      createDataChannel: vi.fn(),
      addEventListener: vi.fn((event: string, cb: any) => {
        if (event === 'datachannel') hostDatachannelListener = cb
      }),
    }
    // Host listens via addEventListener('datachannel') without creating a duplicate channel
    relay.attachPeerConnection('peer-b', hostPc, true)
    expect(hostPc.createDataChannel).not.toHaveBeenCalled()
    hostDatachannelListener?.({ channel: targetChannel })

    // Build incoming binary packet from Peer A targeting Peer B
    const encoder = new TextEncoder()
    const targetBytes = encoder.encode('peer-b')
    const payloadBytes = new Uint8Array([10, 20, 30, 40])
    const frameBuffer = new ArrayBuffer(8 + targetBytes.length + payloadBytes.length)
    const view = new DataView(frameBuffer)
    view.setUint8(0, MAGIC_BYTE)
    view.setUint16(1, 123) // seq
    view.setUint32(3, 9999) // timestamp
    view.setUint8(7, targetBytes.length)
    new Uint8Array(frameBuffer, 8, targetBytes.length).set(targetBytes)
    new Uint8Array(frameBuffer, 8 + targetBytes.length).set(payloadBytes)

    // Incoming frame on Peer A's datachannel at Host
    const anyRelay = relay as any
    anyRelay.handleBinaryMessage('peer-a', frameBuffer, true)

    expect(targetChannel.send).toHaveBeenCalled()
    expect(sentBuffer).not.toBeNull()

    // Verify forwarded packet has source rewritten to 'peer-a' for Peer B
    const forwardedView = new DataView(sentBuffer!)
    expect(forwardedView.getUint8(0)).toBe(MAGIC_BYTE)
    expect(forwardedView.getUint16(1)).toBe(123)
    expect(forwardedView.getUint32(3)).toBe(9999)
    const sourceLen = forwardedView.getUint8(7)
    const decoder = new TextDecoder()
    const sourceId = decoder.decode(new Uint8Array(sentBuffer!, 8, sourceLen))
    expect(sourceId).toBe('peer-a')
  })

  it('REGRA 3: Make-Before-Break switches stream after 3 valid packets and silences direct track without double echo', () => {
    // Receiver is Peer B
    peerMgrNotHost()

    const directTrack = { enabled: true, readyState: 'live', kind: 'audio' }
    const directStream: any = {
      id: 'direct-stream-1',
      getAudioTracks: () => [directTrack],
    }
    useMediaStore.getState().setPeerStream('peer-a', directStream)

    // Peer B accepts relay
    relay.handleControlMessage({
      type: 'VOICE_RELAY_ACCEPT',
      sourcePeer: 'peer-a',
      targetPeer: 'peer-b',
    }, 'peer-host')

    const anyRelay = relay as any
    const receiver = anyRelay.activeReceivers.get('peer-a')
    expect(receiver).toBeDefined()
    expect(receiver.isActive).toBe(false)
    expect(directTrack.enabled).toBe(true)

    // Packet 1: Still waiting
    anyRelay.processReceiverPacket('peer-a', receiver, 1, 100, new Uint8Array(10))
    expect(receiver.isActive).toBe(false)
    expect(directTrack.enabled).toBe(true)

    // Packet 2: Still waiting
    anyRelay.processReceiverPacket('peer-a', receiver, 2, 120, new Uint8Array(10))
    expect(receiver.isActive).toBe(false)
    expect(directTrack.enabled).toBe(true)

    // Packet 3: Make-Before-Break triggers!
    anyRelay.processReceiverPacket('peer-a', receiver, 3, 140, new Uint8Array(10))
    expect(receiver.isActive).toBe(true)

    // Direct track must be silenced to avoid double echo / comb filtering
    expect(directTrack.enabled).toBe(false)
    expect(MediaCallHandler.directPeerStreams.get('peer-a')).toBe(directStream)

    // Active peer stream is now the relay stream
    const activeStream = useMediaStore.getState().peerStreams['peer-a']
    expect(activeStream).not.toBe(directStream)
    expect(activeStream).toBe(receiver.destination.stream)

    // Reverse recovery restores the direct track
    MediaCallHandler.restorePeerDirectStream('peer-a')
    expect(directTrack.enabled).toBe(true)
    expect(useMediaStore.getState().peerStreams['peer-a']).toBe(directStream)
    expect(MediaCallHandler.directPeerStreams.has('peer-a')).toBe(false)
  })

  it('detects handshake timeout in isRelayFailing when requested > 6000ms ago and still inactive', () => {
    peerMgrNotHost()
    const peerMgr = PeerManager.getInstance()
    vi.spyOn(peerMgr, 'getConnection').mockReturnValue({ open: true } as any)
    vi.spyOn(peerMgr, 'sendVoiceRelayControl').mockImplementation(() => {})

    const now = Date.now()
    const started = relay.requestRelay('peer-unresponsive')
    expect(started).toBe(true)

    // At 3000ms elapsed: not yet failing
    expect(relay.isRelayFailing('peer-unresponsive', now + 3000)).toBe(false)

    // At 6001ms elapsed: handshake timeout!
    expect(relay.isRelayFailing('peer-unresponsive', now + 6500)).toBe(true)
  })

  it('detects tunnel loss > 5% in isRelayFailing via sequence gap tracking', () => {
    peerMgrNotHost()
    relay.handleControlMessage({
      type: 'VOICE_RELAY_ACCEPT',
      sourcePeer: 'peer-gap',
      targetPeer: 'peer-b',
    }, 'peer-host')

    const anyRelay = relay as any
    const receiver = anyRelay.activeReceivers.get('peer-gap')
    expect(receiver).toBeDefined()

    // 3 initial packets to activate
    anyRelay.processReceiverPacket('peer-gap', receiver, 1, 100, new Uint8Array(10))
    anyRelay.processReceiverPacket('peer-gap', receiver, 2, 120, new Uint8Array(10))
    anyRelay.processReceiverPacket('peer-gap', receiver, 3, 140, new Uint8Array(10))
    expect(receiver.isActive).toBe(true)

    // Send 20 packets with gaps (lost packets): e.g. seq jumps by 2 every time (50% loss)
    let currentSeq = 3
    for (let i = 0; i < 20; i++) {
      currentSeq += 2 // 1 packet lost between each
      anyRelay.processReceiverPacket('peer-gap', receiver, currentSeq, 200 + i * 20, new Uint8Array(10))
    }

    expect(relay.isRelayFailing('peer-gap')).toBe(true)
  })

  it('corrects recentPacketsLost and avoids lastSeq regression when out-of-order jitter packets arrive', () => {
    peerMgrNotHost()
    relay.handleControlMessage({
      type: 'VOICE_RELAY_ACCEPT',
      sourcePeer: 'peer-ooo',
      targetPeer: 'peer-b',
    }, 'peer-host')

    const anyRelay = relay as any
    const receiver = anyRelay.activeReceivers.get('peer-ooo')

    // Initial packet
    anyRelay.processReceiverPacket('peer-ooo', receiver, 1, 100, new Uint8Array(10))
    expect(receiver.lastSeq).toBe(1)
    expect(receiver.recentPacketsLost).toBe(0)

    // Jitter: Packet 3 arrives before packet 2 (gap of 1 packet)
    anyRelay.processReceiverPacket('peer-ooo', receiver, 3, 120, new Uint8Array(10))
    expect(receiver.lastSeq).toBe(3)
    expect(receiver.recentPacketsLost).toBe(1)

    // Delayed Packet 2 arrives out-of-order!
    anyRelay.processReceiverPacket('peer-ooo', receiver, 2, 125, new Uint8Array(10))
    // lastSeq must NOT regress back to 2
    expect(receiver.lastSeq).toBe(3)
    // recentPacketsLost must be decremented back to 0
    expect(receiver.recentPacketsLost).toBe(0)
  })

  it('restorePeerDirectStream discards dead streams with ended tracks and stops relay', () => {
    peerMgrNotHost()
    const stopRelaySpy = vi.spyOn(relay, 'stopRelay')

    const deadTrack = { enabled: false, readyState: 'ended', kind: 'audio' }
    const deadStream: any = {
      id: 'dead-stream',
      getAudioTracks: () => [deadTrack],
    }

    MediaCallHandler.directPeerStreams.set('peer-dead', deadStream)
    MediaCallHandler.restorePeerDirectStream('peer-dead')

    // Direct stream removed from map
    expect(MediaCallHandler.directPeerStreams.has('peer-dead')).toBe(false)
    // Relay stopped
    expect(stopRelaySpy).toHaveBeenCalledWith('peer-dead')
    // Did NOT set dead stream in useMediaStore
    expect(useMediaStore.getState().peerStreams['peer-dead']).toBeUndefined()
  })

  it('endMediaCall cleans directPeerStreams, stops relay, and clears routing state', () => {
    const dummyStream: any = { getAudioTracks: () => [] }
    MediaCallHandler.directPeerStreams.set('peer-ended', dummyStream)
    const stopRelaySpy = vi.spyOn(relay, 'stopRelay')

    const mockCall: any = { close: vi.fn() }
    const mediaCalls = new Map<string, any>([['peer-ended', mockCall]])

    MediaCallHandler.endMediaCall(mediaCalls, 'peer-ended')

    expect(MediaCallHandler.directPeerStreams.has('peer-ended')).toBe(false)
    expect(stopRelaySpy).toHaveBeenCalledWith('peer-ended')
    expect(mockCall.close).toHaveBeenCalled()
  })

  function peerMgrNotHost() {
    const peerMgr = PeerManager.getInstance()
    peerMgr.isHost = false
  }
})
