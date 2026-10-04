import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FriendsPresenceService } from '../services/friendsPresenceService'
import { useGameStore } from '../store/useGameStore'
import { useChatStore, getLocalDmChannelId } from '../store/useChatStore'
import { buildChatPeople } from '../utils/chatPeople'
import { getChatPersonMenu } from '../utils/chatPersonMenu'
import { getRoomInviteState, readRoomInvite } from '../utils/roomInvite'
import { FriendProfile, Player } from '../types/game'

const ME = 'u-mmmmmmmmmmmmmmmmmmmm'
const BIA = 'u-bbbbbbbbbbbbbbbbbbbb'
const CAIO = 'u-cccccccccccccccccccc'

const service = FriendsPresenceService.getInstance()

/** Stands in for the P2P links to friends: who is linked and what was sent to them. */
function installFakeNetwork() {
  const linked = new Set<string>()
  const sent: Array<{ userId: string; packet: any }> = []
  const internals = service as any
  internals.network = {
    isLinked: (userId: string) => linked.has(userId),
    getLinkedUserIds: () => Array.from(linked),
    send: vi.fn((userId: string, packet: any) => {
      if (!linked.has(userId)) return false
      sent.push({ userId, packet })
      return true
    }),
    syncContacts: vi.fn(),
    refresh: vi.fn(),
    stop: vi.fn(),
  }
  internals.linkPresence.clear()
  internals.presenceSharedWith.clear()
  internals.recentReceipts.clear()
  internals.sharedSignature = ''

  return {
    messagesTo: (userId: string) =>
      sent.filter((s) => s.userId === userId && s.packet.t === 'dm').map((s) => s.packet.message),
    open: (userId: string) => {
      linked.add(userId)
      internals.handleLinkOpen(userId)
    },
    receive: (userId: string, packet: any) => internals.handleLinkPacket(userId, packet),
  }
}

const biaFriend: FriendProfile = { id: BIA, name: 'Bia', actualUserId: BIA, lastSeen: 1000 }

const inviteFrom = (from: string, senderName: string, roomInvite: unknown, id = 'inv-1') => ({
  t: 'dm',
  message: {
    id,
    senderId: from,
    senderName,
    channelId: 'whatever',
    recipientId: ME,
    content: '📨 Convite para o espaço "Escritório da Bia"',
    timestamp: Date.now(),
    roomInvite,
  },
})

const chat = () => useChatStore.getState()

// The friends section of the chat sidebar, as the drawer builds it.
const friendRow = () =>
  buildChatPeople({
    remotePlayers: Object.values(useGameStore.getState().remotePlayers),
    friends: useGameStore.getState().friends,
    friendProfiles: useGameStore.getState().friendProfiles,
    channels: chat().channels,
    activeChannelId: chat().activeChannelId,
    dmChannelIdFor: getLocalDmChannelId,
    getFriendPresence: (friend) => service.getFriendStatus(friend),
  }).friends[0]

describe('inviting a friend to the space I am in', () => {
  let net: ReturnType<typeof installFakeNetwork>

  beforeEach(() => {
    useGameStore.setState({
      localPlayer: {
        id: ME,
        gameId: ME,
        name: 'Alice',
        x: 0,
        y: 0,
        direction: 'down',
        isMoving: false,
        status: 'available',
      } as Player,
      friends: [],
      friendProfiles: {},
      remotePlayers: {},
      roomId: 'ROOM-1',
      roomName: 'Sala da Alice',
    })
    useChatStore.setState({
      channels: [{ id: 'general', name: 'general', type: 'general', unreadCount: 0 }],
      messages: [],
      activeChannelId: 'general',
      isChatOpen: false,
      lastReadByPeer: {},
    })
    net = installFakeNetwork()
    useGameStore.getState().addFriend(biaFriend)
  })

  it('offers the invite for a friend who is online somewhere else', () => {
    net.open(BIA)
    const row = friendRow()
    expect(row).toMatchObject({ kind: 'friend', name: 'Bia', inSpace: false, isOnline: true, contactId: BIA })
    const menu = getChatPersonMenu(row, { roomId: 'ROOM-1', requestPending: false })
    const invite = menu.find((i) => i.action === 'invite')
    expect(invite).toBeDefined()
    expect(invite?.disabled).toBeFalsy()
  })

  it('knows the space a friend is in, to follow them there', () => {
    net.open(BIA)
    net.receive(BIA, { t: 'presence', presence: { name: 'Bia', inRoom: true, roomCode: 'ROOM-42', roomName: 'Escritório da Bia' } })
    expect(friendRow().room).toEqual({ code: 'ROOM-42', name: 'Escritório da Bia' })
    const menu = getChatPersonMenu(friendRow(), { roomId: 'ROOM-1', requestPending: false })
    expect(menu.map((i) => i.action)).toContain('join')
  })

  it('has no space to follow a friend into while they are on the home screen', () => {
    net.open(BIA)
    net.receive(BIA, { t: 'presence', presence: { name: 'Bia', inRoom: false, roomCode: null } })
    expect(friendRow().room).toBeUndefined()
  })

  it('delivers the invite over the link to that friend', () => {
    net.open(BIA)
    expect(chat().sendRoomInvite({ id: BIA, name: 'Bia' })).toBe(true)

    const delivered = net.messagesTo(BIA)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({
      senderId: ME,
      recipientId: BIA,
      roomInvite: { roomCode: 'ROOM-1', roomName: 'Sala da Alice' },
    })
  })
})

describe('receiving an invite to a space', () => {
  let net: ReturnType<typeof installFakeNetwork>

  beforeEach(() => {
    useGameStore.setState({
      localPlayer: {
        id: ME,
        gameId: ME,
        name: 'Alice',
        x: 0,
        y: 0,
        direction: 'down',
        isMoving: false,
        status: 'available',
      } as Player,
      friends: [],
      friendProfiles: {},
      remotePlayers: {},
      roomId: null,
      roomName: '',
    })
    useChatStore.setState({
      channels: [{ id: 'general', name: 'general', type: 'general', unreadCount: 0 }],
      messages: [],
      activeChannelId: 'general',
      isChatOpen: false,
      lastReadByPeer: {},
    })
    net = installFakeNetwork()
    useGameStore.getState().addFriend(biaFriend)
    net.open(BIA)
  })

  it('keeps the space to join, in the conversation with that friend', () => {
    net.receive(BIA, inviteFrom(BIA, 'Bia', { roomCode: 'room-42', roomName: 'Escritório da Bia' }))

    expect(chat().messages).toHaveLength(1)
    expect(chat().messages[0]).toMatchObject({
      senderId: BIA,
      channelId: getLocalDmChannelId(BIA),
      roomInvite: { roomCode: 'ROOM-42', roomName: 'Escritório da Bia' },
    })
  })

  it('can be accepted while the friend is in that space', () => {
    net.receive(BIA, { t: 'presence', presence: { name: 'Bia', inRoom: true, roomCode: 'ROOM-42', roomName: 'Escritório da Bia' } })
    net.receive(BIA, inviteFrom(BIA, 'Bia', { roomCode: 'ROOM-42', roomName: 'Escritório da Bia' }))

    const invite = readRoomInvite(chat().messages[0].roomInvite)!
    const state = (inviterPresence: ReturnType<typeof service.getFriendStatus>) =>
      getRoomInviteState({ invite, isMine: false, currentRoomId: null, inviterPresence })

    expect(state(service.getFriendStatus(biaFriend))).toBe('open')

    net.receive(BIA, { t: 'presence', presence: { name: 'Bia', inRoom: false, roomCode: null } })
    expect(state(service.getFriendStatus(biaFriend))).toBe('closed')
  })

  it('carries only what an invite is made of', () => {
    net.receive(
      BIA,
      inviteFrom(BIA, 'Bia', { roomCode: 'ROOM-42', roomName: 'x'.repeat(300), script: '<img onerror=1>' })
    )
    const invite = chat().messages[0].roomInvite!
    expect(Object.keys(invite).sort()).toEqual(['roomCode', 'roomName'])
    expect(invite.roomName).toHaveLength(80)
  })

  it('is a plain message when the invite cannot be read', () => {
    net.receive(BIA, inviteFrom(BIA, 'Bia', { roomCode: '<script>', roomName: 'Sala' }, 'inv-bad'))
    net.receive(BIA, inviteFrom(BIA, 'Bia', 'ROOM-42', 'inv-text'))

    expect(chat().messages.map((m) => m.id)).toEqual(['inv-bad', 'inv-text'])
    expect(chat().messages.every((m) => m.roomInvite === undefined)).toBe(true)
  })

  it('is a plain message when it comes from someone who is not a friend', () => {
    net.open(CAIO)
    net.receive(CAIO, inviteFrom(CAIO, 'Caio', { roomCode: 'ROOM-66', roomName: 'Sala do Caio' }))

    expect(chat().messages).toHaveLength(1)
    expect(chat().messages[0]).toMatchObject({ senderId: CAIO, senderName: 'Caio' })
    expect(chat().messages[0].roomInvite).toBeUndefined()
  })

  it('cannot be sent in the name of a friend by someone else', () => {
    net.open(CAIO)
    net.receive(CAIO, inviteFrom(BIA, 'Bia', { roomCode: 'ROOM-66', roomName: 'Sala do Caio' }))
    expect(chat().messages).toEqual([])
  })
})
