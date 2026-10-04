import { describe, it, expect } from 'vitest'
import { getChatUserFriendState, resolveChatUserTarget } from '../utils/chatUserActions'

const ME = 'u-aaaaaaaaaaaaaaaaaaaa'
const BOB = 'u-bbbbbbbbbbbbbbbbbbbb'
const CAROL = 'u-cccccccccccccccccccc'
const avatar = { shirtColor: '#123456' } as any

const local = { id: 'conn-me', gameId: ME, name: 'Me' }
const remotePlayers = {
  'conn-bob': { id: 'conn-bob', gameId: BOB, name: 'Bob', avatar },
} as any

const base = {
  localPlayer: local,
  remotePlayers,
  friends: [] as string[],
  friendProfiles: {} as Record<string, any>,
  getRequestStatus: () => null as { status: string } | null,
}

describe('resolveChatUserTarget', () => {
  it('resolves a room sender to the stable user id and avatar', () => {
    expect(resolveChatUserTarget(remotePlayers, 'conn-bob', 'Bob')).toEqual({
      id: BOB,
      name: 'Bob',
      avatar,
    })
  })

  it('finds the sender by stable user id too', () => {
    expect(resolveChatUserTarget(remotePlayers, BOB, 'Bob').id).toBe(BOB)
  })

  it('keeps the sender id when the player is not in the room anymore', () => {
    expect(resolveChatUserTarget({}, CAROL, 'Carol')).toEqual({
      id: CAROL,
      name: 'Carol',
      avatar: undefined,
    })
  })
})

describe('getChatUserFriendState', () => {
  it('is "self" for my own messages, by connection id or user id', () => {
    expect(getChatUserFriendState({ ...base, senderId: 'conn-me', senderName: 'Me' }).state).toBe('self')
    expect(getChatUserFriendState({ ...base, senderId: ME, senderName: 'Me' }).state).toBe('self')
  })

  it('is "can-add" for a stranger', () => {
    const result = getChatUserFriendState({ ...base, senderId: 'conn-bob', senderName: 'Bob' })
    expect(result.state).toBe('can-add')
    expect(result.target.id).toBe(BOB)
  })

  it('is "friend" when the stable user id is in the friends list', () => {
    const result = getChatUserFriendState({
      ...base,
      friends: [BOB],
      senderId: 'conn-bob',
      senderName: 'Bob',
    })
    expect(result.state).toBe('friend')
    expect(result.friendKey).toBe(BOB)
  })

  it('is "friend" when the friend was saved under an old connection id', () => {
    const result = getChatUserFriendState({
      ...base,
      friends: ['conn-bob'],
      friendProfiles: { 'conn-bob': { id: 'conn-bob', name: 'Bob', gameId: BOB } },
      senderId: 'conn-bob',
      senderName: 'Bob',
    })
    expect(result.state).toBe('friend')
    expect(result.friendKey).toBe('conn-bob')
  })

  it('does not treat someone with the same name as a friend', () => {
    const result = getChatUserFriendState({
      ...base,
      friends: [CAROL],
      friendProfiles: { [CAROL]: { id: CAROL, name: 'Bob', actualUserId: CAROL } },
      senderId: 'conn-bob',
      senderName: 'Bob',
    })
    expect(result.state).toBe('can-add')
  })

  it('is "pending" while a request to or from them is waiting', () => {
    const result = getChatUserFriendState({
      ...base,
      getRequestStatus: (key: string) => (key === BOB ? { status: 'pending' } : null),
      senderId: 'conn-bob',
      senderName: 'Bob',
    })
    expect(result.state).toBe('pending')
  })

  it('finds a pending request recorded only by name', () => {
    const result = getChatUserFriendState({
      ...base,
      getRequestStatus: (key: string) => (key === 'Bob' ? { status: 'pending' } : null),
      senderId: 'conn-bob',
      senderName: 'Bob',
    })
    expect(result.state).toBe('pending')
  })

  it('allows adding again after a declined request', () => {
    const result = getChatUserFriendState({
      ...base,
      getRequestStatus: () => ({ status: 'declined' }),
      senderId: 'conn-bob',
      senderName: 'Bob',
    })
    expect(result.state).toBe('can-add')
  })
})
