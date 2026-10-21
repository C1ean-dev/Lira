import '../helpers/mockAssetPersistence'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'
import { buildAtlas } from '../../assets/atlasService'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
const asset = { id: 'hero', name: 'Hero', type: 'avatar' as const, category: 'People', width: 1, height: 1, frames: ['data:image/png;base64,aGVybw=='], createdAt: 1 }
const originalAssets = useCustomAssetsStore.getState()
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); useCustomAssetsStore.setState(originalAssets) })
function setup() {
  const manager = new (PeerManager as any)()
  manager.peer = { id: 'me' }
  const connection = { peer: 'other', open: true, metadata: { individualLibrary: 2 }, send: vi.fn() }
  manager.connections.set('other', connection)
  return { manager, connection }
}
describe('individual image protocol integration', () => {
  it('advertises only metadata and sends requested bytes without building an atlas', async () => {
    const { manager, connection } = setup()
    manager.handleNetworkMessage({ type: 'INDIVIDUAL_LIBRARY', senderId: 'other', payload: { kind: 'hello', id: 'hello' } }, 'other')
    manager.sendCustomAssetAddOrUpdate(asset)
    await manager.assetTransferQueue
    expect(buildAtlas).not.toHaveBeenCalled()
    const offer = connection.send.mock.calls.find(([message]: any[]) => message.payload.kind === 'offer')![0]
    expect(offer.type).toBe('INDIVIDUAL_LIBRARY')
    expect(offer.payload.catalog.version).toBe(2)
    expect(JSON.stringify(offer)).not.toContain('data:image')
    manager.handleNetworkMessage({ type: 'INDIVIDUAL_LIBRARY', senderId: 'other', payload: { kind: 'request', id: offer.payload.id, names: offer.payload.catalog.images } }, 'other')
    await manager.individualLibrarySession(connection).queue
    expect(connection.send.mock.calls.some(([message]: any[]) => message.payload.kind === 'image')).toBe(true)
  })
  it('uses the legacy transfer until the remote peer advertises support, even on an outgoing connection with our own metadata', async () => {
    const { manager, connection } = setup()
    manager.sendCustomAssetAddOrUpdate(asset)
    await manager.assetTransferQueue
    expect(buildAtlas).toHaveBeenCalledOnce()
    expect(connection.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CUSTOM_ASSET_ADD_OR_UPDATE' }))
  })
  it('uses source-sheet catalogs only after the remote participant explicitly announces v3', async () => {
    const { manager, connection } = setup()
    manager.handleNetworkMessage({ type: 'INDIVIDUAL_LIBRARY', senderId: 'other', payload: { kind: 'hello', id: 'hello', catalogVersion: 3 } }, 'other')
    manager.sendCustomAssetAddOrUpdate(asset)
    await manager.assetTransferQueue
    const offer = connection.send.mock.calls.find(([message]: any[]) => message.payload.kind === 'offer')![0]
    expect(offer.payload.catalog.version).toBe(3)
    expect(buildAtlas).not.toHaveBeenCalled()
  })
  it.each([false, true])('confirms remote support for the initial host sync (remote supports v2: %s)', async supportsV2 => {
    vi.useFakeTimers()
    const { manager, connection } = setup()
    manager.isHost = true
    manager.roomCode = 'ROOM'
    useCustomAssetsStore.setState({ customAssets: [asset] })
    const handlers: Record<string, (...args: any[]) => void> = {}
    const connected = Object.assign(connection, { on: (event: string, listener: (...args: any[]) => void) => { handlers[event] = listener } })
    manager.setupDataConnection(connected)
    handlers.open()
    await vi.advanceTimersByTimeAsync(100)
    if (supportsV2) manager.handleNetworkMessage({ type: 'INDIVIDUAL_LIBRARY', senderId: 'other', payload: { kind: 'hello', id: 'v2' } }, 'other')
    await vi.advanceTimersByTimeAsync(1000)
    await manager.assetTransferQueue
    const messages = connection.send.mock.calls.map(([message]: any[]) => message)
    if (supportsV2) {
      expect(messages.some(message => message.payload.kind === 'offer')).toBe(true)
      expect(messages.some(message => message.type === 'CUSTOM_ASSETS_SYNC')).toBe(false)
    } else {
      expect(messages.some(message => message.type === 'CUSTOM_ASSETS_SYNC')).toBe(true)
      expect(messages.some(message => message.payload.kind === 'offer')).toBe(false)
    }
  })
})
