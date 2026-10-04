import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FriendsPresenceService } from '../services/friendsPresenceService'
import { useGameStore } from '../store/useGameStore'
import { useChatStore, getLocalDmChannelId } from '../store/useChatStore'
import { processNetworkMessage } from '../p2p/messageHandlers'
import { ChatMessage } from '../types/chat'
import { FriendProfile, Player } from '../types/game'

const ME = 'u-mmmmmmmmmmmmmmmmmmmm'
const BIA = 'u-bbbbbbbbbbbbbbbbbbbb'
const CAIO = 'u-cccccccccccccccccccc'

const service = FriendsPresenceService.getInstance()

/** Stands in for the P2P transport: which users are linked and what was sent to them. */
function installFakeNetwork() {
  const linked = new Set<string>()
  const sent: Array<{ userId: string; packet: any }> = []
  const network = {
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
  const internals = service as any
  internals.network = network
  internals.linkPresence.clear()
  internals.presenceSharedWith.clear()
  internals.recentReceipts.clear()
  internals.sharedSignature = ''

  return {
    network,
    sent,
    packetsTo: (userId: string, type: string) =>
      sent.filter((s) => s.userId === userId && s.packet.t === type).map((s) => s.packet),
    /** The friend's app came online and a link opened. */
    open: (userId: string) => {
      linked.add(userId)
      internals.handleLinkOpen(userId)
    },
    close: (userId: string) => {
      linked.delete(userId)
      internals.handleLinkClose(userId)
    },
    receive: (userId: string, packet: any) => internals.handleLinkPacket(userId, packet),
    contacts: (): string[] => internals.collectContacts(),
    heartbeat: () => service.sendHeartbeat(),
  }
}

const biaFriend: FriendProfile = { id: BIA, name: 'Bia', actualUserId: BIA, lastSeen: 1000 }

const dmFromMe = (id: string, to: string, timestamp = Date.now()): ChatMessage => ({
  id,
  senderId: ME,
  senderName: 'Alice',
  channelId: getLocalDmChannelId(to),
  recipientId: to,
  recipientName: 'Bia',
  content: 'Oi!',
  timestamp,
  status: 'sent',
})

const dmToMe = (id: string, from: string, senderName: string, content = 'E aí!'): ChatMessage => ({
  id,
  senderId: from,
  senderName,
  channelId: `dm-${[ME, from].sort().join('-')}`,
  recipientId: ME,
  recipientName: 'Alice',
  content,
  timestamp: Date.now(),
  status: 'sent',
})

describe('Friends outside the same space (home screen / different rooms)', () => {
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
        statusText: 'Disponível',
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
  })

  describe('presence', () => {
    it('shows a friend online on the home screen as soon as their app is linked', () => {
      useGameStore.getState().addFriend(biaFriend)
      expect(service.getFriendStatus(biaFriend).isOnline).toBe(false)

      net.open(BIA)

      const status = service.getFriendStatus(biaFriend)
      expect(status.isOnline).toBe(true)
      expect(status.inRoom).toBe(false)
    })

    it('shows the space a friend is in, so it can be joined from the home screen', () => {
      useGameStore.getState().addFriend(biaFriend)
      net.open(BIA)
      net.receive(BIA, {
        t: 'presence',
        presence: {
          userId: BIA,
          name: 'Bia',
          status: 'busy',
          statusText: 'Em reunião',
          inRoom: true,
          roomCode: 'ROOM-42',
          roomName: 'Escritório da Bia',
        },
      })

      const status = service.getFriendStatus(biaFriend)
      expect(status).toMatchObject({
        isOnline: true,
        status: 'busy',
        statusText: 'Em reunião',
        inRoom: true,
        roomCode: 'ROOM-42',
        roomName: 'Escritório da Bia',
      })
      // The saved profile keeps the last known room for when she goes offline
      expect(useGameStore.getState().friendProfiles[BIA].lastRoomName).toBe('Escritório da Bia')
    })

    it('notifies the friends list when a friend comes online or leaves', () => {
      useGameStore.getState().addFriend(biaFriend)
      const listener = vi.fn()
      const unsubscribe = service.subscribe(listener)
      listener.mockClear()

      net.open(BIA)
      expect(listener).toHaveBeenCalledTimes(1)
      net.close(BIA)
      expect(listener).toHaveBeenCalledTimes(2)
      unsubscribe()
    })

    it('marks the friend offline and records when they were last seen once the link closes', () => {
      useGameStore.getState().addFriend(biaFriend)
      net.open(BIA)
      net.receive(BIA, { t: 'presence', presence: { name: 'Bia', inRoom: true, roomCode: 'ROOM-42' } })

      net.close(BIA)

      const status = service.getFriendStatus(useGameStore.getState().friendProfiles[BIA])
      expect(status.isOnline).toBe(false)
      expect(useGameStore.getState().friendProfiles[BIA].lastSeen).toBeGreaterThan(1000)
    })

    it('takes the identity from the link, not from what the packet claims', () => {
      useGameStore.getState().addFriend(biaFriend)
      useGameStore.getState().addFriend({ id: CAIO, name: 'Caio', actualUserId: CAIO, lastSeen: 1 })

      // CAIO is linked and claims to be BIA
      net.open(CAIO)
      net.receive(CAIO, { t: 'presence', presence: { userId: BIA, name: 'Bia', inRoom: false } })

      expect(service.getFriendStatus(biaFriend).isOnline).toBe(false)
      expect(useGameStore.getState().friendProfiles[BIA].name).toBe('Bia')
      expect(useGameStore.getState().friendProfiles[CAIO].name).toBe('Bia')
    })

    it('still recognises a friend inside the same space by their stable id', () => {
      useGameStore.getState().addFriend(biaFriend)
      useGameStore.setState({
        roomId: 'ROOM-7',
        roomName: 'Sala 7',
        remotePlayers: {
          // New connection id on every join; the gameId is what stays the same
          'lira-ROOM-7-peer-zz9zz': { id: 'lira-ROOM-7-peer-zz9zz', gameId: BIA, name: 'Bia #2', status: 'focusing' } as Player,
        },
      })

      const status = service.getFriendStatus(biaFriend)
      expect(status).toMatchObject({ isOnline: true, inRoom: true, roomCode: 'ROOM-7', status: 'focusing' })
    })

    it('does not take a stranger for a friend because of the same name', () => {
      useGameStore.getState().addFriend(biaFriend)
      useGameStore.setState({
        roomId: 'ROOM-7',
        remotePlayers: {
          'lira-ROOM-7-peer-aa1aa': { id: 'lira-ROOM-7-peer-aa1aa', gameId: CAIO, name: 'Bia' } as Player,
        },
      })
      expect(service.getFriendStatus(biaFriend).isOnline).toBe(false)
    })

    it('shares our status and current space with friends only', async () => {
      useGameStore.getState().addFriend(biaFriend)
      useGameStore.setState({ roomId: 'ROOM-9', roomName: 'Minha Sala' })

      net.open(BIA)
      net.open(CAIO) // linked (e.g. sent us a friend request) but not a friend

      const [presence] = net.packetsTo(BIA, 'presence')
      expect(presence.presence).toMatchObject({
        userId: ME,
        name: 'Alice',
        inRoom: true,
        roomCode: 'ROOM-9',
        roomName: 'Minha Sala',
      })
      expect(net.packetsTo(CAIO, 'presence')).toHaveLength(0)

      await net.heartbeat()
      expect(net.packetsTo(CAIO, 'presence')).toHaveLength(0)
    })

    it('announces no room while we are on the home screen', () => {
      useGameStore.getState().addFriend(biaFriend)
      // What the store holds after leaving a room: no code, but a default name
      useGameStore.setState({ roomId: '', roomName: 'Espaço de Alice' })
      net.open(BIA)
      expect(net.packetsTo(BIA, 'presence')[0].presence).toMatchObject({ inRoom: false, roomName: null })
    })

    it('announces our stable id even while inside a room under a connection id', async () => {
      useGameStore.getState().addFriend(biaFriend)
      useGameStore.getState().setLocalPlayer({ id: 'lira-ROOM-9-host', gameId: ME })
      net.open(BIA)
      expect(net.packetsTo(BIA, 'presence')[0].presence.userId).toBe(ME)
    })

    it('re-sends our presence only when it changes', async () => {
      useGameStore.getState().addFriend(biaFriend)
      net.open(BIA)
      expect(net.packetsTo(BIA, 'presence')).toHaveLength(1)

      await net.heartbeat()
      await net.heartbeat()
      // First heartbeat establishes the baseline; nothing changed afterwards
      const baseline = net.packetsTo(BIA, 'presence').length
      await net.heartbeat()
      expect(net.packetsTo(BIA, 'presence')).toHaveLength(baseline)

      useGameStore.getState().setLocalStatus('busy', 'Em reunião')
      await net.heartbeat()
      const packets = net.packetsTo(BIA, 'presence')
      expect(packets).toHaveLength(baseline + 1)
      expect(packets[packets.length - 1].presence).toMatchObject({ status: 'busy', statusText: 'Em reunião' })
    })

    it('starts sharing with someone who becomes a friend while linked, and stops when unfriended', async () => {
      net.open(BIA)
      expect(net.packetsTo(BIA, 'presence')).toHaveLength(0)

      useGameStore.getState().addFriend(biaFriend)
      await net.heartbeat()
      expect(net.packetsTo(BIA, 'presence')).toHaveLength(1)
      expect(net.packetsTo(BIA, 'presence')[0].presence).toMatchObject({ userId: ME })

      useGameStore.getState().removeFriend(BIA)
      await net.heartbeat()
      const packets = net.packetsTo(BIA, 'presence')
      expect(packets[packets.length - 1].presence).toBeNull()
    })

    it('uses what a linked person already announced once they become a friend', async () => {
      net.open(BIA)
      net.receive(BIA, {
        t: 'presence',
        presence: { name: 'Bia Souza', profilePicture: 'data:image/png;base64,CCCC', inRoom: true, roomCode: 'ROOM-1', roomName: 'Sala 1' },
      })

      useGameStore.getState().addFriend(biaFriend)
      await net.heartbeat()

      const profile = useGameStore.getState().friendProfiles[BIA]
      expect(profile).toMatchObject({ name: 'Bia Souza', profilePicture: 'data:image/png;base64,CCCC', lastRoomName: 'Sala 1' })
      expect(service.getFriendStatus(profile)).toMatchObject({ isOnline: true, inRoom: true, roomCode: 'ROOM-1' })
    })

    it('keeps a link to friends, pending requests and undelivered messages only', () => {
      useGameStore.getState().addFriend(biaFriend)
      // Saved before stable ids existed: nobody to connect to
      useGameStore.getState().addFriend({ id: 'lira-OLD-peer-abcde', name: 'Antigo', actualUserId: 'lira-OLD-peer-abcde', lastSeen: 1 })
      expect(net.contacts()).toEqual([BIA])

      useChatStore.getState().addMessage(dmFromMe('undelivered-1', CAIO))
      expect(net.contacts().sort()).toEqual([BIA, CAIO].sort())

      useChatStore.getState().updateMessageStatus('undelivered-1', 'delivered')
      expect(net.contacts()).toEqual([BIA])
    })
  })

  describe('direct messages', () => {
    beforeEach(() => {
      useGameStore.getState().addFriend(biaFriend)
    })

    it('sends a message to a friend who is not in the same space', async () => {
      net.open(BIA)
      const message = dmFromMe('dm-1', BIA)
      useChatStore.getState().addMessage(message)
      await service.sendDirectMessage(message)

      const [packet] = net.packetsTo(BIA, 'dm')
      expect(packet.message).toMatchObject({ id: 'dm-1', senderId: ME, recipientId: BIA })
    })

    it('uploads a file attachment once: through the room when the friend is in it, else through the link', async () => {
      net.open(BIA)
      const attachment = { id: 'att-1', name: 'foto.png', size: 2_000_000, type: 'image/png', dataUrl: 'data:image/png;base64,AAAA' }

      // Same space: the room mesh carries it
      useGameStore.setState({
        roomId: 'ROOM-7',
        remotePlayers: { 'lira-ROOM-7-peer-zz9zz': { id: 'lira-ROOM-7-peer-zz9zz', gameId: BIA, name: 'Bia' } as Player },
      })
      await service.sendDirectMessage({ ...dmFromMe('dm-file-room', BIA), attachment })
      expect(net.packetsTo(BIA, 'dm')).toHaveLength(0)

      // A plain text message still takes both paths (cheap, and more reliable)
      await service.sendDirectMessage(dmFromMe('dm-text-room', BIA))
      expect(net.packetsTo(BIA, 'dm').map((p) => p.message.id)).toEqual(['dm-text-room'])

      // The friend left the space: the link is the only way
      useGameStore.setState({ remotePlayers: {} })
      await service.sendDirectMessage({ ...dmFromMe('dm-file-away', BIA), attachment })
      expect(net.packetsTo(BIA, 'dm').map((p) => p.message.id)).toEqual(['dm-text-room', 'dm-file-away'])
    })

    it('resolves the friend from a list entry that is keyed by something else', async () => {
      useGameStore.setState({
        friends: ['friend-bia'],
        friendProfiles: { 'friend-bia': { id: 'friend-bia', name: 'Bia', actualUserId: BIA } },
      })
      net.open(BIA)
      const message = { ...dmFromMe('dm-2', BIA), recipientId: 'friend-bia' }
      await service.sendDirectMessage(message)
      expect(net.packetsTo(BIA, 'dm')).toHaveLength(1)
    })

    it('delivers a message written while the friend was offline once they come online', async () => {
      const message = dmFromMe('dm-offline', BIA)
      useChatStore.getState().addMessage(message)
      await service.sendDirectMessage(message)

      expect(net.sent).toHaveLength(0)
      expect(net.network.syncContacts).toHaveBeenCalled()
      expect(net.contacts()).toContain(BIA)

      net.open(BIA)
      expect(net.packetsTo(BIA, 'dm').map((p) => p.message.id)).toEqual(['dm-offline'])

      // Bia's app confirms delivery: nothing left to re-send next time
      net.receive(BIA, { t: 'receipt', receipt: { messageId: 'dm-offline', status: 'delivered', timestamp: Date.now() } })
      expect(useChatStore.getState().messages.find((m) => m.id === 'dm-offline')?.status).toBe('delivered')

      net.close(BIA)
      net.open(BIA)
      expect(net.packetsTo(BIA, 'dm')).toHaveLength(1)
    })

    it('does not re-send messages that are too old', () => {
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000
      useChatStore.getState().addMessage(dmFromMe('dm-ancient', BIA, tenDaysAgo))
      net.open(BIA)
      expect(net.packetsTo(BIA, 'dm')).toHaveLength(0)
    })

    it('receives a message from a friend, counts it as unread and confirms delivery', () => {
      net.open(BIA)
      net.receive(BIA, { t: 'dm', message: dmToMe('dm-in-1', BIA, 'Bia', 'Oi Alice!') })

      const chat = useChatStore.getState()
      expect(chat.messages.find((m) => m.id === 'dm-in-1')?.content).toBe('Oi Alice!')
      expect(chat.getUnreadCountForFriend(biaFriend)).toBe(1)
      expect(chat.getLastMessageWithFriend(biaFriend)?.id).toBe('dm-in-1')

      const [receipt] = net.packetsTo(BIA, 'receipt')
      expect(receipt.receipt).toMatchObject({ senderId: ME, messageId: 'dm-in-1', status: 'delivered' })
    })

    it('stops counting a message as unread once the conversation is opened, and says so', () => {
      net.open(BIA)
      net.receive(BIA, { t: 'dm', message: dmToMe('dm-opened', BIA, 'Bia') })
      expect(useChatStore.getState().getUnreadCountForFriend(biaFriend)).toBe(1)

      useChatStore.getState().openDirectMessage({ id: BIA, name: 'Bia' })

      expect(useChatStore.getState().getUnreadCountForFriend(biaFriend)).toBe(0)
      expect(useChatStore.getState().getTotalUnreadDMs()).toBe(0)
      const receipts = net.packetsTo(BIA, 'receipt')
      expect(receipts[receipts.length - 1].receipt).toMatchObject({ senderId: ME, status: 'read' })
    })

    it('keeps one copy of a re-sent message and confirms it again', () => {
      vi.useFakeTimers()
      try {
        net.open(BIA)
        const message = dmToMe('dm-in-dup', BIA, 'Bia')
        net.receive(BIA, { t: 'dm', message })
        expect(net.packetsTo(BIA, 'receipt')).toHaveLength(1)

        // Our receipt got lost, so Bia's app sends the message again later
        vi.advanceTimersByTime(30000)
        net.receive(BIA, { t: 'dm', message })

        expect(useChatStore.getState().messages.filter((m) => m.id === 'dm-in-dup')).toHaveLength(1)
        // The sender only stops retrying once it sees the receipt
        const receipts = net.packetsTo(BIA, 'receipt')
        expect(receipts).toHaveLength(2)
        expect(receipts[1].receipt).toMatchObject({ messageId: 'dm-in-dup', status: 'delivered' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('ignores a message that claims to come from someone other than the linked user', () => {
      net.open(CAIO)
      net.receive(CAIO, { t: 'dm', message: dmToMe('dm-forged', BIA, 'Bia', 'me passa sua senha') })
      expect(useChatStore.getState().messages).toHaveLength(0)
    })

    it('files a linked message under the private conversation, whatever channel it names', () => {
      net.open(CAIO)
      net.receive(CAIO, { t: 'dm', message: { ...dmToMe('dm-inject', CAIO, 'Caio', 'aviso oficial'), channelId: 'general', recipientId: undefined } })

      const stored = useChatStore.getState().messages.find((m) => m.id === 'dm-inject')!
      expect(stored.channelId).toBe(getLocalDmChannelId(CAIO))
      expect(stored.recipientId).toBe(ME)
      expect(useChatStore.getState().channels.find((c) => c.id === 'general')?.unreadCount).toBe(0)
    })

    it('does not let a sender clock that runs ahead keep a message unread forever', () => {
      net.open(BIA)
      const tomorrow = Date.now() + 24 * 60 * 60 * 1000
      net.receive(BIA, { t: 'dm', message: { ...dmToMe('dm-future', BIA, 'Bia'), timestamp: tomorrow } })

      expect(useChatStore.getState().messages.find((m) => m.id === 'dm-future')!.timestamp).toBeLessThanOrEqual(Date.now())
      useChatStore.getState().openDirectMessage({ id: BIA, name: 'Bia' })
      expect(useChatStore.getState().getUnreadCountForFriend(biaFriend)).toBe(0)
    })

    it('only keeps attachments that are inline data', () => {
      net.open(BIA)
      const attachment = { id: 'a', name: 'foto.png', size: 10, type: 'image/png' }
      net.receive(BIA, { t: 'dm', message: { ...dmToMe('dm-att-ok', BIA, 'Bia'), attachment: { ...attachment, dataUrl: 'data:image/png;base64,AAAA' } } })
      net.receive(BIA, { t: 'dm', message: { ...dmToMe('dm-att-bad', BIA, 'Bia'), attachment: { ...attachment, dataUrl: 'javascript:alert(1)' } } })

      const find = (id: string) => useChatStore.getState().messages.find((m) => m.id === id)!
      expect(find('dm-att-ok').attachment?.dataUrl).toBe('data:image/png;base64,AAAA')
      expect(find('dm-att-bad').attachment).toBeUndefined()
    })

    it('never mixes a stranger with the same name into a friend conversation', () => {
      net.open(BIA)
      net.receive(BIA, { t: 'dm', message: dmToMe('dm-real', BIA, 'Bia', 'sou eu') })
      useChatStore.getState().markPeerAsRead(['Bia', BIA])

      net.open(CAIO)
      net.receive(CAIO, { t: 'dm', message: dmToMe('dm-namesake', CAIO, 'Bia', 'também sou "Bia"') })

      const chat = useChatStore.getState()
      const real = chat.messages.find((m) => m.id === 'dm-real')!
      const namesake = chat.messages.find((m) => m.id === 'dm-namesake')!
      expect(namesake.channelId).not.toBe(real.channelId)
      expect(chat.getUnreadCountForFriend(biaFriend)).toBe(0)
      expect(chat.getLastMessageWithFriend(biaFriend)?.id).toBe('dm-real')
    })

    it('applies delivery and read receipts received from the friend', () => {
      net.open(BIA)
      useChatStore.getState().addMessage(dmFromMe('dm-r1', BIA, 1000))
      useChatStore.getState().addMessage(dmFromMe('dm-r2', BIA, 2000))
      useChatStore.getState().addMessage(dmFromMe('dm-r3', BIA, 3000))

      net.receive(BIA, { t: 'receipt', receipt: { status: 'read', timestamp: 2500, upToTimestamp: 2000 } })

      const status = (id: string) => useChatStore.getState().messages.find((m) => m.id === id)?.status
      expect(status('dm-r1')).toBe('read')
      expect(status('dm-r2')).toBe('read')
      expect(status('dm-r3')).toBe('sent')
    })

    it('tells the friend what we already read when the link comes back', () => {
      useChatStore.getState().markPeerAsRead([BIA])
      net.sent.length = 0

      net.open(BIA)
      const [receipt] = net.packetsTo(BIA, 'receipt')
      expect(receipt.receipt).toMatchObject({ senderId: ME, recipientId: BIA, status: 'read' })
      expect(receipt.receipt.upToTimestamp).toBeGreaterThan(0)
    })

    it('reaches a friend inside the room after they reconnected with a new connection id', () => {
      // We joined a room: our entry is now keyed by this session's connection id
      useGameStore.getState().setLocalPlayer({ id: 'lira-ROOM-peer-new01', gameId: ME })
      const deliver = (recipientId: string, id: string) =>
        processNetworkMessage(
          {
            type: 'CHAT_MESSAGE',
            senderId: 'lira-ROOM-host',
            payload: { message: { ...dmToMe(id, BIA, 'Bia'), recipientId } },
            timestamp: Date.now(),
          },
          'lira-ROOM-host',
          false,
          vi.fn(),
          vi.fn(),
          vi.fn(),
          'lira-ROOM-peer-new01'
        )

      // Addressed to the connection id we had when the friendship was made: lost
      deliver('lira-ROOM-peer-old99', 'dm-stale')
      expect(useChatStore.getState().messages.find((m) => m.id === 'dm-stale')).toBeUndefined()

      // Addressed to the stable user id: arrives no matter how often we reconnect
      deliver(ME, 'dm-stable')
      expect(useChatStore.getState().messages.find((m) => m.id === 'dm-stable')).toBeDefined()
    })
  })

  describe('friend requests', () => {
    it('is made between stable user ids even when sent from inside a room', () => {
      useGameStore.getState().setLocalPlayer({ id: 'lira-ROOM-host', gameId: ME })

      const requestId = useChatStore.getState().sendFriendRequest({ id: BIA, name: 'Bia' })

      const message = useChatStore.getState().messages.find((m) => m.friendRequest?.requestId === requestId)!
      expect(message.senderId).toBe(ME)
      expect(message.recipientId).toBe(BIA)
      expect(message.friendRequest).toMatchObject({ fromUserId: ME, toUserId: BIA, status: 'pending' })
      expect(message.channelId).toBe(`dm-${[ME, BIA].sort().join('-')}`)
      // We stay reachable for the answer
      expect(net.contacts()).toContain(BIA)
    })

    it('goes out over the link when the other person is not in the same space', () => {
      net.open(BIA)
      net.sent.length = 0
      const requestId = useChatStore.getState().sendFriendRequest({ id: BIA, name: 'Bia' })

      const [packet] = net.packetsTo(BIA, 'dm')
      expect(packet.message.friendRequest.requestId).toBe(requestId)
    })

    it('adds the friend under their stable id when they accept, wherever they are', () => {
      const requestId = useChatStore.getState().sendFriendRequest({ id: BIA, name: 'Bia' })
      const request = useChatStore.getState().messages.find((m) => m.friendRequest?.requestId === requestId)!
      expect(useGameStore.getState().friends).toHaveLength(0)

      // Bia's app sends back the same message with the request resolved
      net.open(BIA)
      net.receive(BIA, { t: 'dm', message: { ...request, friendRequest: { ...request.friendRequest!, status: 'accepted' } } })

      expect(useGameStore.getState().friends).toEqual([BIA])
      expect(useChatStore.getState().getFriendRequestStatus(BIA)?.status).toBe('accepted')
      expect(service.getFriendStatus(useGameStore.getState().friendProfiles[BIA]).isOnline).toBe(true)
    })

    it('cannot be answered by anyone but the person it was sent to', () => {
      const requestId = useChatStore.getState().sendFriendRequest({ id: BIA, name: 'Bia' })
      const request = useChatStore.getState().messages.find((m) => m.friendRequest?.requestId === requestId)!

      // CAIO replays our request to BIA as if it had been accepted
      net.open(CAIO)
      net.receive(CAIO, { t: 'dm', message: { ...request, friendRequest: { ...request.friendRequest!, status: 'accepted' } } })

      expect(useGameStore.getState().friends).toHaveLength(0)
      expect(useChatStore.getState().getFriendRequestStatus(BIA)?.status).toBe('pending')
    })

    it('tells the requester our answer the next time a link opens', () => {
      useChatStore.getState().addMessage({
        ...dmToMe('req-msg', BIA, 'Bia', '🤝'),
        friendRequest: { requestId: 'freq-1', fromUserId: BIA, fromUserName: 'Bia', toUserId: ME, toUserName: 'Alice', status: 'pending' },
      })
      useChatStore.getState().respondToFriendRequest('freq-1', 'accepted')
      expect(useGameStore.getState().friends).toEqual([BIA])
      net.sent.length = 0

      net.open(BIA)
      const answers = net.packetsTo(BIA, 'dm').filter((p) => p.message.friendRequest?.requestId === 'freq-1')
      expect(answers).toHaveLength(1)
      expect(answers[0].message.friendRequest.status).toBe('accepted')
    })

    it('shows an incoming request as pending no matter what its sender claims', () => {
      net.open(CAIO)
      net.receive(CAIO, {
        t: 'dm',
        message: {
          ...dmToMe('req-forged', CAIO, 'Caio', '🤝'),
          friendRequest: { requestId: 'freq-forged', fromUserId: CAIO, fromUserName: 'Caio', toUserId: ME, toUserName: 'Alice', status: 'accepted' },
        },
      })

      expect(useGameStore.getState().friends).toHaveLength(0)
      expect(useChatStore.getState().getFriendRequestStatus(CAIO)?.status).toBe('pending')
    })

    it('does not accept a request on our behalf over the room mesh either', () => {
      useChatStore.getState().addMessage({
        ...dmToMe('req-forged-room', CAIO, 'Caio', '🤝'),
        friendRequest: { requestId: 'freq-forged-room', fromUserId: CAIO, fromUserName: 'Caio', toUserId: ME, toUserName: 'Alice', status: 'accepted' },
      })
      expect(useGameStore.getState().friends).toHaveLength(0)
      expect(useChatStore.getState().getFriendRequestStatus(CAIO)?.status).toBe('pending')
    })

    it('is not auto-accepted because a friend happens to share our own name', () => {
      // A friend called "Alice", like us
      useGameStore.getState().addFriend({ id: BIA, name: 'Alice', actualUserId: BIA, lastSeen: 1 })

      useChatStore.getState().addMessage({
        ...dmToMe('req-caio', CAIO, 'Caio', '🤝'),
        friendRequest: { requestId: 'freq-caio', fromUserId: CAIO, fromUserName: 'Caio', toUserId: ME, toUserName: 'Alice', status: 'pending' },
      })

      expect(useGameStore.getState().friends).toEqual([BIA])
      expect(useChatStore.getState().getFriendRequestStatus(CAIO)?.status).toBe('pending')
    })
  })

  describe('friends saved before stable ids', () => {
    it('replaces the entry saved under a temporary connection id when the friend is added again', () => {
      useGameStore.getState().addFriend({
        id: 'lira-ROOM-peer-old99',
        name: 'Bia',
        actualUserId: 'lira-ROOM-peer-old99',
        profilePicture: 'data:image/png;base64,AAAA',
        lastSeen: 1,
      })

      useGameStore.getState().addFriend(biaFriend)

      const { friends, friendProfiles } = useGameStore.getState()
      expect(friends).toEqual([BIA])
      expect(Object.keys(friendProfiles)).toEqual([BIA])
      expect(friendProfiles[BIA].profilePicture).toBe('data:image/png;base64,AAAA')
    })

    it('leaves other friends alone, including a different person with the same name', () => {
      useGameStore.getState().addFriend({ id: CAIO, name: 'Bia', actualUserId: CAIO, lastSeen: 1 })
      useGameStore.getState().addFriend({ id: 'lira-ROOM-peer-old77', name: 'Dani', lastSeen: 1 })

      useGameStore.getState().addFriend(biaFriend)

      expect(useGameStore.getState().friends.sort()).toEqual([CAIO, 'lira-ROOM-peer-old77', BIA].sort())
    })

    it('recognises a friend in the room list by stable id after they rejoin', () => {
      useGameStore.getState().addFriend(biaFriend)
      useGameStore.getState().setRemotePlayer({
        id: 'lira-ROOM-peer-new55',
        gameId: BIA,
        name: 'Bia',
        profilePicture: 'data:image/png;base64,BBBB',
      } as Player)

      // The saved profile is refreshed from the live player entry
      expect(useGameStore.getState().friendProfiles[BIA].profilePicture).toBe('data:image/png;base64,BBBB')
    })
  })
})
