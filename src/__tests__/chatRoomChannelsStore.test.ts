import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useChatStore } from '../store/useChatStore'
import { useGameStore } from '../store/useGameStore'
import { FriendsPresenceService } from '../services/friendsPresenceService'
import { PeerManager } from '../p2p/PeerManager'
import { MAX_ROOM_CHANNELS } from '../utils/roomChannels'
import { Channel, ChatMessage } from '../types/chat'

const ME = 'u-aaaaaaaaaaaaaaaaaaaa'
const BOB = 'u-bbbbbbbbbbbbbbbbbbbb'
const DM_BOB = `dm-${ME}-${BOB}`

const general: Channel = { id: 'general', name: 'general', type: 'general', unreadCount: 0 }
const social: Channel = { id: 'social', name: 'social', type: 'social', unreadCount: 0 }
const zone: Channel = { id: 'current-zone', name: 'sala-1', type: 'zone', unreadCount: 0 }
const dmBob: Channel = { id: DM_BOB, name: 'Bob', type: 'dm', unreadCount: 0, recipientId: BOB }

const message = (id: string, channelId: string): ChatMessage => ({
  id,
  senderId: 'conn-x',
  senderName: 'X',
  channelId,
  content: 'oi',
  timestamp: 1,
})

const chat = () => useChatStore.getState()
const ids = () => chat().channels.map((c) => c.id)
const channel = (id: string) => chat().channels.find((c) => c.id === id)

beforeEach(() => {
  useGameStore.setState({
    localPlayer: { ...useGameStore.getState().localPlayer, id: 'conn-me', gameId: ME, name: 'Ana' },
    remotePlayers: {},
    friends: [],
    friendProfiles: {},
    roomId: 'ROOM-1',
    roomName: 'Escritório',
  })
  useChatStore.setState({
    channels: [general, social, zone, dmBob],
    messages: [],
    activeChannelId: 'general',
    isChatOpen: true,
    lastReadByPeer: {},
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createRoomChannel', () => {
  it('adds the channel after the others of the space, above the zone channel', () => {
    const result = chat().createRoomChannel('Projetos')
    expect(result.ok).toBe(true)
    const id = result.ok ? result.channelId : ''
    expect(ids()).toEqual(['general', 'social', id, 'current-zone', DM_BOB])
    expect(channel(id)).toMatchObject({ name: 'projetos', type: 'custom', unreadCount: 0 })
  })

  it('opens the new channel', () => {
    const result = chat().createRoomChannel('Projetos')
    expect(chat().activeChannelId).toBe(result.ok ? result.channelId : 'none')
  })

  it('gives each channel an id of its own, safe to share', () => {
    const a = chat().createRoomChannel('um')
    const b = chat().createRoomChannel('dois')
    expect(a.ok && b.ok && a.channelId !== b.channelId).toBe(true)
    for (const result of [a, b]) {
      expect(result.ok && result.channelId).toMatch(/^ch-[a-z0-9]+$/)
    }
  })

  it('refuses an empty or a taken name and changes nothing', () => {
    for (const name of ['   ', 'General', 'social']) {
      const result = chat().createRoomChannel(name)
      expect(result.ok).toBe(false)
      expect(result.ok ? '' : result.error).not.toBe('')
    }
    expect(ids()).toEqual(['general', 'social', 'current-zone', DM_BOB])
    expect(chat().activeChannelId).toBe('general')
  })

  it('stops at the maximum number of channels', () => {
    for (let i = 2; i < MAX_ROOM_CHANNELS; i++) {
      expect(chat().createRoomChannel(`canal-${i}`).ok).toBe(true)
    }
    const overflow = chat().createRoomChannel('um-a-mais')
    expect(overflow.ok).toBe(false)
    expect(overflow.ok ? '' : overflow.error).toContain(String(MAX_ROOM_CHANNELS))
    expect(chat().channels.filter((c) => c.type !== 'dm' && c.type !== 'zone')).toHaveLength(MAX_ROOM_CHANNELS)
  })
})

describe('renameRoomChannel', () => {
  it('changes only the name', () => {
    useChatStore.setState({ channels: [general, { ...social, unreadCount: 4 }, zone, dmBob] })
    expect(chat().renameRoomChannel('social', 'Café e Memes')).toEqual({ ok: true, channelId: 'social' })
    expect(ids()).toEqual(['general', 'social', 'current-zone', DM_BOB])
    expect(channel('social')).toMatchObject({ name: 'café-e-memes', type: 'social', unreadCount: 4 })
  })

  it('accepts the name the channel already has', () => {
    expect(chat().renameRoomChannel('social', 'social').ok).toBe(true)
  })

  it('refuses an empty name or the name of another channel', () => {
    expect(chat().renameRoomChannel('social', '  ').ok).toBe(false)
    expect(chat().renameRoomChannel('social', 'general').ok).toBe(false)
    expect(channel('social')?.name).toBe('social')
  })

  it('does not rename the zone channel, a conversation or a channel that is not there', () => {
    for (const id of ['current-zone', DM_BOB, 'ch-missing']) {
      expect(chat().renameRoomChannel(id, 'novo-nome').ok).toBe(false)
    }
    expect(chat().channels.map((c) => c.name)).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })
})

describe('deleteRoomChannel', () => {
  it('removes the channel and what was said in it', () => {
    useChatStore.setState({ messages: [message('m1', 'social'), message('m2', 'general'), message('m3', DM_BOB)] })
    expect(chat().deleteRoomChannel('social')).toBe(true)
    expect(ids()).toEqual(['general', 'current-zone', DM_BOB])
    expect(chat().messages.map((m) => m.id)).toEqual(['m2', 'm3'])
  })

  it('goes back to the general channel when the open one is deleted', () => {
    useChatStore.setState({ activeChannelId: 'social' })
    chat().deleteRoomChannel('social')
    expect(chat().activeChannelId).toBe('general')
  })

  it('leaves the open channel alone when another one is deleted', () => {
    useChatStore.setState({ activeChannelId: DM_BOB })
    chat().deleteRoomChannel('social')
    expect(chat().activeChannelId).toBe(DM_BOB)
  })

  it('never deletes the general channel, the zone channel, a conversation or nothing', () => {
    for (const id of ['general', 'current-zone', DM_BOB, 'ch-missing']) {
      expect(chat().deleteRoomChannel(id)).toBe(false)
    }
    expect(ids()).toEqual(['general', 'social', 'current-zone', DM_BOB])
  })
})

describe('setRoomChannels', () => {
  it('takes the channels of the space, keeping the zone channel and conversations', () => {
    chat().setRoomChannels([
      { id: 'general', name: 'avisos' },
      { id: 'ch-1', name: 'projetos' },
    ])
    expect(chat().channels.map((c) => [c.id, c.name])).toEqual([
      ['general', 'avisos'],
      ['ch-1', 'projetos'],
      ['current-zone', 'sala-1'],
      [DM_BOB, 'Bob'],
    ])
  })

  it('goes back to the general channel when the open one is gone', () => {
    useChatStore.setState({ activeChannelId: 'social' })
    chat().setRoomChannels([{ id: 'general', name: 'general' }])
    expect(chat().activeChannelId).toBe('general')
  })

  it('keeps the open channel or conversation when it is still there', () => {
    useChatStore.setState({ activeChannelId: 'social' })
    chat().setRoomChannels([
      { id: 'general', name: 'general' },
      { id: 'social', name: 'café' },
    ])
    expect(chat().activeChannelId).toBe('social')

    useChatStore.setState({ activeChannelId: DM_BOB })
    chat().setRoomChannels([{ id: 'general', name: 'general' }])
    expect(chat().activeChannelId).toBe(DM_BOB)
  })

  it('forgets what was said in the channels that are gone', () => {
    useChatStore.setState({ messages: [message('m1', 'social'), message('m2', 'general'), message('m3', DM_BOB)] })
    chat().setRoomChannels([{ id: 'general', name: 'general' }])
    expect(chat().messages.map((m) => m.id)).toEqual(['m2', 'm3'])
  })
})

describe('resetRoomChannels', () => {
  it('goes back to the channels every space starts with, keeping conversations', () => {
    chat().createRoomChannel('projetos')
    chat().renameRoomChannel('general', 'avisos')
    chat().resetRoomChannels()
    expect(chat().channels.map((c) => [c.id, c.name])).toEqual([
      ['general', 'general'],
      ['social', 'social'],
      ['current-zone', 'sala-1'],
      [DM_BOB, 'Bob'],
    ])
    expect(chat().activeChannelId).toBe('general')
  })
})

describe('a message for a channel that does not exist', () => {
  it('is dropped instead of creating a channel named after its sender', () => {
    chat().addMessage(message('m1', 'ch-deleted'))
    expect(ids()).toEqual(['general', 'social', 'current-zone', DM_BOB])
    expect(chat().messages).toEqual([])
  })

  it('still opens a conversation for a private message from someone new', () => {
    chat().addMessage({ ...message('m1', 'dm-whatever'), senderId: 'u-cccccccccccccccccccc', senderName: 'Carol', recipientId: ME })
    expect(chat().channels.some((c) => c.type === 'dm' && c.name === 'Carol')).toBe(true)
    expect(chat().messages).toHaveLength(1)
  })
})

describe('closeDirectMessage', () => {
  it('takes the conversation off the list and keeps what was said', () => {
    useChatStore.setState({ messages: [message('m1', DM_BOB)] })
    chat().closeDirectMessage(DM_BOB)
    expect(ids()).toEqual(['general', 'social', 'current-zone'])
    expect(chat().messages.map((m) => m.id)).toEqual(['m1'])
  })

  it('goes back to the general channel when the conversation was open', () => {
    useChatStore.setState({ activeChannelId: DM_BOB })
    chat().closeDirectMessage(DM_BOB)
    expect(chat().activeChannelId).toBe('general')
  })

  it('does not touch a channel of the space', () => {
    chat().closeDirectMessage('social')
    chat().closeDirectMessage('ch-missing')
    expect(ids()).toEqual(['general', 'social', 'current-zone', DM_BOB])
  })

  it('is remembered after a restart', () => {
    const saved: Record<string, string> = {}
    ;(globalThis as any).localStorage = {
      getItem: (key: string) => saved[key] ?? null,
      setItem: (key: string, value: string) => {
        saved[key] = value
      },
      removeItem: (key: string) => {
        delete saved[key]
      },
    }
    try {
      chat().closeDirectMessage(DM_BOB)
      expect(JSON.parse(saved.lira_saved_dm_channels)).toEqual([])
    } finally {
      delete (globalThis as any).localStorage
    }
  })
})

describe('sendRoomInvite', () => {
  const spies = () => ({
    direct: vi.spyOn(FriendsPresenceService.getInstance(), 'sendDirectMessage').mockResolvedValue(undefined),
    room: vi.spyOn(PeerManager.getInstance(), 'sendChatMessage').mockImplementation(() => {}),
  })

  it('sends the friend a private message carrying this space', () => {
    const { direct } = spies()
    expect(chat().sendRoomInvite({ id: BOB, name: 'Bob' })).toBe(true)

    expect(chat().messages).toHaveLength(1)
    const sent = chat().messages[0]
    expect(sent).toMatchObject({
      senderId: ME,
      senderName: 'Ana',
      recipientId: BOB,
      recipientName: 'Bob',
      channelId: DM_BOB,
      roomInvite: { roomCode: 'ROOM-1', roomName: 'Escritório' },
    })
    expect(direct).toHaveBeenCalledTimes(1)
    expect(direct.mock.calls[0][0]).toMatchObject({ id: sent.id, roomInvite: { roomCode: 'ROOM-1' } })
  })

  it('opens the conversation so the invite sent can be seen', () => {
    spies()
    useChatStore.setState({ isChatOpen: false })
    chat().sendRoomInvite({ id: BOB, name: 'Bob' })
    expect(chat().activeChannelId).toBe(DM_BOB)
    expect(chat().isChatOpen).toBe(true)
  })

  it('does not go through the space: the friend is somewhere else', () => {
    const { room } = spies()
    chat().sendRoomInvite({ id: BOB, name: 'Bob' })
    expect(room).not.toHaveBeenCalled()
  })

  it('starts a conversation with a friend never written to before', () => {
    spies()
    useChatStore.setState({ channels: [general, social, zone] })
    chat().sendRoomInvite({ id: BOB, name: 'Bob' })
    expect(channel(DM_BOB)).toMatchObject({ type: 'dm', name: 'Bob', recipientId: BOB })
  })

  it('has nowhere to invite to outside a space', () => {
    const { direct } = spies()
    useGameStore.setState({ roomId: null })
    expect(chat().sendRoomInvite({ id: BOB, name: 'Bob' })).toBe(false)
    expect(chat().messages).toEqual([])
    expect(direct).not.toHaveBeenCalled()
    expect(chat().activeChannelId).toBe('general')
  })
})
