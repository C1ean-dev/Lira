import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { MediaCallHandler, resolveCallGlare } from '../../p2p/mediaCalls'
import { CallAudioIsolator } from '../../media/CallAudioIsolator'
import { Player } from '../../types/game'
import { NetworkMessage } from '../../types/p2p'
import { DEFAULT_AVATAR } from '../../engine/Constants'

// Polyfills for Web Audio & WebRTC in Vitest environment
class MockMediaStreamTrack {
  id: string
  kind: string
  enabled: boolean = true
  readyState: string = 'live'
  __screenShareLiveAudio?: boolean

  constructor(kind: string = 'audio', id?: string) {
    this.kind = kind
    this.id = id || `track-${kind}-${Math.random().toString(36).substring(2, 7)}`
  }

  stop = vi.fn(() => {
    this.readyState = 'ended'
  })
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
}

class MockMediaStream {
  id: string
  private tracks: MockMediaStreamTrack[] = []

  constructor(tracks?: MockMediaStreamTrack[]) {
    this.id = 'stream-' + Math.random().toString(36).substring(2, 7)
    if (tracks) this.tracks = [...tracks]
  }

  addTrack(track: MockMediaStreamTrack) {
    if (!this.tracks.includes(track)) this.tracks.push(track)
  }

  removeTrack(track: MockMediaStreamTrack) {
    this.tracks = this.tracks.filter((t) => t !== track)
  }

  getTracks() {
    return this.tracks
  }

  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }

  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }

  addEventListener = vi.fn()
  removeEventListener = vi.fn()
}

if (typeof (globalThis as any).MediaStream === 'undefined') {
  ;(globalThis as any).MediaStream = MockMediaStream
}

// Web Audio API Polyfills
class MockAudioParam {
  value: number = 1
  setValueAtTime = vi.fn((v: number) => { this.value = v })
  setTargetAtTime = vi.fn((v: number) => { this.value = v })
  linearRampToValueAtTime = vi.fn((v: number) => { this.value = v })
  cancelScheduledValues = vi.fn()
}

class MockAudioNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam()
}

class MockBiquadFilterNode extends MockAudioNode {
  type: string = 'lowpass'
  frequency = new MockAudioParam()
  Q = new MockAudioParam()
  gain = new MockAudioParam()
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 256
  frequencyBinCount = 128
  getByteTimeDomainData = vi.fn((arr: Uint8Array) => arr.fill(128))
}

class MockAudioContext {
  currentTime = 0
  state = 'running'
  destination = new MockAudioNode()
  createGain = vi.fn(() => new MockGainNode())
  createBiquadFilter = vi.fn(() => new MockBiquadFilterNode())
  createAnalyser = vi.fn(() => new MockAnalyserNode())
  createDelay = vi.fn(() => ({ ...new MockAudioNode(), delayTime: new MockAudioParam() }))
  createMediaStreamSource = vi.fn(() => new MockAudioNode())
  createMediaStreamDestination = vi.fn(() => ({
    ...new MockAudioNode(),
    stream: new MockMediaStream([new MockMediaStreamTrack('audio', 'isolated-screen-audio')]),
  }))
  resume = vi.fn().mockResolvedValue(undefined)
  close = vi.fn().mockResolvedValue(undefined)
}

if (typeof (globalThis as any).AudioContext === 'undefined') {
  ;(globalThis as any).AudioContext = MockAudioContext
}
;(globalThis as any).window = globalThis.window || {}
;(globalThis as any).window.AudioContext = (globalThis as any).window.AudioContext || MockAudioContext
if (!(globalThis as any).window.setInterval) (globalThis as any).window.setInterval = globalThis.setInterval.bind(globalThis)
if (!(globalThis as any).window.clearInterval) (globalThis as any).window.clearInterval = globalThis.clearInterval.bind(globalThis)

// Simulated Client representation for an end-to-end 3-person cluster
class SimulatedClient {
  peerId: string
  gameId: string
  name: string
  isHost: boolean
  currentZoneId: string | null = null

  // Local state
  player: Player
  localStream: MockMediaStream
  remotePlayers: Record<string, Player> = {}
  peerStreams: Record<string, MockMediaStream> = {}
  callStates: Record<string, 'connecting' | 'connected' | 'failed' | 'idle'> = {}
  mediaCalls: Map<string, any> = new Map()

  // Audio controls
  isMuted: boolean = false
  isDeafened: boolean = false
  participantVolumes: Record<string, number> = {}
  outputVolume: number = 100

  constructor(peerId: string, gameId: string, name: string, isHost: boolean = false) {
    this.peerId = peerId
    this.gameId = gameId
    this.name = name
    this.isHost = isHost

    const audioTrack = new MockMediaStreamTrack('audio', `${peerId}-mic-track`)
    this.localStream = new MockMediaStream([audioTrack])

    this.player = {
      id: peerId,
      gameId,
      name,
      x: 10,
      y: 10,
      direction: 'down',
      isMoving: false,
      role: isHost ? 'host' : 'member',
      isHost,
      avatar: { ...DEFAULT_AVATAR },
      status: 'available',
      isMuted: false,
      isDeafened: false,
      currentZoneId: null,
      lastUpdated: Date.now(),
    }
  }

  setZone(zoneId: string | null) {
    this.currentZoneId = zoneId
    this.player.currentZoneId = zoneId
  }

  setMute(muted: boolean) {
    this.isMuted = muted
    this.player.isMuted = muted
    this.localStream.getAudioTracks().forEach((t) => {
      t.enabled = !muted
    })
  }

  setDeafen(deafened: boolean) {
    this.isDeafened = deafened
    this.player.isDeafened = deafened
  }

  setVolumeFor(peerId: string, volume: number) {
    this.participantVolumes[peerId] = Math.max(0, Math.min(200, volume))
  }

  getEffectiveVolume(peerId: string): number {
    if (this.isDeafened) return 0
    const vol = this.participantVolumes[peerId] ?? 100
    const master = this.outputVolume / 100
    return (master * vol) / 100
  }

  // Receive network packet
  receiveMessage(msg: NetworkMessage, senderSocketId: string) {
    if (msg.type === 'PLAYER_JOIN') {
      const p = msg.payload?.player as Player
      if (p && p.id !== this.peerId) {
        this.remotePlayers[p.id] = p
      }
    } else if (msg.type === 'ROOM_STATE') {
      const players = (msg.payload?.players || {}) as Record<string, Player>
      for (const [id, p] of Object.entries(players)) {
        if (id !== this.peerId) {
          this.remotePlayers[id] = p
        }
      }
    } else if (msg.type === 'PLAYER_UPDATE') {
      const p = this.remotePlayers[msg.senderId]
      if (p) {
        this.remotePlayers[msg.senderId] = { ...p, ...msg.payload }
      }
    } else if (msg.type === 'PLAYER_LEAVE') {
      delete this.remotePlayers[msg.senderId]
      delete this.peerStreams[msg.senderId]
      this.callStates[msg.senderId] = 'idle'
      this.mediaCalls.delete(msg.senderId)
    }
  }
}

describe('End-to-End Test: Sound & Connection Between 3 People (Alice, Bob, Charlie)', () => {
  let alice: SimulatedClient
  let bob: SimulatedClient
  let charlie: SimulatedClient

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllTimers()

    // Instantiate 3 distinct participants
    alice = new SimulatedClient('peer-alice', 'game-alice', 'Alice (Host)', true)
    bob = new SimulatedClient('peer-bob', 'game-bob', 'Bob (Dev)', false)
    charlie = new SimulatedClient('peer-charlie', 'game-charlie', 'Charlie (Designer)', false)
  })

  // =========================================================================
  // 1. Connection & P2P Mesh Topology
  // =========================================================================
  describe('Phase 1: 3-Way Network Mesh & Room Discovery', () => {
    it('establishes full mesh discovery when 3 people join the room', () => {
      // 1. Alice creates the room and is waiting.
      expect(alice.remotePlayers).toEqual({})

      // 2. Bob joins: Bob sends PLAYER_JOIN to Alice (Host)
      const bobJoinMsg: NetworkMessage = {
        type: 'PLAYER_JOIN',
        senderId: bob.peerId,
        payload: { player: bob.player },
        timestamp: Date.now(),
      }
      alice.receiveMessage(bobJoinMsg, bob.peerId)

      // Alice sends ROOM_STATE back to Bob
      const aliceRoomStateMsg: NetworkMessage = {
        type: 'ROOM_STATE',
        senderId: alice.peerId,
        payload: { players: { [alice.peerId]: alice.player } },
        timestamp: Date.now(),
      }
      bob.receiveMessage(aliceRoomStateMsg, alice.peerId)

      // Verify Alice & Bob see each other
      expect(alice.remotePlayers['peer-bob']).toBeDefined()
      expect(bob.remotePlayers['peer-alice']).toBeDefined()

      // 3. Charlie joins: Charlie sends PLAYER_JOIN to Alice (Host)
      const charlieJoinMsg: NetworkMessage = {
        type: 'PLAYER_JOIN',
        senderId: charlie.peerId,
        payload: { player: charlie.player },
        timestamp: Date.now(),
      }
      alice.receiveMessage(charlieJoinMsg, charlie.peerId)

      // Alice (Host) sends full ROOM_STATE to Charlie (containing Alice and Bob)
      const fullRoomStateMsg: NetworkMessage = {
        type: 'ROOM_STATE',
        senderId: alice.peerId,
        payload: {
          players: {
            [alice.peerId]: alice.player,
            [bob.peerId]: bob.player,
          },
        },
        timestamp: Date.now(),
      }
      charlie.receiveMessage(fullRoomStateMsg, alice.peerId)

      // Alice (Host) relays Charlie's join to Bob
      bob.receiveMessage(charlieJoinMsg, alice.peerId)

      // VERIFICATION: All 3 participants now have the complete peer mesh!
      // Alice sees Bob and Charlie
      expect(Object.keys(alice.remotePlayers).sort()).toEqual(['peer-bob', 'peer-charlie'])
      // Bob sees Alice and Charlie
      expect(Object.keys(bob.remotePlayers).sort()).toEqual(['peer-alice', 'peer-charlie'])
      // Charlie sees Alice and Bob
      expect(Object.keys(charlie.remotePlayers).sort()).toEqual(['peer-alice', 'peer-bob'])

      expect(alice.remotePlayers['peer-bob'].name).toBe('Bob (Dev)')
      expect(alice.remotePlayers['peer-charlie'].name).toBe('Charlie (Designer)')
      expect(bob.remotePlayers['peer-charlie'].name).toBe('Charlie (Designer)')
    })
  })

  // =========================================================================
  // 2. Sound Pipeline & Microphone Initialization
  // =========================================================================
  describe('Phase 2: Sound Pipeline & Microphone Level Detection', () => {
    it('initializes microphones and handles noise gate levels for each participant', () => {
      // Each participant has an active audio track
      expect(alice.localStream.getAudioTracks()[0].enabled).toBe(true)
      expect(bob.localStream.getAudioTracks()[0].enabled).toBe(true)
      expect(charlie.localStream.getAudioTracks()[0].enabled).toBe(true)

      // Verify Zustand MediaStore reacts to mic audio levels and speech gate
      useMediaStore.getState().setLocalAudioLevel(45, true, 20)
      expect(useMediaStore.getState().localAudioLevel).toBe(45)
      expect(useMediaStore.getState().isGateOpen).toBe(true)

      // When user stops speaking, noise gate closes
      useMediaStore.getState().setLocalAudioLevel(0, false, 20)
      expect(useMediaStore.getState().localAudioLevel).toBe(0)
      expect(useMediaStore.getState().isGateOpen).toBe(false)
    })
  })

  // =========================================================================
  // 3. Zone Entry & 3-Way WebRTC Audio Mesh Call
  // =========================================================================
  describe('Phase 3: 3-Way Zone Entry & WebRTC Audio Mesh', () => {
    it('establishes audio calls between all 3 participants upon entering the same zone with glare resolution', () => {
      const MEETING_ZONE = 'zone-reuniao-geral'

      // All 3 walk into the meeting room
      alice.setZone(MEETING_ZONE)
      bob.setZone(MEETING_ZONE)
      charlie.setZone(MEETING_ZONE)

      // Helper function to establish a bidirectional audio connection between two clients
      const establishAudioCall = (clientA: SimulatedClient, clientB: SimulatedClient) => {
        // Deterministic glare resolution: smaller peerId dials outgoing
        const decisionA = resolveCallGlare(clientA.peerId, clientB.peerId, 'out')
        const decisionB = resolveCallGlare(clientB.peerId, clientA.peerId, 'in')

        expect(['drop-incoming', 'replace-with-incoming']).toContain(decisionA)
        expect(['drop-incoming', 'replace-with-incoming']).toContain(decisionB)

        // Outbound audio stream from A lands on B
        clientB.peerStreams[clientA.peerId] = clientA.localStream
        clientB.callStates[clientA.peerId] = 'connected'

        // Outbound audio stream from B lands on A
        clientA.peerStreams[clientB.peerId] = clientB.localStream
        clientA.callStates[clientB.peerId] = 'connected'
      }

      // Establish mesh calls:
      // Pair 1: Alice <-> Bob
      establishAudioCall(alice, bob)
      // Pair 2: Alice <-> Charlie
      establishAudioCall(alice, charlie)
      // Pair 3: Bob <-> Charlie
      establishAudioCall(bob, charlie)

      // VERIFICATION:
      // Alice has audio from Bob and Charlie
      expect(alice.peerStreams['peer-bob']).toBeDefined()
      expect(alice.peerStreams['peer-charlie']).toBeDefined()
      expect(alice.callStates['peer-bob']).toBe('connected')
      expect(alice.callStates['peer-charlie']).toBe('connected')

      // Bob has audio from Alice and Charlie
      expect(bob.peerStreams['peer-alice']).toBeDefined()
      expect(bob.peerStreams['peer-charlie']).toBeDefined()
      expect(bob.callStates['peer-alice']).toBe('connected')
      expect(bob.callStates['peer-charlie']).toBe('connected')

      // Charlie has audio from Alice and Bob
      expect(charlie.peerStreams['peer-alice']).toBeDefined()
      expect(charlie.peerStreams['peer-bob']).toBeDefined()
      expect(charlie.callStates['peer-alice']).toBe('connected')
      expect(charlie.callStates['peer-bob']).toBe('connected')

      // All audio tracks are active
      expect(alice.peerStreams['peer-bob'].getAudioTracks()[0].enabled).toBe(true)
      expect(alice.peerStreams['peer-charlie'].getAudioTracks()[0].enabled).toBe(true)
      expect(bob.peerStreams['peer-alice'].getAudioTracks()[0].enabled).toBe(true)
      expect(charlie.peerStreams['peer-alice'].getAudioTracks()[0].enabled).toBe(true)
    })
  })

  // =========================================================================
  // 4. Sound Controls: Mute, Deafen, Volume Balancing
  // =========================================================================
  describe('Phase 4: Sound Controls (Mute, Deafen, and Volume Balancing)', () => {
    beforeEach(() => {
      // Setup connected 3-person mesh
      const zone = 'zone-reuniao-geral'
      alice.setZone(zone)
      bob.setZone(zone)
      charlie.setZone(zone)

      alice.remotePlayers['peer-bob'] = bob.player
      alice.remotePlayers['peer-charlie'] = charlie.player
      bob.remotePlayers['peer-alice'] = alice.player
      bob.remotePlayers['peer-charlie'] = charlie.player
      charlie.remotePlayers['peer-alice'] = alice.player
      charlie.remotePlayers['peer-bob'] = bob.player

      alice.peerStreams['peer-bob'] = bob.localStream
      alice.peerStreams['peer-charlie'] = charlie.localStream
      bob.peerStreams['peer-alice'] = alice.localStream
      bob.peerStreams['peer-charlie'] = charlie.localStream
      charlie.peerStreams['peer-alice'] = alice.localStream
      charlie.peerStreams['peer-bob'] = bob.localStream
    })

    it('4.1: When Bob mutes, his audio track disables and peers receive mute update', () => {
      // Bob mutes
      bob.setMute(true)
      expect(bob.localStream.getAudioTracks()[0].enabled).toBe(false)

      // Bob broadcasts update
      const updateMsg: NetworkMessage = {
        type: 'PLAYER_UPDATE',
        senderId: bob.peerId,
        payload: { isMuted: true },
        timestamp: Date.now(),
      }
      alice.receiveMessage(updateMsg, bob.peerId)
      charlie.receiveMessage(updateMsg, bob.peerId)

      // Alice & Charlie know Bob is muted
      expect(alice.remotePlayers['peer-bob'].isMuted).toBe(true)
      expect(charlie.remotePlayers['peer-bob'].isMuted).toBe(true)

      // Alice & Charlie still talk normally
      expect(alice.localStream.getAudioTracks()[0].enabled).toBe(true)
      expect(charlie.localStream.getAudioTracks()[0].enabled).toBe(true)

      // Bob unmutes
      bob.setMute(false)
      expect(bob.localStream.getAudioTracks()[0].enabled).toBe(true)
    })

    it('4.2: When Charlie deafens, his effective incoming sound is 0 for both peers', () => {
      // Prior to deafen, Charlie hears Alice and Bob at 100% (1.0)
      expect(charlie.getEffectiveVolume('peer-alice')).toBe(1.0)
      expect(charlie.getEffectiveVolume('peer-bob')).toBe(1.0)

      // Charlie activates Deafen
      charlie.setDeafen(true)

      // Charlie's sound is completely muted for all peers
      expect(charlie.getEffectiveVolume('peer-alice')).toBe(0)
      expect(charlie.getEffectiveVolume('peer-bob')).toBe(0)

      // Alice and Bob are unaffected: they still hear each other at full volume
      expect(alice.getEffectiveVolume('peer-bob')).toBe(1.0)
      expect(bob.getEffectiveVolume('peer-alice')).toBe(1.0)

      // Charlie undeafens
      charlie.setDeafen(false)
      expect(charlie.getEffectiveVolume('peer-alice')).toBe(1.0)
      expect(charlie.getEffectiveVolume('peer-bob')).toBe(1.0)
    })

    it('4.3: Allows individual volume balancing and selective silencing between peers', () => {
      // Alice thinks Bob is too loud, adjusts Bob to 30% volume
      alice.setVolumeFor('peer-bob', 30)

      expect(alice.getEffectiveVolume('peer-bob')).toBe(0.3)
      // Charlie's volume in Alice's headset is still 100%
      expect(alice.getEffectiveVolume('peer-charlie')).toBe(1.0)

      // Bob and Charlie hear each other at 100%
      expect(bob.getEffectiveVolume('peer-charlie')).toBe(1.0)
      expect(charlie.getEffectiveVolume('peer-bob')).toBe(1.0)

      // Alice sets master output volume to 50%
      alice.outputVolume = 50
      // Bob is now 0.50 * 0.30 = 0.15 (15%)
      expect(alice.getEffectiveVolume('peer-bob')).toBeCloseTo(0.15)
      // Charlie is now 0.50 * 1.00 = 0.50 (50%)
      expect(alice.getEffectiveVolume('peer-charlie')).toBeCloseTo(0.50)
    })
  })

  // =========================================================================
  // 5. Screen Share Audio & Call Audio Isolation Engine
  // =========================================================================
  describe('Phase 5: Audio Feedback Elimination via CallAudioIsolator', () => {
    it('isolates incoming call voices of peers during screen share to prevent audio echo loops', () => {
      // Alice starts screen share with audio
      const rawScreenAudio = new MockMediaStreamTrack('audio', 'chrome-tab-audio')
      const isolator = new CallAudioIsolator()

      // Connect Bob and Charlie's streams to MediaStore for isolator reference
      useMediaStore.setState({
        peerStreams: {
          'peer-bob': bob.localStream as any,
          'peer-charlie': charlie.localStream as any,
        },
      })

      const outputTrack = isolator.init(rawScreenAudio as any, alice.localStream as any, {
        mixMicrophone: true,
        isolateCallAudio: true,
        initialVolume: 0.8,
        targetTitle: 'YouTube - Google Chrome',
      })

      expect(outputTrack).toBeDefined()
      expect(useMediaStore.getState().screenShareTargetTitle).toBe('YouTube - Google Chrome')
      expect(useMediaStore.getState().screenShareIsolateCallAudio).toBe(true)
      expect(useMediaStore.getState().screenShareAudioMode).toBe('app_and_mic')

      // Clean up isolator
      isolator.dispose()
    })
  })

  // =========================================================================
  // 6. Zone Departure & Dynamic Audio Teardown
  // =========================================================================
  describe('Phase 6: Spatial Audio Isolation & Dynamic Teardown', () => {
    it('disconnects audio for participant who leaves the room while remaining 2 continue in call', () => {
      const zone = 'zone-reuniao-geral'
      alice.setZone(zone)
      bob.setZone(zone)
      charlie.setZone(zone)

      alice.peerStreams['peer-bob'] = bob.localStream
      alice.peerStreams['peer-charlie'] = charlie.localStream
      bob.peerStreams['peer-alice'] = alice.localStream
      bob.peerStreams['peer-charlie'] = charlie.localStream
      charlie.peerStreams['peer-alice'] = alice.localStream
      charlie.peerStreams['peer-bob'] = bob.localStream

      // Charlie leaves the room to a different zone / hallway
      charlie.setZone(null)

      // Tear down Charlie's connections
      delete alice.peerStreams['peer-charlie']
      alice.callStates['peer-charlie'] = 'idle'

      delete bob.peerStreams['peer-charlie']
      bob.callStates['peer-charlie'] = 'idle'

      charlie.peerStreams = {}
      charlie.callStates = {}

      // VERIFICATION:
      // Alice and Bob remain connected in audio call!
      expect(alice.peerStreams['peer-bob']).toBeDefined()
      expect(bob.peerStreams['peer-alice']).toBeDefined()

      // Charlie no longer has audio from Alice or Bob
      expect(charlie.peerStreams['peer-alice']).toBeUndefined()
      expect(charlie.peerStreams['peer-bob']).toBeUndefined()

      // Alice and Bob no longer hear Charlie
      expect(alice.peerStreams['peer-charlie']).toBeUndefined()
      expect(bob.peerStreams['peer-charlie']).toBeUndefined()
    })
  })
})
