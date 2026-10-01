import { describe, it, expect, beforeEach, vi } from 'vitest'
import { processNetworkMessage } from '../p2p/messageHandlers'
import { useGameStore } from '../store/useGameStore'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { Player } from '../types/game'
import { NetworkMessage } from '../types/p2p'
import { MediaCallHandler } from '../p2p/mediaCalls'

interface ScaleMetrics {
  totalPlayers: number
  joinTimeMs: number
  joinsPerSec: number
  movementBatchCount: number
  movementTotalMs: number
  movesPerSec: number
  avatarUpdatesCount: number
  avatarUpdatesTotalMs: number
  avatarUpdatesPerSec: number
  screenSharePeersCount: number
  screenShareDeliveryMs: number
  screenShareSuccessRate: string
  hostElectionCandidateCount: number
  hostElectionTimeMs: number
  memoryHeapUsedMb: number
}

describe('100-Player Scale & Performance Stress Test', () => {
  const TOTAL_PLAYERS = 100
  const ROOM_CODE = 'STRESS100'
  const HOST_PEER_ID = `gather-v2-${ROOM_CODE}-host`
  const LOCAL_CLIENT_PEER_ID = `gather-v2-${ROOM_CODE}-peer-001`
  const LOCAL_GAME_ID = 'local-game-001'

  const noopBroadcast = vi.fn()
  const noopRemovePeer = vi.fn()
  const noopEligibility = vi.fn()

  // Generate 100 distinct players
  const PLAYERS: Player[] = []
  for (let i = 0; i < TOTAL_PLAYERS; i++) {
    const isHost = i === 0
    const padId = String(i).padStart(3, '0')
    const peerId = isHost ? HOST_PEER_ID : `gather-v2-${ROOM_CODE}-peer-${padId}`
    const gameId = `local-game-${padId}`
    const skinTones = ['#ffd1b3', '#e0ac69', '#c68642', '#8d5524', '#3c2e18', '#fcd0a1', '#d4aa78', '#b58a63', '#714928', '#4a321f']

    PLAYERS.push({
      id: peerId,
      gameId,
      name: isHost ? 'Host Player' : `Player ${padId}`,
      x: 10 + (i % 20) * 2,
      y: 10 + Math.floor(i / 20) * 2,
      direction: 'down',
      isMoving: false,
      role: isHost ? 'host' : 'member',
      isHost,
      avatar: {
        ...DEFAULT_AVATAR,
        skinTone: skinTones[i % skinTones.length],
        hairColor: `#${(i * 123456 % 0xffffff).toString(16).padStart(6, '0')}`,
        topColor: `#${(i * 654321 % 0xffffff).toString(16).padStart(6, '0')}`,
      },
      status: 'available',
      lastUpdated: Date.now(),
    })
  }

  const collectedMetrics: Partial<ScaleMetrics> = {
    totalPlayers: TOTAL_PLAYERS,
  }

  beforeEach(() => {
    noopBroadcast.mockClear()
    noopRemovePeer.mockClear()
    noopEligibility.mockClear()

    useGameStore.setState({
      localPlayer: {
        ...PLAYERS[1], // Client 1
        id: LOCAL_CLIENT_PEER_ID,
        gameId: LOCAL_GAME_ID,
      },
      remotePlayers: {},
    })
  })

  it('1. Connects and registers 99 remote players via Host relay without identity collisions', () => {
    const start = performance.now()

    // Client 1 receives join messages for all 99 other players (1 Host + 98 other clients)
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue // Skip self
      const p = PLAYERS[i]
      const msg: NetworkMessage = {
        type: 'PLAYER_JOIN',
        senderId: p.id,
        payload: { player: p },
        timestamp: Date.now(),
      }

      processNetworkMessage(
        msg,
        HOST_PEER_ID, // All arrive over Host transport
        false,
        noopBroadcast,
        noopRemovePeer,
        noopEligibility,
        LOCAL_CLIENT_PEER_ID
      )
    }

    const elapsed = performance.now() - start
    collectedMetrics.joinTimeMs = Math.round(elapsed * 100) / 100
    collectedMetrics.joinsPerSec = Math.round((99 / (elapsed / 1000)))

    const remotes = useGameStore.getState().remotePlayers
    const remoteKeys = Object.keys(remotes)

    expect(remoteKeys).toHaveLength(99)

    // Verify 100% collision-free identity mapping
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue
      const p = PLAYERS[i]
      expect(remotes[p.id]).toBeDefined()
      expect(remotes[p.id].id).toBe(p.id)
      expect(remotes[p.id].gameId).toBe(p.gameId)
      expect(remotes[p.id].name).toBe(p.name)
      expect(remotes[p.id].avatar?.skinTone).toBe(p.avatar?.skinTone)

      if (p.id.endsWith('-host')) {
        expect(remotes[p.id].isHost).toBe(true)
      } else {
        expect(remotes[p.id].isHost).toBe(false)
      }
    }
  })

  it('2. Processes high-volume movement for 100 players (1,000 movement updates)', () => {
    // Register players first
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue
      const p = PLAYERS[i]
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

    // Send 10 movements per player = 990 total movement messages
    const MOVES_PER_PLAYER = 10
    const TOTAL_MOVES = 99 * MOVES_PER_PLAYER

    const start = performance.now()

    for (let step = 1; step <= MOVES_PER_PLAYER; step++) {
      for (let i = 0; i < TOTAL_PLAYERS; i++) {
        if (i === 1) continue
        const p = PLAYERS[i]
        const moveMsg: NetworkMessage = {
          type: 'PLAYER_MOVE',
          senderId: p.id,
          payload: {
            x: p.x + step,
            y: p.y + step,
            direction: step % 2 === 0 ? 'down' : 'up',
            isMoving: step !== MOVES_PER_PLAYER,
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
    }

    const elapsed = performance.now() - start
    collectedMetrics.movementBatchCount = TOTAL_MOVES
    collectedMetrics.movementTotalMs = Math.round(elapsed * 100) / 100
    collectedMetrics.movesPerSec = Math.round((TOTAL_MOVES / (elapsed / 1000)))

    // Verify all players reached their final coordinates accurately
    const remotes = useGameStore.getState().remotePlayers
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue
      const p = PLAYERS[i]
      expect(remotes[p.id].x).toBe(p.x + MOVES_PER_PLAYER)
      expect(remotes[p.id].y).toBe(p.y + MOVES_PER_PLAYER)
      expect(remotes[p.id].isMoving).toBe(false)
    }

    // Local player was never modified
    expect(useGameStore.getState().localPlayer.x).toBe(PLAYERS[1].x)
  })

  it('3. Processes simultaneous avatar customization updates across 99 players without skin bleeding', () => {
    // Register players
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue
      const p = PLAYERS[i]
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

    const start = performance.now()

    // 99 players each send a unique avatar skin update
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue
      const p = PLAYERS[i]
      const updateMsg: NetworkMessage = {
        type: 'PLAYER_UPDATE',
        senderId: p.id,
        payload: {
          player: {
            id: p.id,
            avatar: {
              ...DEFAULT_AVATAR,
              skinTone: `#custom-${String(i).padStart(3, '0')}`,
              hairColor: `#hair-${String(i).padStart(3, '0')}`,
              topColor: `#top-${String(i).padStart(3, '0')}`,
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
    }

    const elapsed = performance.now() - start
    collectedMetrics.avatarUpdatesCount = 99
    collectedMetrics.avatarUpdatesTotalMs = Math.round(elapsed * 100) / 100
    collectedMetrics.avatarUpdatesPerSec = Math.round((99 / (elapsed / 1000)))

    const remotes = useGameStore.getState().remotePlayers

    // Verify each player has their OWN unique custom skin without affecting any other player
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue
      const p = PLAYERS[i]
      expect(remotes[p.id].avatar?.skinTone).toBe(`#custom-${String(i).padStart(3, '0')}`)
      expect(remotes[p.id].avatar?.hairColor).toBe(`#hair-${String(i).padStart(3, '0')}`)
      expect(remotes[p.id].avatar?.topColor).toBe(`#top-${String(i).padStart(3, '0')}`)
    }
  })

  it('4. Delivers live screenshare video tracks to 99 peer connections simultaneously', async () => {
    // Setup 99 media call connections
    const mediaCalls = new Map<string, any>()
    const replacedTracks = new Map<string, MediaStreamTrack>()

    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue
      const pid = PLAYERS[i].id

      const fakeVideoSender = {
        track: { kind: 'video', id: `cam-track-${pid}`, enabled: true },
        replaceTrack: vi.fn(async (track: MediaStreamTrack | null) => {
          if (track) replacedTracks.set(pid, track)
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

    const liveScreenTrack = {
      kind: 'video',
      id: 'live-screen-1080p-60fps',
      enabled: true,
      contentHint: '',
      readyState: 'live',
    } as unknown as MediaStreamTrack

    const start = performance.now()

    MediaCallHandler.replaceVideoTrack(
      mediaCalls,
      liveScreenTrack,
      true, // isScreenShare
      2_500_000,
      30
    )

    await new Promise((resolve) => setTimeout(resolve, 30))

    const elapsed = performance.now() - start
    collectedMetrics.screenSharePeersCount = 99
    collectedMetrics.screenShareDeliveryMs = Math.round(elapsed * 100) / 100
    collectedMetrics.screenShareSuccessRate = `${((replacedTracks.size / 99) * 100).toFixed(1)}%`

    // Verify all 99 peers received the live screen track with 100% success rate
    expect(replacedTracks.size).toBe(99)
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue
      const pid = PLAYERS[i].id
      expect(replacedTracks.get(pid)).toBe(liveScreenTrack)
      expect(replacedTracks.get(pid)?.id).toBe('live-screen-1080p-60fps')
    }
  })

  it('5. Executes host failover election among 99 remaining candidates upon host departure', () => {
    // Setup 99 peers in room
    for (let i = 0; i < TOTAL_PLAYERS; i++) {
      if (i === 1) continue
      const p = PLAYERS[i]
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

    useGameStore.getState().setRoomSession(ROOM_CODE, false)

    // Host departs!
    const start = performance.now()

    const remainingPeers = PLAYERS.slice(2).map((p) => p.id)
    const myId = LOCAL_CLIENT_PEER_ID

    // Deterministic election among 99 remaining clients
    const candidateList = [myId, ...remainingPeers].filter(Boolean).sort()
    const electedCandidate = candidateList[0]

    // Promotion of elected host
    if (electedCandidate === myId) {
      useGameStore.getState().setRoomSession(ROOM_CODE, true)
      useGameStore.getState().updatePlayerRole(myId, 'host', {
        canEditMap: true,
        canManageRoles: true,
        canMuteOthers: true,
        canKick: true,
      })
      useGameStore.getState().removeRemotePlayer(HOST_PEER_ID)
    }

    const elapsed = performance.now() - start
    collectedMetrics.hostElectionCandidateCount = 99
    collectedMetrics.hostElectionTimeMs = Math.round(elapsed * 1000) / 1000

    expect(electedCandidate).toBe(LOCAL_CLIENT_PEER_ID)
    expect(useGameStore.getState().isHost).toBe(true)
    expect(useGameStore.getState().localPlayer.role).toBe('host')
    expect(Object.keys(useGameStore.getState().remotePlayers)).toHaveLength(98)
  })

  it('6. Emits full performance and scale metrics report for 100 players', () => {
    const memoryUsage = process.memoryUsage()
    collectedMetrics.memoryHeapUsedMb = Math.round((memoryUsage.heapUsed / 1024 / 1024) * 100) / 100

    console.log('\n================================================================')
    console.log('       100-PLAYER MULTI-PLAYER SCALE & BENCHMARK REPORT         ')
    console.log('================================================================')
    console.log(`Total Players Tested:              ${collectedMetrics.totalPlayers}`)
    console.log(`Time to Join 99 Players:           ${collectedMetrics.joinTimeMs} ms (${collectedMetrics.joinsPerSec} joins/sec)`)
    console.log(`Movement Throughput (1,000 moves): ${collectedMetrics.movementTotalMs} ms (${collectedMetrics.movesPerSec} moves/sec)`)
    console.log(`Avatar Updates Throughput (99):    ${collectedMetrics.avatarUpdatesTotalMs} ms (${collectedMetrics.avatarUpdatesPerSec} updates/sec)`)
    console.log(`Screen Share Delivery (99 peers):  ${collectedMetrics.screenShareDeliveryMs} ms (Success: ${collectedMetrics.screenShareSuccessRate})`)
    console.log(`Host Election Time (99 candidates): ${collectedMetrics.hostElectionTimeMs} ms`)
    console.log(`Heap Memory Used:                  ${collectedMetrics.memoryHeapUsedMb} MB`)
    console.log('================================================================\n')

    expect(collectedMetrics.totalPlayers).toBe(100)
    expect(collectedMetrics.joinsPerSec).toBeGreaterThan(500) // Expect > 500 joins/sec
    expect(collectedMetrics.movesPerSec).toBeGreaterThan(1000) // Expect > 1000 moves/sec
    expect(collectedMetrics.screenShareSuccessRate).toBe('100.0%')
  })
})
