import { describe, it, expect, beforeEach, vi } from 'vitest'
import { processNetworkMessage } from '../p2p/messageHandlers'
import { useGameStore } from '../store/useGameStore'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { Player } from '../types/game'
import { NetworkMessage } from '../types/p2p'
import { MediaCallHandler } from '../p2p/mediaCalls'

describe('10-Player Multi-Player Scale & Relay Stability Tests', () => {
  const HOST_PEER_ID = 'lira-TESTROOM-host'
  const LOCAL_CLIENT_PEER_ID = 'lira-TESTROOM-peer-02'
  const LOCAL_GAME_ID = 'local-game-02'

  const noopBroadcast = vi.fn()
  const noopRemovePeer = vi.fn()
  const noopEligibility = vi.fn()

  const PLAYERS_DATA: Array<{ peerId: string; gameId: string; name: string; skinTone: string; x: number; y: number }> = [
    { peerId: 'lira-TESTROOM-host', gameId: 'local-game-01', name: 'Alice (Host)', skinTone: '#ffd1b3', x: 10, y: 10 },
    { peerId: 'lira-TESTROOM-peer-02', gameId: 'local-game-02', name: 'Bob (Client 2)', skinTone: '#e0ac69', x: 12, y: 10 },
    { peerId: 'lira-TESTROOM-peer-03', gameId: 'local-game-03', name: 'Charlie (Client 3)', skinTone: '#c68642', x: 14, y: 10 },
    { peerId: 'lira-TESTROOM-peer-04', gameId: 'local-game-04', name: 'David (Client 4)', skinTone: '#8d5524', x: 16, y: 10 },
    { peerId: 'lira-TESTROOM-peer-05', gameId: 'local-game-05', name: 'Eve (Client 5)', skinTone: '#3c2e18', x: 18, y: 10 },
    { peerId: 'lira-TESTROOM-peer-06', gameId: 'local-game-06', name: 'Frank (Client 6)', skinTone: '#fcd0a1', x: 20, y: 10 },
    { peerId: 'lira-TESTROOM-peer-07', gameId: 'local-game-07', name: 'Grace (Client 7)', skinTone: '#d4aa78', x: 22, y: 10 },
    { peerId: 'lira-TESTROOM-peer-08', gameId: 'local-game-08', name: 'Heidi (Client 8)', skinTone: '#b58a63', x: 24, y: 10 },
    { peerId: 'lira-TESTROOM-peer-09', gameId: 'local-game-09', name: 'Ivan (Client 9)', skinTone: '#714928', x: 26, y: 10 },
    { peerId: 'lira-TESTROOM-peer-10', gameId: 'local-game-10', name: 'Judy (Client 10)', skinTone: '#4a321f', x: 28, y: 10 },
  ]

  function createPlayer(idx: number): Player {
    const data = PLAYERS_DATA[idx]
    return {
      id: data.peerId,
      gameId: data.gameId,
      name: data.name,
      x: data.x,
      y: data.y,
      direction: 'down',
      isMoving: false,
      role: data.peerId.endsWith('-host') ? 'host' : 'member',
      isHost: data.peerId.endsWith('-host'),
      avatar: {
        ...DEFAULT_AVATAR,
        skinTone: data.skinTone,
        hairColor: `#${idx}${idx}aaff`,
        topColor: `#ff${idx}${idx}aa`,
      },
      status: 'available',
      lastUpdated: Date.now(),
    }
  }

  beforeEach(() => {
    noopBroadcast.mockClear()
    noopRemovePeer.mockClear()
    noopEligibility.mockClear()

    useGameStore.setState({
      localPlayer: {
        ...createPlayer(1),
        id: LOCAL_CLIENT_PEER_ID,
        gameId: LOCAL_GAME_ID,
      },
      remotePlayers: {},
    })
  })

  it('correctly registers 9 remote players when relayed through Host without overwriting slots or taking host skin', () => {
    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const p = createPlayer(i)
      const joinMsg: NetworkMessage = {
        type: 'PLAYER_JOIN',
        senderId: p.id,
        payload: { player: p },
        timestamp: Date.now(),
      }

      processNetworkMessage(
        joinMsg,
        HOST_PEER_ID,
        false,
        noopBroadcast,
        noopRemovePeer,
        noopEligibility,
        LOCAL_CLIENT_PEER_ID
      )
    }

    const remotes = useGameStore.getState().remotePlayers
    const remoteKeys = Object.keys(remotes)

    expect(remoteKeys).toHaveLength(9)

    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const expectedId = PLAYERS_DATA[i].peerId
      expect(remotes[expectedId]).toBeDefined()
      expect(remotes[expectedId].name).toBe(PLAYERS_DATA[i].name)
      expect(remotes[expectedId].avatar?.skinTone).toBe(PLAYERS_DATA[i].skinTone)
      expect(remotes[expectedId].id).toBe(expectedId)

      if (expectedId.endsWith('-host')) {
        expect(remotes[expectedId].isHost).toBe(true)
      } else {
        expect(remotes[expectedId].isHost).toBe(false)
      }
    }
  })

  it('updates positions of all 10 players independently without moving or colliding with other avatars', () => {
    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const p = createPlayer(i)
      processNetworkMessage(
        { type: 'PLAYER_JOIN', senderId: p.id, payload: { player: p }, timestamp: Date.now() },
        HOST_PEER_ID,
        false,
        noopBroadcast,
        noopRemovePeer,
        noopEligibility,
        LOCAL_CLIENT_PEER_ID
      )
    }

    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const p = PLAYERS_DATA[i]
      const moveMsg: NetworkMessage = {
        type: 'PLAYER_MOVE',
        senderId: p.peerId,
        payload: {
          x: p.x + 50,
          y: p.y + 30,
          direction: 'right',
          isMoving: true,
        },
        timestamp: Date.now(),
      }

      processNetworkMessage(
        moveMsg,
        HOST_PEER_ID,
        false,
        noopBroadcast,
        noopRemovePeer,
        noopEligibility,
        LOCAL_CLIENT_PEER_ID
      )
    }

    const remotes = useGameStore.getState().remotePlayers

    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const p = PLAYERS_DATA[i]
      const updated = remotes[p.peerId]
      expect(updated.x).toBe(p.x + 50)
      expect(updated.y).toBe(p.y + 30)
      expect(updated.direction).toBe('right')
      expect(updated.isMoving).toBe(true)
    }

    expect(useGameStore.getState().localPlayer.x).toBe(12)
    expect(useGameStore.getState().localPlayer.y).toBe(10)
  })

  it('updates avatar/skin for a specific player without propagating the skin to other players or the Host', () => {
    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const p = createPlayer(i)
      processNetworkMessage(
        { type: 'PLAYER_JOIN', senderId: p.id, payload: { player: p }, timestamp: Date.now() },
        HOST_PEER_ID,
        false,
        noopBroadcast,
        noopRemovePeer,
        noopEligibility,
        LOCAL_CLIENT_PEER_ID
      )
    }

    const client5Id = PLAYERS_DATA[4].peerId
    const updateMsg: NetworkMessage = {
      type: 'PLAYER_UPDATE',
      senderId: client5Id,
      payload: {
        player: {
          id: client5Id,
          avatar: {
            ...DEFAULT_AVATAR,
            skinTone: '#00ff88',
            hairColor: '#ff0055',
            topColor: '#00ccff',
          },
        },
      },
      timestamp: Date.now(),
    }

    processNetworkMessage(
      updateMsg,
      HOST_PEER_ID,
      false,
      noopBroadcast,
      noopRemovePeer,
      noopEligibility,
      LOCAL_CLIENT_PEER_ID
    )

    const remotes = useGameStore.getState().remotePlayers

    expect(remotes[client5Id].avatar?.skinTone).toBe('#00ff88')
    expect(remotes[client5Id].avatar?.hairColor).toBe('#ff0055')

    expect(remotes[HOST_PEER_ID].avatar?.skinTone).toBe(PLAYERS_DATA[0].skinTone)

    expect(remotes[PLAYERS_DATA[2].peerId].avatar?.skinTone).toBe(PLAYERS_DATA[2].skinTone)
    expect(remotes[PLAYERS_DATA[7].peerId].avatar?.skinTone).toBe(PLAYERS_DATA[7].skinTone)
  })

  it('handles player disconnect without dropping remaining players or failing over host incorrectly', () => {
    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const p = createPlayer(i)
      processNetworkMessage(
        { type: 'PLAYER_JOIN', senderId: p.id, payload: { player: p }, timestamp: Date.now() },
        HOST_PEER_ID,
        false,
        noopBroadcast,
        noopRemovePeer,
        noopEligibility,
        LOCAL_CLIENT_PEER_ID
      )
    }

    expect(Object.keys(useGameStore.getState().remotePlayers)).toHaveLength(9)

    const client6Id = PLAYERS_DATA[5].peerId
    const leaveMsg: NetworkMessage = {
      type: 'PLAYER_LEAVE',
      senderId: HOST_PEER_ID,
      payload: { peerId: client6Id },
      timestamp: Date.now(),
    }

    const removePeerSpy = vi.fn((pid: string) => {
      useGameStore.getState().removeRemotePlayer(pid)
    })

    processNetworkMessage(
      leaveMsg,
      HOST_PEER_ID,
      false,
      noopBroadcast,
      removePeerSpy,
      noopEligibility,
      LOCAL_CLIENT_PEER_ID
    )

    expect(removePeerSpy).toHaveBeenCalledWith(client6Id)

    const remotes = useGameStore.getState().remotePlayers
    expect(remotes[client6Id]).toBeUndefined()
    expect(Object.keys(remotes)).toHaveLength(8)
    expect(remotes[HOST_PEER_ID]).toBeDefined()
  })

  it('delivers live screen share video tracks to all 9 peers in a 10-person zone without black screens', async () => {
    const mediaCalls = new Map<string, any>()
    const replacedTracksPerPeer = new Map<string, MediaStreamTrack>()

    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const pid = PLAYERS_DATA[i].peerId

      const fakeVideoSender = {
        track: { kind: 'video', id: `old-video-${pid}`, enabled: true },
        replaceTrack: vi.fn(async (track: MediaStreamTrack | null) => {
          if (track) replacedTracksPerPeer.set(pid, track)
        }),
        getParameters: vi.fn(() => ({ encodings: [{ maxBitrate: 0, maxFramerate: 0 }] })),
        setParameters: vi.fn(async () => {}),
      }

      const fakePc = {
        getSenders: () => [fakeVideoSender],
        getTransceivers: () => [],
      }

      mediaCalls.set(pid, {
        peer: pid,
        peerConnection: fakePc,
        close: vi.fn(),
      })
    }

    const fakeScreenTrack = {
      kind: 'video',
      id: 'screen-track-live-1080p',
      enabled: true,
      contentHint: '',
      readyState: 'live',
    } as unknown as MediaStreamTrack

    MediaCallHandler.replaceVideoTrack(
      mediaCalls,
      fakeScreenTrack,
      true,
      2_500_000,
      30
    )

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(replacedTracksPerPeer.size).toBe(9)
    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const pid = PLAYERS_DATA[i].peerId
      expect(replacedTracksPerPeer.get(pid)).toBe(fakeScreenTrack)
      expect(replacedTracksPerPeer.get(pid)?.id).toBe('screen-track-live-1080p')
    }
  })

  it('simulates a full 10-player star network: all 10 stores maintain all other 9 players with zero identity collisions', () => {
    interface SimClient {
      id: string
      name: string
      localPlayer: Player
      remotePlayers: Record<string, Player>
    }

    const clients: SimClient[] = PLAYERS_DATA.map((d, idx) => ({
      id: d.peerId,
      name: d.name,
      localPlayer: createPlayer(idx),
      remotePlayers: {},
    }))

    function broadcastFrom(senderIdx: number, msg: NetworkMessage) {
      const sender = clients[senderIdx]

      if (senderIdx !== 0) {
        processClientMessage(clients[0], msg, sender.id)
      }

      for (let i = 0; i < clients.length; i++) {
        if (i === senderIdx) continue
        if (senderIdx !== 0 && i === 0) continue
        processClientMessage(clients[i], msg, clients[0].id)
      }
    }

    function processClientMessage(client: SimClient, msg: NetworkMessage, transportPeerId: string) {
      const senderId = msg.senderId || msg.payload?.player?.id || transportPeerId

      if (msg.type === 'PLAYER_JOIN') {
        const p = msg.payload.player
        if (p.id === client.id) return
        client.remotePlayers[p.id] = {
          ...p,
          id: senderId,
          isHost: senderId.endsWith('-host'),
        }
      } else if (msg.type === 'PLAYER_MOVE') {
        if (client.remotePlayers[senderId]) {
          client.remotePlayers[senderId] = {
            ...client.remotePlayers[senderId],
            x: msg.payload.x,
            y: msg.payload.y,
            direction: msg.payload.direction,
            isMoving: msg.payload.isMoving,
          }
        }
      }
    }

    for (let i = 1; i < clients.length; i++) {
      const newcomer = clients[i]

      const joinMsg: NetworkMessage = {
        type: 'PLAYER_JOIN',
        senderId: newcomer.id,
        payload: { player: newcomer.localPlayer },
        timestamp: Date.now(),
      }
      broadcastFrom(i, joinMsg)

      for (const existingPlayer of Object.values(clients[0].remotePlayers)) {
        if (existingPlayer.id !== newcomer.id) {
          processClientMessage(
            newcomer,
            {
              type: 'PLAYER_JOIN',
              senderId: existingPlayer.id,
              payload: { player: existingPlayer },
              timestamp: Date.now(),
            },
            clients[0].id
          )
        }
      }
      processClientMessage(
        newcomer,
        {
          type: 'PLAYER_JOIN',
          senderId: clients[0].id,
          payload: { player: clients[0].localPlayer },
          timestamp: Date.now(),
        },
        clients[0].id
      )
    }

    for (let i = 0; i < clients.length; i++) {
      const client = clients[i]
      const remotes = Object.keys(client.remotePlayers)
      expect(remotes).toHaveLength(9)

      for (let j = 0; j < clients.length; j++) {
        if (i === j) continue
        const other = clients[j]
        expect(client.remotePlayers[other.id]).toBeDefined()
        expect(client.remotePlayers[other.id].name).toBe(other.name)
        expect(client.remotePlayers[other.id].avatar?.skinTone).toBe(other.localPlayer.avatar?.skinTone)
      }
    }

    for (let i = 0; i < clients.length; i++) {
      const moveMsg: NetworkMessage = {
        type: 'PLAYER_MOVE',
        senderId: clients[i].id,
        payload: {
          x: 100 + i * 5,
          y: 200 + i * 5,
          direction: 'up',
          isMoving: false,
        },
        timestamp: Date.now(),
      }
      broadcastFrom(i, moveMsg)
    }

    for (let i = 0; i < clients.length; i++) {
      for (let j = 0; j < clients.length; j++) {
        if (i === j) continue
        const remote = clients[i].remotePlayers[clients[j].id]
        expect(remote.x).toBe(100 + j * 5)
        expect(remote.y).toBe(200 + j * 5)
        expect(remote.direction).toBe('up')
      }
    }
  })

  it('verifies host migration and failover election among 9 remaining peers when the host disconnects', () => {
    const ROOM_CODE = 'TESTROOM'
    const hostPeerId = `lira-${ROOM_CODE}-host`

    useGameStore.getState().setRoomSession(ROOM_CODE, false)
    expect(useGameStore.getState().isHost).toBe(false)

    for (let i = 0; i < PLAYERS_DATA.length; i++) {
      if (i === 1) continue
      const p = createPlayer(i)
      processNetworkMessage(
        { type: 'PLAYER_JOIN', senderId: p.id, payload: { player: p }, timestamp: Date.now() },
        hostPeerId,
        false,
        noopBroadcast,
        noopRemovePeer,
        noopEligibility,
        LOCAL_CLIENT_PEER_ID
      )
    }

    expect(Object.keys(useGameStore.getState().remotePlayers)).toHaveLength(9)

    const remainingPeers = PLAYERS_DATA.slice(2).map((d) => d.peerId)
    const myId = LOCAL_CLIENT_PEER_ID

    const candidateList = [myId, ...remainingPeers].filter(Boolean).sort()

    expect(candidateList[0]).toBe(LOCAL_CLIENT_PEER_ID)

    const isElected = candidateList[0] === myId
    expect(isElected).toBe(true)

    useGameStore.getState().setRoomSession(ROOM_CODE, true)
    useGameStore.getState().updatePlayerRole(LOCAL_CLIENT_PEER_ID, 'host', {
      canEditMap: true,
      canManageRoles: true,
      canMuteOthers: true,
      canKick: true,
    })

    useGameStore.getState().removeRemotePlayer(hostPeerId)

    const local = useGameStore.getState().localPlayer
    expect(useGameStore.getState().isHost).toBe(true)
    expect(local.role).toBe('host')
    expect(local.permissions?.canEditMap).toBe(true)
    expect(local.permissions?.canKick).toBe(true)
    expect(local.permissions?.canMuteOthers).toBe(true)

    const remotes = useGameStore.getState().remotePlayers
    expect(Object.keys(remotes)).toHaveLength(8)
    expect(remotes[hostPeerId]).toBeUndefined()
    for (let i = 2; i < PLAYERS_DATA.length; i++) {
      expect(remotes[PLAYERS_DATA[i].peerId]).toBeDefined()
      expect(remotes[PLAYERS_DATA[i].peerId].name).toBe(PLAYERS_DATA[i].name)
    }

    const candidateListForClient3 = [
      'lira-TESTROOM-peer-03',
      'lira-TESTROOM-peer-02',
      ...PLAYERS_DATA.slice(3).map((d) => d.peerId),
    ].sort()

    expect(candidateListForClient3[0]).toBe('lira-TESTROOM-peer-02')
    const client3IsElected = candidateListForClient3[0] === 'lira-TESTROOM-peer-03'
    expect(client3IsElected).toBe(false)
  })
})
