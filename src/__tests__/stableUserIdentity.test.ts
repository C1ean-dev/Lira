import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  generateUserId,
  isUserId,
  getPlayerUserId,
  getFriendUserId,
  findFriendKey,
  isSameParticipant,
} from '../utils/userId'
import { toFriendPeerId, fromFriendPeerId } from '../p2p/FriendsNetwork'

const mockStorage: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => (key in mockStorage ? mockStorage[key] : null),
  setItem: (key: string, value: string) => {
    mockStorage[key] = value
  },
  removeItem: (key: string) => {
    delete mockStorage[key]
  },
}
;(globalThis as any).localStorage = localStorageMock

const PROFILE_KEY = 'lira_user_profile'

/** Simulates an app launch: every module is evaluated again. */
async function launchApp() {
  vi.resetModules()
  return await import('../store/useGameStore')
}

describe('Stable user id', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStorage)) delete mockStorage[key]
  })

  it('generates distinct ids in the stable format', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateUserId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(isUserId(id)).toBe(true)
  })

  it('does not mistake connection ids, legacy ids or placeholders for user ids', () => {
    expect(isUserId('lira-ROOM-host')).toBe(false)
    expect(isUserId('lira-ROOM-peer-x1y2z')).toBe(false)
    expect(isUserId('local-ab12cd')).toBe(false)
    expect(isUserId('friend-bob')).toBe(false)
    expect(isUserId(undefined)).toBe(false)
  })

  it('maps to a friend peer id that PeerJS accepts and back', () => {
    const userId = generateUserId()
    const peerId = toFriendPeerId(userId)
    // PeerJS id rule (util.validateId)
    expect(peerId).toMatch(/^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/)
    expect(fromFriendPeerId(peerId)).toBe(userId)
    // Room peers must never be read as friend peers
    expect(fromFriendPeerId('lira-ROOM-host')).toBeNull()
    expect(fromFriendPeerId('lirafriend-not-a-user-id')).toBeNull()
  })

  it('keeps the same id across app restarts', async () => {
    const first = (await launchApp()).useGameStore.getState().localPlayer
    expect(isUserId(first.id)).toBe(true)
    expect(first.gameId).toBe(first.id)
    expect(JSON.parse(mockStorage[PROFILE_KEY]).id).toBe(first.id)

    const second = (await launchApp()).useGameStore.getState().localPlayer
    expect(second.id).toBe(first.id)
    expect(second.gameId).toBe(first.id)
  })

  it('does not lose the id when the profile is edited', async () => {
    const { useGameStore } = await launchApp()
    const id = useGameStore.getState().localPlayer.id
    useGameStore.getState().setLocalPlayer({ name: 'Ana' })
    useGameStore.getState().setLocalStatus('busy')

    const relaunched = (await launchApp()).useGameStore.getState().localPlayer
    expect(relaunched.id).toBe(id)
    expect(relaunched.name).toBe('Ana')
  })

  it('upgrades a profile that was saved without a stable id', async () => {
    mockStorage[PROFILE_KEY] = JSON.stringify({ id: 'local-ab12cd', name: 'Veterano' })

    const player = (await launchApp()).useGameStore.getState().localPlayer
    expect(isUserId(player.id)).toBe(true)
    expect(player.name).toBe('Veterano')
    expect(JSON.parse(mockStorage[PROFILE_KEY]).id).toBe(player.id)
  })

  it('still resolves to the user id while the player entry is keyed by a room connection id', async () => {
    const { useGameStore, getLocalUserId } = await launchApp()
    const userId = useGameStore.getState().localPlayer.id

    // What PeerManager does when a room is joined
    useGameStore.getState().setLocalPlayer({ id: 'lira-ROOM-peer-x1y2z', gameId: userId })
    expect(getLocalUserId()).toBe(userId)
    expect(getPlayerUserId({ id: 'lira-ROOM-peer-x1y2z', gameId: userId })).toBe(userId)
  })
})

describe('Friend identity resolution', () => {
  const ANA = 'u-anaanaanaanaanaanaan'
  const BIA = 'u-biabiabiabiabiabiabi'

  it('resolves the user id of a friend entry, or null for entries tied to a connection id', () => {
    expect(isUserId(ANA) && isUserId(BIA)).toBe(true)
    expect(getFriendUserId({ id: ANA })).toBe(ANA)
    expect(getFriendUserId({ id: 'friend-ana', actualUserId: ANA })).toBe(ANA)
    expect(getFriendUserId({ id: 'lira-ROOM-host', gameId: ANA })).toBe(ANA)
    expect(getFriendUserId({ id: 'lira-ROOM-peer-x1y2z', actualUserId: 'lira-ROOM-peer-x1y2z' })).toBeNull()
  })

  it('finds a friend by connection id or user id, never by name', () => {
    const friends = [ANA, 'friend-bia']
    const profiles = {
      [ANA]: { id: ANA, name: 'Ana' },
      'friend-bia': { id: 'friend-bia', name: 'Bia', actualUserId: BIA },
    }
    // In a room the player entry is keyed by a new connection id every time
    expect(findFriendKey(friends, profiles, ['lira-ROOM-peer-new01', ANA])).toBe(ANA)
    expect(findFriendKey(friends, profiles, [BIA])).toBe('friend-bia')
    expect(findFriendKey(friends, profiles, ['lira-ROOM-peer-new02', undefined])).toBeUndefined()
    expect(findFriendKey(friends, profiles, ['Ana'])).toBeUndefined()
  })

  it('matches message participants by id, falling back to the name only without a user id', () => {
    const ana = { id: ANA, name: 'Ana' }
    expect(isSameParticipant(ana, ANA, 'whatever')).toBe(true)
    // Someone else who merely uses the same display name
    expect(isSameParticipant(ana, BIA, 'Ana')).toBe(false)
    // History saved before stable ids: only the name is comparable
    expect(isSameParticipant(ana, 'lira-ROOM-peer-old01', 'ana')).toBe(true)
    expect(isSameParticipant(ana, undefined, 'Ana')).toBe(true)
    expect(isSameParticipant(ana, undefined, 'Bia')).toBe(false)
  })
})
