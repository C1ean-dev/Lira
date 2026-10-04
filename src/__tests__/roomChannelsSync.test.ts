import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  canManageRoomChannels,
  createRoomChannel,
  deleteRoomChannel,
  publishRoomChannels,
  renameRoomChannel,
  restoreRoomChannels,
} from '../services/roomChannelsService'
import { processNetworkMessage } from '../p2p/messageHandlers'
import { PeerManager } from '../p2p/PeerManager'
import { useChatStore } from '../store/useChatStore'
import { useGameStore } from '../store/useGameStore'
import { useSavedSpacesStore, SavedSpace } from '../store/useSavedSpacesStore'
import { DEFAULT_ROOM_CHANNELS } from '../utils/roomChannels'
import { Channel } from '../types/chat'
import { NetworkMessage } from '../types/p2p'

const HOST = 'lira-ROOM-1-host'
const CLIENT = 'lira-ROOM-1-peer-abcde'

const general: Channel = { id: 'general', name: 'general', type: 'general', unreadCount: 0 }
const social: Channel = { id: 'social', name: 'social', type: 'social', unreadCount: 0 }
const zone: Channel = { id: 'current-zone', name: 'sala-1', type: 'zone', unreadCount: 0 }
const dm: Channel = { id: 'dm-a-b', name: 'Bob', type: 'dm', unreadCount: 0, recipientId: 'b' }

const space = (extra: Partial<SavedSpace> = {}): SavedSpace =>
  ({
    id: 'space-1',
    roomCode: 'room-1',
    name: 'Escritório',
    createdAt: 1,
    updatedAt: 1,
    mapData: {} as any,
    ...extra,
  }) as SavedSpace

const chat = () => useChatStore.getState()
const names = () => chat().channels.map((c) => c.name)
const savedChannels = () => useSavedSpacesStore.getState().savedSpaces[0]?.channels

let broadcastChannels: ReturnType<typeof vi.spyOn>

const enter = (isOwner: boolean) =>
  useGameStore.setState({
    roomId: 'ROOM-1',
    isOwner,
    isHost: isOwner,
    localPlayer: { ...useGameStore.getState().localPlayer, id: isOwner ? HOST : CLIENT },
  })

beforeEach(() => {
  enter(true)
  useChatStore.setState({ channels: [general, social, zone, dm], messages: [], activeChannelId: 'general' })
  useSavedSpacesStore.setState({ savedSpaces: [space()] })
  broadcastChannels = vi.spyOn(PeerManager.getInstance(), 'sendRoomChannels').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('who manages the channels of a space', () => {
  it('is its owner, while inside it', () => {
    expect(canManageRoomChannels()).toBe(true)
    enter(false)
    expect(canManageRoomChannels()).toBe(false)
    useGameStore.setState({ roomId: null, isOwner: true })
    expect(canManageRoomChannels()).toBe(false)
  })

  it('lets nobody else create, rename or delete', () => {
    enter(false)
    const created = createRoomChannel('projetos')
    const renamed = renameRoomChannel('social', 'café')
    expect(created.ok).toBe(false)
    expect(created.ok ? '' : created.error).toMatch(/dono/)
    expect(renamed.ok).toBe(false)
    expect(deleteRoomChannel('social')).toBe(false)

    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
    expect(broadcastChannels).not.toHaveBeenCalled()
    expect(savedChannels()).toBeUndefined()
  })
})

describe('changing the channels as the owner', () => {
  it('tells everyone in the space and saves the list with the space', () => {
    const result = createRoomChannel('Projetos')
    expect(result.ok).toBe(true)

    const expected = [
      { id: 'general', name: 'general' },
      { id: 'social', name: 'social' },
      { id: result.ok ? result.channelId : '', name: 'projetos' },
    ]
    expect(broadcastChannels).toHaveBeenCalledTimes(1)
    expect(broadcastChannels).toHaveBeenCalledWith(expected)
    expect(savedChannels()).toEqual(expected)
  })

  it('does the same for a rename and for a deletion', () => {
    expect(renameRoomChannel('social', 'Café').ok).toBe(true)
    expect(broadcastChannels).toHaveBeenLastCalledWith([
      { id: 'general', name: 'general' },
      { id: 'social', name: 'café' },
    ])

    expect(deleteRoomChannel('social')).toBe(true)
    expect(broadcastChannels).toHaveBeenLastCalledWith([{ id: 'general', name: 'general' }])
    expect(savedChannels()).toEqual([{ id: 'general', name: 'general' }])
    expect(broadcastChannels).toHaveBeenCalledTimes(2)
  })

  it('shares nothing when the change was refused', () => {
    expect(createRoomChannel('general').ok).toBe(false)
    expect(renameRoomChannel('social', '   ').ok).toBe(false)
    expect(deleteRoomChannel('general')).toBe(false)
    expect(broadcastChannels).not.toHaveBeenCalled()
    expect(savedChannels()).toBeUndefined()
  })

  it('has nobody to tell and nothing to save outside a space', () => {
    useGameStore.setState({ roomId: null })
    publishRoomChannels()
    expect(broadcastChannels).not.toHaveBeenCalled()
    expect(savedChannels()).toBeUndefined()
  })

  it('never shares private conversations or the zone channel', () => {
    publishRoomChannels()
    const shared = broadcastChannels.mock.calls[0][0] as { id: string }[]
    expect(shared.map((c) => c.id)).toEqual(['general', 'social'])
  })

  it('saves to the space with this room code, whatever its letter case', () => {
    useSavedSpacesStore.setState({
      savedSpaces: [space({ id: 'space-other', roomCode: 'ROOM-9' }), space({ id: 'space-mine', roomCode: 'Room-1' })],
    })
    createRoomChannel('projetos')
    const [other, mine] = useSavedSpacesStore.getState().savedSpaces
    expect(other.channels).toBeUndefined()
    expect(mine.channels?.map((c) => c.name)).toEqual(['general', 'social', 'projetos'])
  })

  it('still tells everyone when the space is not one of the saved ones', () => {
    useSavedSpacesStore.setState({ savedSpaces: [] })
    expect(createRoomChannel('projetos').ok).toBe(true)
    expect(broadcastChannels).toHaveBeenCalledTimes(1)
  })
})

describe('restoreRoomChannels', () => {
  it('brings back the channels saved with the space', () => {
    useSavedSpacesStore.setState({
      savedSpaces: [
        space({
          channels: [
            { id: 'general', name: 'avisos' },
            { id: 'ch-1', name: 'projetos' },
          ],
        }),
      ],
    })
    restoreRoomChannels('ROOM-1')
    expect(names()).toEqual(['avisos', 'projetos', 'sala-1', 'Bob'])
  })

  it('starts from the default channels for a space with none saved', () => {
    useChatStore.setState({ channels: [{ ...general, name: 'antigo' }, zone, dm] })
    restoreRoomChannels('ROOM-1')
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })

  it('starts from the default channels for a space that is not saved here', () => {
    useChatStore.setState({ channels: [{ ...general, name: 'antigo' }, zone, dm] })
    restoreRoomChannels('ROOM-UNKNOWN')
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })

  it('does not trust what is in the saved file', () => {
    useSavedSpacesStore.setState({
      savedSpaces: [
        space({
          channels: [
            { id: 'general', name: 'Avisos Gerais' },
            { id: 'dm-x-y', name: 'intruso' },
          ] as any,
        }),
      ],
    })
    restoreRoomChannels('ROOM-1')
    expect(names()).toEqual(['avisos-gerais', 'sala-1', 'Bob'])
  })
})

describe('CHANNELS_SYNC over the network', () => {
  const sync = (channels: unknown, senderId = HOST): NetworkMessage => ({
    type: 'CHANNELS_SYNC',
    senderId,
    payload: { channels },
    timestamp: 1,
  })

  const receive = (msg: NetworkMessage, from: string, isHost: boolean) => {
    const broadcast = vi.fn()
    processNetworkMessage(msg, from, isHost, broadcast, vi.fn(), vi.fn(), isHost ? HOST : CLIENT)
    return broadcast
  }

  const list = [
    { id: 'general', name: 'avisos' },
    { id: 'ch-1', name: 'projetos' },
  ]

  beforeEach(() => enter(false))

  it('gives someone in the space the channels its host has', () => {
    receive(sync(list), HOST, false)
    expect(chat().channels.map((c) => [c.id, c.name, c.type])).toEqual([
      ['general', 'avisos', 'general'],
      ['ch-1', 'projetos', 'custom'],
      ['current-zone', 'sala-1', 'zone'],
      ['dm-a-b', 'Bob', 'dm'],
    ])
  })

  it('is ignored when it does not come over the connection to the host', () => {
    const visitor = 'lira-ROOM-1-peer-zzzzz'
    receive(sync(list, visitor), visitor, false)
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })

  it('is ignored when the host only relays it for someone else', () => {
    receive(sync(list, 'lira-ROOM-1-peer-zzzzz'), HOST, false)
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })

  it('is ignored by the host, who does not pass it on either', () => {
    enter(true)
    const broadcast = receive(sync(list, CLIENT), CLIENT, true)
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('is ignored by the host even from a visitor whose id looks like a host', () => {
    enter(true)
    const impostor = 'lira-OTHER-host'
    const broadcast = receive(sync(list, impostor), impostor, true)
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('is ignored when it does not carry a list', () => {
    receive(sync('general'), HOST, false)
    receive({ type: 'CHANNELS_SYNC', senderId: HOST, payload: undefined, timestamp: 1 }, HOST, false)
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })

  it('is cleaned before it is applied', () => {
    receive(
      sync([
        { id: 'general', name: 'Avisos Gerais', unreadCount: 50 },
        { id: 'dm-a-b', name: 'intruso' },
        { id: 'current-zone', name: 'intruso' },
      ]),
      HOST,
      false
    )
    expect(chat().channels.map((c) => [c.id, c.name, c.unreadCount])).toEqual([
      ['general', 'avisos-gerais', 0],
      ['current-zone', 'sala-1', 0],
      ['dm-a-b', 'Bob', 0],
    ])
  })

  it('matches the list the owner publishes', () => {
    enter(true)
    createRoomChannel('projetos')
    const published = broadcastChannels.mock.calls[0][0]
    const ownerView = chat().channels.map((c) => [c.id, c.name])

    enter(false)
    useChatStore.setState({ channels: [general, social, zone, dm], activeChannelId: 'general' })
    receive(sync(published), HOST, false)
    expect(chat().channels.map((c) => [c.id, c.name])).toEqual(ownerView)
  })

  it('leaves the default channels as they are when the host has the defaults', () => {
    receive(sync(DEFAULT_ROOM_CHANNELS), HOST, false)
    expect(names()).toEqual(['general', 'social', 'sala-1', 'Bob'])
  })
})
