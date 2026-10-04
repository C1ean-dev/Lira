import { describe, it, expect, beforeEach } from 'vitest'
import { buildChatPeople, openChatPerson } from '../utils/chatPeople'
import { useGameStore } from '../store/useGameStore'
import { useChatStore, getLocalDmChannelId } from '../store/useChatStore'
import { FriendsPresenceService } from '../services/friendsPresenceService'

const ME = 'u-aaaaaaaaaaaaaaaaaaaa'
const BOB = 'u-bbbbbbbbbbbbbbbbbbbb'
const CAROL = 'u-cccccccccccccccccccc'
const DAN = 'u-dddddddddddddddddddd'

const player = (id: string, gameId: string, name: string) =>
  ({ id, gameId, name, x: 0, y: 0, direction: 'down', isMoving: false, status: 'available' }) as any

// The chat sidebar's own wiring: stores, DM channel ids and live presence.
const people = () => {
  const game = useGameStore.getState()
  const chat = useChatStore.getState()
  return buildChatPeople({
    remotePlayers: Object.values(game.remotePlayers),
    friends: game.friends,
    friendProfiles: game.friendProfiles,
    channels: chat.channels,
    activeChannelId: chat.activeChannelId,
    dmChannelIdFor: getLocalDmChannelId,
    getFriendPresence: (friend) => FriendsPresenceService.getInstance().getFriendStatus(friend),
  })
}

const open = (name: string) => {
  const all = people()
  const row = [...all.friends, ...all.inSpace, ...all.conversations].find((p) => p.name === name)
  if (!row) throw new Error(`no row for ${name}`)
  const { setActiveChannel, openDirectMessage } = useChatStore.getState()
  openChatPerson(row, { setActiveChannel, openDirectMessage })
}

const leaveSpace = (connectionId: string) => {
  const remotePlayers = { ...useGameStore.getState().remotePlayers }
  delete remotePlayers[connectionId]
  useGameStore.setState({ remotePlayers })
}

const presence = (message: Record<string, unknown>) =>
  (FriendsPresenceService.getInstance() as any).handleIncomingMessage({ timestamp: Date.now(), ...message })

const names = (list: { name: string }[]) => list.map((p) => p.name)

describe('chat sidebar people, with the real stores', () => {
  beforeEach(() => {
    useGameStore.setState({
      localPlayer: { ...player('conn-me', ME, 'Me') },
      remotePlayers: {
        'conn-bob': player('conn-bob', BOB, 'Bob'),
        'conn-carol': player('conn-carol', CAROL, 'Carol'),
      },
      friends: [],
      friendProfiles: {},
      roomId: 'room-1',
      roomName: 'Sala',
    })
    useChatStore.setState({
      channels: [
        { id: 'general', name: 'general', type: 'general', unreadCount: 0 },
        { id: 'current-zone', name: 'zona-atual', type: 'zone', unreadCount: 0 },
      ],
      messages: [],
      activeChannelId: 'general',
      isChatOpen: true,
    })
    presence({ type: 'PRESENCE_OFFLINE', userId: DAN })
  })

  it('being in the space makes nobody a friend', () => {
    expect(people().friends).toEqual([])
    expect(names(people().inSpace)).toEqual(['Bob', 'Carol'])
  })

  it('moves a person to friends once the friendship exists, and back when it ends', () => {
    useGameStore.getState().addFriend({ id: BOB, name: 'Bob', actualUserId: BOB })
    expect(names(people().friends)).toEqual(['Bob'])
    expect(names(people().inSpace)).toEqual(['Carol'])

    useGameStore.getState().removeFriend(BOB)
    expect(people().friends).toEqual([])
    expect(names(people().inSpace)).toEqual(['Bob', 'Carol'])
  })

  it('opens the conversation of a row and finds it again', () => {
    open('Carol')
    expect(useChatStore.getState().activeChannelId).toBe(getLocalDmChannelId(CAROL))
    expect(people().inSpace.map((p) => [p.name, p.isCurrent])).toEqual([
      ['Bob', false],
      ['Carol', true],
    ])
    expect(people().conversations).toEqual([])
  })

  it('counts the unread messages of the person who sent them', () => {
    useChatStore.getState().addMessage({
      id: 'm1',
      senderId: BOB,
      senderName: 'Bob',
      channelId: 'dm-ignored',
      recipientId: ME,
      content: 'oi',
      timestamp: Date.now(),
    })
    expect(people().inSpace.map((p) => [p.name, p.unreadCount])).toEqual([
      ['Bob', 1],
      ['Carol', 0],
    ])
    expect(people().conversations).toEqual([])
  })

  it('shows a friend who is in another space as online there', () => {
    useGameStore.getState().addFriend({ id: DAN, name: 'Dan', actualUserId: DAN })
    expect(people().friends.map((p) => [p.name, p.inSpace, p.isOnline, p.status])).toEqual([
      ['Dan', false, false, 'offline'],
    ])

    presence({
      type: 'PRESENCE_HEARTBEAT',
      presence: { userId: DAN, name: 'Dan', status: 'busy', inRoom: true, roomCode: 'other', lastHeartbeat: Date.now() },
    })
    expect(people().friends.map((p) => [p.name, p.inSpace, p.isOnline, p.status])).toEqual([
      ['Dan', false, true, 'busy'],
    ])
    expect(names(people().inSpace)).toEqual(['Bob', 'Carol'])
  })

  it('starts a conversation with a friend who is elsewhere, addressed to their user id', () => {
    useGameStore.getState().addFriend({ id: DAN, name: 'Dan', actualUserId: DAN })
    open('Dan')

    const chat = useChatStore.getState()
    expect(chat.activeChannelId).toBe(getLocalDmChannelId(DAN))
    expect(chat.channels.find((c) => c.id === chat.activeChannelId)).toMatchObject({ type: 'dm', recipientId: DAN })
    expect(people().friends[0]).toMatchObject({ name: 'Dan', isCurrent: true, open: { kind: 'channel' } })
    expect(people().conversations).toEqual([])
  })

  it('keeps the conversation on the friend when they leave the space', () => {
    useGameStore.getState().addFriend({ id: BOB, name: 'Bob', actualUserId: BOB })
    open('Bob')
    leaveSpace('conn-bob')

    expect(people().friends).toHaveLength(1)
    expect(people().friends[0]).toMatchObject({
      name: 'Bob',
      inSpace: false,
      isCurrent: true,
      open: { kind: 'channel', channelId: getLocalDmChannelId(BOB) },
    })
    expect(people().conversations).toEqual([])
  })

  it('keeps the conversation with a non-friend who left under conversations', () => {
    open('Carol')
    leaveSpace('conn-carol')

    expect(names(people().inSpace)).toEqual(['Bob'])
    expect(people().friends).toEqual([])
    expect(people().conversations).toHaveLength(1)
    expect(people().conversations[0]).toMatchObject({
      name: 'Carol',
      isOnline: false,
      open: { kind: 'channel', channelId: getLocalDmChannelId(CAROL) },
    })
  })
})
