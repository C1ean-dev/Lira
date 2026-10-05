import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { collectReportContext } from '../utils/reportContext'
import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'
import { useChatStore } from '../store/useChatStore'
import { PeerManager } from '../p2p/PeerManager'
import { getBufferedLogs, __resetLoggerForTests } from '../utils/logger'

/**
 * Each part of the app that owns state describes it for error reports
 * (reportContext.ts). These snapshots are what a report shows under `context`.
 */

const player = (id: string) => ({ id, name: id, x: 0, y: 0, direction: 'down', isMoving: false }) as never

const fakeTrack = (kind: string, enabled: boolean) => ({ kind, enabled, muted: false, readyState: 'live', label: `${kind} device` })
const fakeStream = (tracks: ReturnType<typeof fakeTrack>[]) =>
  ({
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
  }) as never

describe('room snapshot', () => {
  it('describes the lobby', () => {
    useGameStore.setState({ roomId: null, isOwner: false, isHost: false, isConnected: false, connectionStatus: 'disconnected', remotePlayers: {}, callStates: {} })

    expect(collectReportContext().room).toMatchObject({ inRoom: false, players: 0, calls: {} })
  })

  it('describes the room, the role of this player and the state of the calls', () => {
    useGameStore.setState({
      roomId: 'ROOM-1',
      isOwner: true,
      isHost: true,
      isConnected: true,
      connectionStatus: 'connected',
      connectionHostId: 'lira-ROOM-1-host',
      isRoomPublic: false,
      remotePlayers: { a: player('a'), b: player('b'), c: player('c') },
      callStates: { a: 'connected', b: 'connected', c: 'failed' },
    })
    useGameStore.getState().setCurrentZoneId('zone-7')

    expect(collectReportContext().room).toMatchObject({
      inRoom: true,
      roomId: 'ROOM-1',
      role: 'host',
      owner: true,
      connected: true,
      status: 'connected',
      hostId: 'lira-ROOM-1-host',
      public: false,
      players: 3,
      calls: { connected: 2, failed: 1 },
      zone: 'zone-7',
    })
  })

  it('says a guest is a guest', () => {
    useGameStore.setState({ roomId: 'ROOM-1', isHost: false, isOwner: false })
    expect(collectReportContext().room).toMatchObject({ role: 'guest', owner: false })
  })
})

describe('media snapshot', () => {
  it('describes microphone, camera, screen share and audio processing', () => {
    useMediaStore.setState({
      isMuted: true,
      isCameraOff: false,
      isScreenSharing: true,
      isDeafened: false,
      isNoiseSuppressionEnabled: true,
      selectedAudioInput: 'default',
      selectedAudioOutput: '8c1f4b7a9d3e5f60718293a4b5c6d7e8f9012345',
      selectedVideoInput: '',
      screenShareTargetTitle: 'Visual Studio Code',
      localStream: fakeStream([fakeTrack('audio', false), fakeTrack('video', true)]),
      localScreenStream: null,
    })

    const media = collectReportContext().media as Record<string, any>
    expect(media).toMatchObject({
      muted: true,
      cameraOff: false,
      screenSharing: true,
      deafened: false,
      noiseSuppression: true,
      devices: { input: 'default', output: '8c1f4b…2345', camera: '' },
      screenShare: { target: 'Visual Studio Code' },
      localStream: {
        audio: [{ kind: 'audio', enabled: false, readyState: 'live' }],
        video: [{ kind: 'video', enabled: true, readyState: 'live' }],
      },
      screenStream: null,
    })
    expect(media.processor).toBe(useMediaStore.getState().audioProcessorMode)
  })

  it('carries no stream or track object', () => {
    useMediaStore.setState({ localStream: fakeStream([fakeTrack('audio', true)]) })
    expect(() => JSON.stringify(collectReportContext().media)).not.toThrow()
    expect(JSON.stringify(collectReportContext().media)).not.toContain('getAudioTracks')
  })
})

describe('chat snapshot', () => {
  it('describes where the chat is, not what was said', () => {
    useChatStore.setState({ isChatOpen: true, activeChannelId: 'general' })
    const chat = collectReportContext().chat as Record<string, any>

    expect(chat).toMatchObject({ open: true, activeChannel: 'general' })
    expect(typeof chat.channels).toBe('number')
    expect(typeof chat.messages).toBe('number')
    expect(JSON.stringify(chat)).not.toContain('content')
  })
})

describe('p2p snapshot', () => {
  it('describes the connection to the room, before and after joining', () => {
    const manager = PeerManager.getInstance() as any
    expect(collectReportContext().p2p).toMatchObject({
      peerId: null,
      signaling: 'none',
      host: false,
      connections: { total: 0, open: 0 },
      mediaCalls: 0,
      reconnectAttempts: 0,
      reconnectPending: false,
    })

    manager.peer = { id: 'lira-ROOM-1-peer-abc', open: true, disconnected: false, destroyed: false }
    manager.roomCode = 'ROOM-1'
    manager.connections.set('lira-ROOM-1-host', { open: true })
    manager.connections.set('lira-ROOM-1-peer-x', { open: false })
    manager.signalingReconnectAttempts = 4
    manager.signalingReconnectTimer = 1

    expect(collectReportContext().p2p).toMatchObject({
      peerId: 'lira-ROOM-1-peer-abc',
      signaling: 'open',
      roomCode: 'ROOM-1',
      connections: { total: 2, open: 1 },
      reconnectAttempts: 4,
      reconnectPending: true,
    })

    manager.peer = { id: 'x', open: false, disconnected: true, destroyed: false }
    expect((collectReportContext().p2p as any).signaling).toBe('disconnected')
    manager.peer = { id: 'x', open: false, disconnected: true, destroyed: true }
    expect((collectReportContext().p2p as any).signaling).toBe('destroyed')

    manager.peer = null
    manager.roomCode = null
    manager.connections.clear()
    manager.signalingReconnectAttempts = 0
    manager.signalingReconnectTimer = null
  })
})

describe('a network message that breaks its handler', () => {
  beforeEach(() => {
    __resetLoggerForTests()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    __resetLoggerForTests()
    vi.restoreAllMocks()
  })

  it('is reported with its type and sender instead of throwing into the connection', () => {
    const manager = PeerManager.getInstance() as any
    const hostile = { type: 'PLAYER_UPDATE', senderId: 'lira-ROOM-1-peer-x', timestamp: 1, payload: null }
    Object.defineProperty(hostile, 'payload', {
      get() {
        throw new Error('payload exploded')
      },
    })

    expect(() => manager.handleNetworkMessage(hostile, 'lira-ROOM-1-peer-x')).not.toThrow()

    const record = getBufferedLogs().find((entry) => entry.level === 'error')
    expect(record).toMatchObject({ scope: 'P2P Message' })
    expect(record!.message).toContain('PLAYER_UPDATE')
    expect(record!.report).toMatchObject({
      kind: 'handled',
      data: { type: 'PLAYER_UPDATE', from: 'lira-ROOM-1-peer-x', host: false },
      error: { message: 'payload exploded' },
    })
  })

  it('is reported when it is not a message at all', () => {
    const manager = PeerManager.getInstance() as any
    expect(() => manager.handleNetworkMessage(null, 'lira-ROOM-1-peer-x')).not.toThrow()
    expect(() => manager.handleNetworkMessage('garbage', 'lira-ROOM-1-peer-x')).not.toThrow()

    const records = getBufferedLogs().filter((entry) => entry.level === 'error')
    expect(records.length).toBeGreaterThanOrEqual(1)
    expect(records[0].report).toMatchObject({ data: { type: 'none', from: 'lira-ROOM-1-peer-x' } })
  })
})

describe('a message that cannot be sent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is logged with its type and who it was for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const manager = PeerManager.getInstance() as any
    const failure = new Error('Connection is not open')
    const conn = {
      open: true,
      peer: 'lira-ROOM-1-peer-x',
      send: () => {
        throw failure
      },
    }

    expect(() => manager.sendToPeer(conn, { type: 'CHAT_MESSAGE', senderId: 'me', timestamp: 1, payload: {} })).not.toThrow()
    expect(warn).toHaveBeenCalledWith('[P2P Data] Failed to send CHAT_MESSAGE to lira-ROOM-1-peer-x:', failure)
  })
})
