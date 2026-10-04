import { describe, it, expect, vi } from 'vitest'
import { buildChatPeople, openChatPerson, ChatPerson } from '../utils/chatPeople'
import { Channel } from '../types/chat'
import { FriendProfile } from '../types/game'

const ME = 'u-aaaaaaaaaaaaaaaaaaaa'
const BOB = 'u-bbbbbbbbbbbbbbbbbbbb'
const CAROL = 'u-cccccccccccccccccccc'
const DAN = 'u-dddddddddddddddddddd'

const dmChannelIdFor = (id: string) => `dm-${[ME, id].sort().join('-')}`

const bob = { id: 'conn-bob', gameId: BOB, name: 'Bob', avatar: { shirtColor: '#123456' } as any }
const carol = { id: 'conn-carol', gameId: CAROL, name: 'Carol' }

const profile = (id: string, name: string, extra: Partial<FriendProfile> = {}): FriendProfile => ({
  id,
  name,
  ...extra,
})

const dm = (id: string, name: string, recipientId?: string, unreadCount = 0): Channel => ({
  id,
  name,
  type: 'dm',
  unreadCount,
  recipientId,
})

const build = (input: Partial<Parameters<typeof buildChatPeople>[0]> = {}) =>
  buildChatPeople({
    remotePlayers: [],
    friends: [],
    friendProfiles: {},
    channels: [],
    activeChannelId: 'general',
    dmChannelIdFor,
    getFriendPresence: () => ({ isOnline: false }),
    ...input,
  })

const names = (list: ChatPerson[]) => list.map((p) => p.name)

describe('buildChatPeople', () => {
  describe('friends apart from who is merely in the space', () => {
    it('does not list the people in the space as friends', () => {
      const people = build({ remotePlayers: [bob, carol] })
      expect(people.friends).toEqual([])
      expect(names(people.inSpace)).toEqual(['Bob', 'Carol'])
    })

    it('lists a friend who is in the space under friends only', () => {
      const people = build({
        remotePlayers: [bob, carol],
        friends: [BOB],
        friendProfiles: { [BOB]: profile(BOB, 'Bob', { actualUserId: BOB }) },
      })
      expect(names(people.friends)).toEqual(['Bob'])
      expect(names(people.inSpace)).toEqual(['Carol'])
    })

    it('recognises a friend saved under an old connection id', () => {
      const people = build({
        remotePlayers: [bob],
        friends: ['conn-old'],
        friendProfiles: { 'conn-old': profile('conn-old', 'Bob', { gameId: BOB }) },
      })
      expect(names(people.friends)).toEqual(['Bob'])
      expect(people.inSpace).toEqual([])
    })

    it("does not take someone using a friend's name for that friend", () => {
      const people = build({
        remotePlayers: [bob],
        friends: [DAN],
        friendProfiles: { [DAN]: profile(DAN, 'Bob', { actualUserId: DAN }) },
      })
      expect(people.inSpace.map((p) => p.open)).toEqual([{ kind: 'user', id: BOB, name: 'Bob' }])
      expect(people.friends.map((p) => [p.name, p.inSpace])).toEqual([['Bob', false]])
    })

    it('shows everyone in the space as online', () => {
      const people = build({
        remotePlayers: [bob, carol],
        friends: [BOB],
        friendProfiles: { [BOB]: profile(BOB, 'Bob') },
      })
      for (const person of [...people.friends, ...people.inSpace]) {
        expect(person).toMatchObject({ inSpace: true, isOnline: true, status: 'available' })
      }
    })

    it("uses the room player's picture for someone in the space", () => {
      const people = build({
        remotePlayers: [bob],
        friends: [BOB],
        friendProfiles: { [BOB]: profile(BOB, 'Bobby') },
      })
      expect(people.friends[0].name).toBe('Bob')
      expect(people.friends[0].avatarSource).toBe(bob)
    })
  })

  describe('friends who are not in the space', () => {
    const friendProfiles = {
      [BOB]: profile(BOB, 'Bob'),
      [CAROL]: profile(CAROL, 'Carol'),
      [DAN]: profile(DAN, 'Dan'),
    }

    it('lists every friend, with their presence', () => {
      const people = build({
        friends: [BOB, CAROL],
        friendProfiles,
        getFriendPresence: (friend) =>
          friend.id === CAROL ? { isOnline: true, status: 'busy' } : { isOnline: false, status: 'away' },
      })
      expect(people.friends.map((p) => [p.name, p.inSpace, p.isOnline, p.status])).toEqual([
        ['Carol', false, true, 'busy'],
        ['Bob', false, false, 'offline'],
      ])
      expect(people.inSpace).toEqual([])
    })

    it('is "available" when online without a status', () => {
      const people = build({
        friends: [BOB],
        friendProfiles,
        getFriendPresence: () => ({ isOnline: true }),
      })
      expect(people.friends[0].status).toBe('available')
    })

    it('puts friends in the space first, then online elsewhere, then offline', () => {
      const people = build({
        remotePlayers: [bob],
        friends: [DAN, CAROL, BOB],
        friendProfiles,
        getFriendPresence: (friend) => ({ isOnline: friend.id === CAROL }),
      })
      expect(names(people.friends)).toEqual(['Bob', 'Carol', 'Dan'])
    })

    it('keeps the saved order inside a group', () => {
      const people = build({ friends: [CAROL, DAN, BOB], friendProfiles })
      expect(names(people.friends)).toEqual(['Carol', 'Dan', 'Bob'])
    })

    it('still lists a friend whose profile was never saved', () => {
      const people = build({ friends: [BOB] })
      expect(people.friends).toHaveLength(1)
      expect(people.friends[0]).toMatchObject({
        name: 'Amigo',
        open: { kind: 'user', id: BOB, name: 'Amigo' },
      })
    })

    it('shows the saved profile picture', () => {
      const saved = profile(BOB, 'Bob', { profilePicture: 'data:image/png;base64,AAAA' })
      const people = build({ friends: [BOB], friendProfiles: { [BOB]: saved } })
      expect(people.friends[0].avatarSource).toBe(saved)
    })
  })

  describe('what opening a row does', () => {
    it('addresses someone in the space by their stable user id', () => {
      expect(build({ remotePlayers: [bob] }).inSpace[0].open).toEqual({ kind: 'user', id: BOB, name: 'Bob' })
    })

    it('falls back to the connection id when the player has no user id', () => {
      const guest = { id: 'conn-guest', name: 'Guest' }
      expect(build({ remotePlayers: [guest] }).inSpace[0].open).toEqual({
        kind: 'user',
        id: 'conn-guest',
        name: 'Guest',
      })
    })

    it('addresses a friend in the space the same way, even with a saved conversation', () => {
      const people = build({
        remotePlayers: [bob],
        friends: [BOB],
        friendProfiles: { [BOB]: profile(BOB, 'Bob') },
        channels: [dm(dmChannelIdFor(BOB), 'Bob', BOB)],
      })
      expect(people.friends[0].open).toEqual({ kind: 'user', id: BOB, name: 'Bob' })
    })

    it('reopens the saved conversation with a friend who is elsewhere', () => {
      const channel = dm(dmChannelIdFor(BOB), 'Bob', BOB)
      const people = build({
        friends: [BOB],
        friendProfiles: { [BOB]: profile(BOB, 'Bob') },
        channels: [channel],
      })
      expect(people.friends[0].open).toEqual({ kind: 'channel', channelId: channel.id })
    })

    it('starts a conversation with a friend who is elsewhere, by stable user id', () => {
      const people = build({
        friends: ['conn-old'],
        friendProfiles: { 'conn-old': profile('conn-old', 'Bob', { gameId: BOB }) },
      })
      expect(people.friends[0].open).toEqual({ kind: 'user', id: BOB, name: 'Bob' })
    })

    it('uses the friends-list key for a friend never linked to a user', () => {
      const people = build({
        friends: ['friend-bob'],
        friendProfiles: { 'friend-bob': profile('friend-bob', 'Bob') },
      })
      expect(people.friends[0].open).toEqual({ kind: 'user', id: 'friend-bob', name: 'Bob' })
    })
  })

  describe('unread messages and the open conversation', () => {
    it('come from the conversation with someone in the space', () => {
      const channel = dm(dmChannelIdFor(BOB), 'Bob', BOB, 3)
      const people = build({ remotePlayers: [bob], channels: [channel], activeChannelId: channel.id })
      expect(people.inSpace[0]).toMatchObject({ unreadCount: 3, isCurrent: true })
    })

    it('find a conversation saved under the connection id', () => {
      const channel = dm('dm-conn-bob-conn-me', 'Bob', 'conn-bob', 2)
      const people = build({ remotePlayers: [bob], channels: [channel], activeChannelId: channel.id })
      expect(people.inSpace[0]).toMatchObject({ unreadCount: 2, isCurrent: true })
    })

    it('find a conversation that only carries the connection id in its own id', () => {
      const channel = dm('dm-conn-bob-conn-me', 'Bob', undefined, 4)
      const people = build({ remotePlayers: [bob], channels: [channel] })
      expect(people.inSpace[0].unreadCount).toBe(4)
      expect(people.conversations).toEqual([])
    })

    it('find a conversation addressed to the user id under another channel id', () => {
      const channel = dm('dm-saved-elsewhere', 'Bob', BOB, 6)
      const people = build({ remotePlayers: [bob], channels: [channel], activeChannelId: channel.id })
      expect(people.inSpace[0]).toMatchObject({ unreadCount: 6, isCurrent: true })
      expect(people.conversations).toEqual([])
    })

    it('find a conversation by its channel id alone', () => {
      const channel = dm(dmChannelIdFor(BOB), 'Bob', 'conn-bob-earlier', 8)
      const people = build({ remotePlayers: [bob], channels: [channel] })
      expect(people.inSpace[0].unreadCount).toBe(8)
      expect(people.conversations).toEqual([])
    })

    it('mark the row when the open conversation is not the first one saved for that person', () => {
      const older = dm('dm-conn-bob-conn-me', 'Bob', 'conn-bob')
      const current = dm(dmChannelIdFor(BOB), 'Bob', BOB)
      const people = build({ remotePlayers: [bob], channels: [older, current], activeChannelId: current.id })
      expect(people.inSpace[0].isCurrent).toBe(true)
    })

    it('are empty for someone without a conversation', () => {
      const people = build({ remotePlayers: [bob, carol], channels: [dm(dmChannelIdFor(CAROL), 'Carol', CAROL, 5)] })
      expect(people.inSpace[0]).toMatchObject({ name: 'Bob', unreadCount: 0, isCurrent: false })
      expect(people.inSpace[1]).toMatchObject({ name: 'Carol', unreadCount: 5 })
    })

    it('do not mark a row while another channel is open', () => {
      const channel = dm(dmChannelIdFor(BOB), 'Bob', BOB)
      const people = build({ remotePlayers: [bob], channels: [channel], activeChannelId: 'general' })
      expect(people.inSpace[0].isCurrent).toBe(false)
    })

    it('come from the conversation of a friend who is elsewhere', () => {
      const channel = dm(dmChannelIdFor(BOB), 'Bob', BOB, 7)
      const friendProfiles = { [BOB]: profile(BOB, 'Bob'), [CAROL]: profile(CAROL, 'Carol') }
      const people = build({
        friends: [BOB, CAROL],
        friendProfiles,
        channels: [channel],
        activeChannelId: channel.id,
      })
      expect(people.friends[0]).toMatchObject({ name: 'Bob', unreadCount: 7, isCurrent: true })
      expect(people.friends[1]).toMatchObject({ name: 'Carol', unreadCount: 0, isCurrent: false })
    })

    it('find the conversation of a friend saved under an old connection id', () => {
      const channel = dm('dm-conn-me-conn-old', 'Roberto', 'conn-old', 1)
      const people = build({
        friends: ['conn-old'],
        friendProfiles: { 'conn-old': profile('conn-old', 'Bob', { gameId: BOB }) },
        channels: [channel],
      })
      expect(people.friends[0]).toMatchObject({ unreadCount: 1, open: { kind: 'channel', channelId: channel.id } })
      expect(people.conversations).toEqual([])
    })

    it("prefer the conversation under the friend's user id to an older one", () => {
      const older = dm('dm-conn-me-conn-old', 'Bob', 'conn-old', 1)
      const current = dm(dmChannelIdFor(BOB), 'Bob', BOB, 2)
      const people = build({
        friends: ['conn-old'],
        friendProfiles: { 'conn-old': profile('conn-old', 'Bob', { gameId: BOB }) },
        channels: [older, current],
      })
      expect(people.friends[0]).toMatchObject({ unreadCount: 2, open: { kind: 'channel', channelId: current.id } })
      // The older history stays reachable on its own row.
      expect(people.conversations.map((p) => p.open)).toEqual([{ kind: 'channel', channelId: older.id }])
    })
  })

  describe('conversations with people who are neither', () => {
    it('keep the history with someone who left the space', () => {
      const channel = dm(dmChannelIdFor(DAN), 'Dan', DAN, 1)
      const people = build({ channels: [channel], activeChannelId: channel.id })
      expect(people.conversations).toEqual([
        {
          key: expect.any(String),
          kind: 'conversation',
          contactId: DAN,
          channelId: channel.id,
          name: 'Dan',
          inSpace: false,
          isOnline: false,
          status: 'offline',
          unreadCount: 1,
          isCurrent: true,
          open: { kind: 'channel', channelId: channel.id },
        },
      ])
      expect(people.friends).toEqual([])
      expect(people.inSpace).toEqual([])
    })

    it('do not repeat the conversation of someone in the space', () => {
      const people = build({
        remotePlayers: [bob],
        channels: [dm(dmChannelIdFor(BOB), 'Bob', BOB), dm('dm-conn-bob-conn-me', 'Bob', 'conn-bob')],
      })
      expect(people.conversations).toEqual([])
    })

    it('do not repeat the conversation of a friend', () => {
      const people = build({
        friends: [BOB],
        friendProfiles: { [BOB]: profile(BOB, 'Bob') },
        channels: [dm(dmChannelIdFor(BOB), 'Bob', BOB)],
      })
      expect(people.conversations).toEqual([])
    })

    it('ignore the channels of the room', () => {
      const people = build({
        channels: [
          { id: 'general', name: 'general', type: 'general', unreadCount: 2 },
          { id: 'current-zone', name: 'zona-atual', type: 'zone', unreadCount: 0 },
        ],
      })
      expect(people.conversations).toEqual([])
    })

    it('tie a conversation saved before stable ids to the friend with that name', () => {
      const channel = dm('dm-conn-me-conn-gone', 'bob', 'conn-gone', 2)
      const people = build({
        friends: [BOB],
        friendProfiles: { [BOB]: profile(BOB, 'Bob') },
        channels: [channel],
      })
      expect(people.friends[0]).toMatchObject({ unreadCount: 2, open: { kind: 'channel', channelId: channel.id } })
      expect(people.conversations).toEqual([])
    })

    it('never tie a conversation with a stable user id to a friend by name', () => {
      const channel = dm(dmChannelIdFor(DAN), 'Bob', DAN, 2)
      const people = build({
        friends: [BOB],
        friendProfiles: { [BOB]: profile(BOB, 'Bob') },
        channels: [channel],
      })
      expect(people.friends[0]).toMatchObject({ unreadCount: 0, open: { kind: 'user', id: BOB, name: 'Bob' } })
      expect(people.conversations.map((p) => p.open)).toEqual([{ kind: 'channel', channelId: channel.id }])
    })

    it('give one conversation to one friend only', () => {
      const channel = dm('dm-conn-me-conn-gone', 'Bob', 'conn-gone')
      const people = build({
        friends: ['friend-bob', 'friend-bob-2'],
        friendProfiles: {
          'friend-bob': profile('friend-bob', 'Bob'),
          'friend-bob-2': profile('friend-bob-2', 'Bob'),
        },
        channels: [channel],
      })
      expect(people.friends.map((p) => p.open.kind)).toEqual(['channel', 'user'])
    })
  })

  describe('what a row knows about its person, for the right-click menu', () => {
    it('knows the player, the user and the conversation of someone in the space', () => {
      const channel = dm(dmChannelIdFor(BOB), 'Bob', BOB)
      const row = build({ remotePlayers: [bob], channels: [channel] }).inSpace[0]
      expect(row).toMatchObject({ kind: 'space', playerId: 'conn-bob', contactId: BOB, channelId: channel.id })
      expect(row.friendKey).toBeUndefined()
      expect(row.room).toBeUndefined()
    })

    it('addresses a player without a user id by the connection id', () => {
      const guest = { id: 'conn-guest', name: 'Guest' }
      expect(build({ remotePlayers: [guest] }).inSpace[0]).toMatchObject({ contactId: 'conn-guest' })
    })

    it('knows which entry of the friends list a friend in the space is', () => {
      const row = build({
        remotePlayers: [bob],
        friends: ['conn-old'],
        friendProfiles: { 'conn-old': profile('conn-old', 'Bob', { gameId: BOB }) },
      }).friends[0]
      expect(row).toMatchObject({ kind: 'friend', friendKey: 'conn-old', playerId: 'conn-bob', contactId: BOB })
    })

    it('knows the user and the list entry of a friend who is elsewhere', () => {
      const row = build({
        friends: ['conn-old'],
        friendProfiles: { 'conn-old': profile('conn-old', 'Bob', { gameId: BOB }) },
      }).friends[0]
      expect(row).toMatchObject({ kind: 'friend', friendKey: 'conn-old', contactId: BOB })
      expect(row.playerId).toBeUndefined()
    })

    it('knows the saved conversation of a friend who is elsewhere', () => {
      const channel = dm(dmChannelIdFor(BOB), 'Bob', BOB)
      const friendProfiles = { [BOB]: profile(BOB, 'Bob'), [CAROL]: profile(CAROL, 'Carol') }
      const rows = build({ friends: [BOB, CAROL], friendProfiles, channels: [channel] }).friends
      expect(rows[0].channelId).toBe(channel.id)
      expect(rows[1].channelId).toBeUndefined()
    })

    it('knows the space a friend is in', () => {
      const row = build({
        friends: [BOB],
        friendProfiles: { [BOB]: profile(BOB, 'Bob') },
        getFriendPresence: () => ({ isOnline: true, inRoom: true, roomCode: 'ROOM-2', roomName: 'Outro' }),
      }).friends[0]
      expect(row.room).toEqual({ code: 'ROOM-2', name: 'Outro' })
    })

    it('has no space for a friend on the home screen, offline or without a known room', () => {
      const presences = [
        { isOnline: true, inRoom: false, roomCode: 'ROOM-2' },
        { isOnline: false, inRoom: true, roomCode: 'ROOM-2' },
        { isOnline: true, inRoom: true, roomCode: null },
        { isOnline: true },
      ]
      for (const presence of presences) {
        const row = build({
          friends: [BOB],
          friendProfiles: { [BOB]: profile(BOB, 'Bob') },
          getFriendPresence: () => presence,
        }).friends[0]
        expect(row.room).toBeUndefined()
      }
    })

    it('knows who a saved conversation was with, when that was recorded', () => {
      const known = dm(dmChannelIdFor(DAN), 'Dan', DAN)
      const unknown = dm('dm-x-y', 'Eve')
      const rows = build({ channels: [known, unknown] }).conversations
      expect(rows[0]).toMatchObject({ kind: 'conversation', contactId: DAN, channelId: known.id })
      expect(rows[1]).toMatchObject({ kind: 'conversation', channelId: unknown.id })
      expect(rows[1].contactId).toBeUndefined()
    })
  })

  it('gives every row a distinct key', () => {
    const people = build({
      remotePlayers: [bob, carol],
      friends: [BOB, DAN],
      friendProfiles: { [BOB]: profile(BOB, 'Bob'), [DAN]: profile(DAN, 'Dan') },
      channels: [dm(dmChannelIdFor(BOB), 'Bob', BOB), dm('dm-x-y', 'Eve', 'conn-eve')],
    })
    const keys = [...people.friends, ...people.inSpace, ...people.conversations].map((p) => p.key)
    expect(keys).toHaveLength(4)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('openChatPerson', () => {
  const row = (open: ChatPerson['open']): ChatPerson => ({
    key: 'k',
    kind: 'conversation',
    name: 'Bob',
    inSpace: false,
    isOnline: false,
    status: 'offline',
    unreadCount: 0,
    isCurrent: false,
    open,
  })

  it('activates an existing conversation', () => {
    const actions = { setActiveChannel: vi.fn(), openDirectMessage: vi.fn() }
    openChatPerson(row({ kind: 'channel', channelId: 'dm-a-b' }), actions)
    expect(actions.setActiveChannel).toHaveBeenCalledWith('dm-a-b')
    expect(actions.openDirectMessage).not.toHaveBeenCalled()
  })

  it('starts a direct message with a user', () => {
    const actions = { setActiveChannel: vi.fn(), openDirectMessage: vi.fn() }
    openChatPerson(row({ kind: 'user', id: BOB, name: 'Bob' }), actions)
    expect(actions.openDirectMessage).toHaveBeenCalledWith({ id: BOB, name: 'Bob' })
    expect(actions.setActiveChannel).not.toHaveBeenCalled()
  })
})
