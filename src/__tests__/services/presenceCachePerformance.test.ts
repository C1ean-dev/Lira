import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FriendsPresenceService } from '../../services/friendsPresenceService'
import { useGameStore } from '../../store/useGameStore'

const original = useGameStore.getState()
const cacheKey = 'lira_presence_cache'
let service: FriendsPresenceService
let saved: Map<string, string>
let postMessage: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-15T01:17:00Z'))
  saved = new Map()
  postMessage = vi.fn()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    },
    BroadcastChannel: true,
    addEventListener: vi.fn(),
  })
  vi.stubGlobal('BroadcastChannel', class {
    postMessage = postMessage
    close() {}
  })
  useGameStore.setState({
    localPlayer: {
      ...original.localPlayer,
      id: 'local-user',
      gameId: 'local-user',
      name: 'Alice',
      profilePicture: 'data:image/png;base64,' + 'a'.repeat(1_000_000),
      avatar: { ...original.localPlayer.avatar, customSkinUrl: 'b'.repeat(1_000_000) },
    },
    friends: [],
    friendProfiles: {},
  })
  ;(FriendsPresenceService as any).instance = null
})

afterEach(() => {
  service?.destroy()
  ;(FriendsPresenceService as any).instance = null
  useGameStore.setState(original)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('presence heartbeat cache cost', () => {
  it('keeps cached presence small without copying images or traversing the avatar', async () => {
    const avatar = { ...useGameStore.getState().localPlayer.avatar, toJSON: vi.fn(() => 'large-avatar') }
    useGameStore.setState({ localPlayer: { ...useGameStore.getState().localPlayer, avatar } })
    service = FriendsPresenceService.getInstance()
    await service.sendHeartbeat()

    const raw = saved.get(cacheKey)!
    expect(raw.length).toBeLessThan(2000)
    expect(JSON.parse(raw)[0]).not.toHaveProperty('profilePicture')
    expect(JSON.parse(raw)[0]).not.toHaveProperty('avatar')
    expect(avatar.toJSON).not.toHaveBeenCalled()
  })

  it('continues sending full profile data and refreshing lightweight heartbeat timestamps', async () => {
    service = FriendsPresenceService.getInstance()
    await vi.advanceTimersByTimeAsync(2000)

    const local = useGameStore.getState().localPlayer
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      presence: expect.objectContaining({ avatar: local.avatar, profilePicture: local.profilePicture }),
    }))
    expect(JSON.parse(saved.get(cacheKey)!)[0]).toMatchObject({
      userId: 'local-user', name: 'Alice', lastHeartbeat: Date.now(),
    })
  })

  it('compacts incoming and legacy cached presences while preserving online and room status', () => {
    saved.set(cacheKey, JSON.stringify([{
      userId: 'cached-user', name: 'Bob', lastHeartbeat: Date.now(),
      profilePicture: 'c'.repeat(100_000), avatar: { customSkinUrl: 'd'.repeat(100_000) },
      roomCode: 'room-1', roomName: 'Office', inRoom: true,
    }, { userId: 'stale-user', lastHeartbeat: Date.now() - 9000 }]))
    service = FriendsPresenceService.getInstance()
    ;(service as any).handleIncomingMessage({
      type: 'PRESENCE_HEARTBEAT',
      presence: {
        userId: 'incoming-user', name: 'Carol', lastHeartbeat: Date.now(), inRoom: false,
        profilePicture: 'e'.repeat(100_000), avatar: { customSkinUrl: 'f'.repeat(100_000) },
      },
    })

    expect(saved.get(cacheKey)!.length).toBeLessThan(3000)
    expect(service.getFriendStatus({ id: 'cached-user', name: 'Bob', lastSeen: 0 })).toMatchObject({
      isOnline: true, inRoom: true, roomCode: 'room-1', roomName: 'Office',
    })
    expect(service.getPresenceMap().has('stale-user')).toBe(false)
    expect(service.getPresenceMap().get('incoming-user')?.profilePicture).toHaveLength(100_000)
  })

  it('removes offline entries from the compact cache', async () => {
    service = FriendsPresenceService.getInstance()
    await service.broadcastOffline()
    expect(JSON.parse(saved.get(cacheKey)!)).toEqual([])
  })
})
