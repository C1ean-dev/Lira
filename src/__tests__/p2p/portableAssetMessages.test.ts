import { afterEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'

const fixture = vi.hoisted(() => {
  const hash = 'c'.repeat(64)
  const path = `assets/images/${hash}.png`
  return { hash, path }
})
vi.mock('../../media/bundledImageManifest', () => ({ default: { version: 1, aliases: {}, images: { [fixture.hash]: { path: fixture.path, mime: 'image/png' } } } }))
vi.mock('../../data/nativeAssets.json', () => ({ default: { assets: [], categories: [] } }))
vi.mock('../../data/nativeAvatarPresets.json', () => ({ default: { assets: [], categories: [] } }))
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const conn = { open: true, peer: 'other', send: vi.fn() }
  const manager = Object.create(PeerManager.prototype) as any
  Object.assign(manager, { peer: { id: 'local' }, connections: new Map([['other', conn]]) })
  return { conn, manager }
}
describe('portable asset network messages', () => {
  it('sends usable images to older clients and preserves update/delete order', async () => {
    let finish!: (value: string) => void
    vi.stubGlobal('window', { electronAPI: { readBundledImage: () => new Promise(resolve => { finish = resolve }) } })
    const { conn, manager } = setup()
    manager.sendCustomAssetAddOrUpdate({ id: 'cat', frames: [fixture.path] })
    manager.sendCustomAssetDelete('cat')
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(conn.send).not.toHaveBeenCalled()
    finish('data:image/png;base64,portable')
    await vi.waitFor(() => expect(conn.send).toHaveBeenCalledTimes(2))
    expect(conn.send.mock.calls[0][0].payload.asset.frames).toEqual(['data:image/png;base64,portable'])
    expect(conn.send.mock.calls[1][0].type).toBe('CUSTOM_ASSET_DELETE')
  })
  it('also converts image fields in player updates and initial snapshots', async () => {
    vi.stubGlobal('window', { electronAPI: { readBundledImage: async () => 'data:image/png;base64,portable' } })
    const { conn, manager } = setup()
    manager.broadcast({ type: 'PLAYER_UPDATE', senderId: 'local', timestamp: 1, payload: { avatar: { directionalFrames: { down: [fixture.path] } } } })
    await vi.waitFor(() => expect(conn.send).toHaveBeenCalledOnce())
    expect(conn.send.mock.calls[0][0].payload.avatar.directionalFrames.down).toEqual(['data:image/png;base64,portable'])
  })
  it('does not deliver a pending snapshot to a replaced connection', async () => {
    let finish!: (value: string) => void
    vi.stubGlobal('window', { electronAPI: { readBundledImage: () => new Promise(resolve => { finish = resolve }) } })
    const { conn, manager } = setup()
    manager.sendCustomAssetsSync([{ id: 'cat', frames: [fixture.path] }])
    await vi.waitFor(() => expect(finish).toBeDefined())
    manager.connections.set('other', { open: true, peer: 'other', send: vi.fn() })
    finish('data:image/png;base64,portable')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(conn.send).not.toHaveBeenCalled()
  })
})
