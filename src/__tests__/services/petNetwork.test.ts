import { beforeEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => {
  const local = { id: 'self', role: 'owner', name: 'Ana', currentZoneId: 'zone', avatar: { pet: { type: 'custom', customAssetId: 'p', name: 'Mingau', personality: 'gentil' } } }
  const remote = { id: 'other', role: 'member', name: 'Bia', currentZoneId: 'zone', avatar: { pet: { type: 'custom', customAssetId: 'q', name: 'Rex', personality: 'curioso' } } }
  return { local, remote, owner: true, add: vi.fn(), channel: vi.fn(), broadcast: vi.fn(), chat: vi.fn(), ask: vi.fn().mockResolvedValue('Olá!') }
})
vi.mock('../../store/useGameStore', () => ({ useGameStore: { getState: () => ({ localPlayer: mock.local, remotePlayers: { other: mock.remote }, roomId: 'space', isOwner: mock.owner }) } }))
vi.mock('../../store/useChatStore', () => ({ useChatStore: { getState: () => ({ addMessage: mock.add, setActiveChannel: mock.channel, channels: [{ id: 'general', type: 'general' }, { id: 'social', type: 'social' }] }) } }))
vi.mock('../../store/useMediaStore', () => ({ useMediaStore: { getState: () => ({ isDeafened: false, outputVolume: 100 }) } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ getPeerId: () => 'self', broadcast: mock.broadcast, sendChatMessage: mock.chat }) } }))
vi.mock('../../services/petOpenRouter', async () => ({ ...await vi.importActual('../../services/petOpenRouter'), askPet: mock.ask }))
vi.mock('../../services/petApiKey', () => ({ getRoomPetApiKey: () => 'private-key' }))
import { requestPetFromChat, receivePetNetworkMessage } from '../../services/petNetwork'

beforeEach(() => { vi.clearAllMocks(); mock.owner = true; mock.local.role = 'owner'; mock.remote.role = 'member'; (mock.remote as any).isOwner = false })
describe('pet chat integration', () => {
  it('uses the room key for another participant’s pet without sharing the key', async () => {
    requestPetFromChat('other', 'Oi Rex', 'general')
    await vi.waitFor(() => expect(mock.ask).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'private-key', petName: 'Rex', personality: 'curioso' })))
    expect(mock.chat).not.toHaveBeenCalled()
    expect(mock.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'PET_REPLY', payload: expect.objectContaining({ ownerId: 'other', text: 'Olá!' }) }))
    expect(JSON.stringify(mock.broadcast.mock.calls)).not.toContain('private-key')
  })
  it('routes an @pet question from chat to its channel without posting a duplicate', async () => {
    requestPetFromChat('other', 'Como você está?', 'social')
    await vi.waitFor(() => expect(mock.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'PET_REPLY', payload: expect.objectContaining({ ownerId: 'other', channelId: 'social' }) })))
    expect(mock.chat).not.toHaveBeenCalled()
    expect(mock.ask).toHaveBeenCalledWith(expect.objectContaining({ question: 'Como você está?' }))
  })
  it('never sends a private message to the room pet', () => {
    requestPetFromChat('other', 'segredo', 'dm-123')
    expect(mock.ask).not.toHaveBeenCalled()
    expect(mock.broadcast).not.toHaveBeenCalled()
  })
  it('shows and speaks a response sent by the room owner once', () => {
    mock.owner = false
    mock.local.role = 'member'
    mock.remote.role = 'host'
    ;(mock.remote as any).isOwner = true
    const speak = vi.fn()
    class Utterance { lang = ''; volume = 1; constructor(public text: string) {} }
    vi.stubGlobal('window', { speechSynthesis: { speak } })
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
    const msg = { type: 'PET_REPLY' as const, senderId: 'other', payload: { id: 'remote-1', ownerId: 'self', zoneId: 'zone', text: 'Oi da sala!' }, timestamp: 1 }
    receivePetNetworkMessage(msg)
    receivePetNetworkMessage(msg)
    expect(mock.add).toHaveBeenCalledWith(expect.objectContaining({ senderName: '🐾 Mingau', content: 'Oi da sala!' }))
    expect(speak).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
