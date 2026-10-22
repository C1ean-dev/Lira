import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeValue } from '../../assets/atlasFormat'
import { buildLibrary, imageIdentity, openLibrary, type LibraryCatalog, type LibraryPacket } from '../../assets/individualLibrary'
import type { CustomAsset } from '../../types/customAsset'
import { IndividualLibrarySync, type LibraryMessage } from '../../assets/individualLibrarySync'

const peer = vi.hoisted(() => ({ sendCustomAssetDelete: vi.fn() }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => peer } }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

// The same 1 MiB image is shared in memory. Expanding it into XML for every
// frame would exceed V8's string limit, even though the library needs one image.
const png = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024)
const asset: CustomAsset = {
  id: 'large-animation', name: 'Large animation', type: 'furniture', category: 'Geral',
  width: 1, height: 1, isObstacle: false, createdAt: 1,
  frames: Array(600).fill(png),
}

describe('libraries with repeated large images', () => {
  it('saves shared image bytes once without expanding them into a giant validation string', async () => {
    const packet = await buildLibrary({ assets: [asset], categories: ['Geral'], deletedAssetIds: ['removed'] })

    expect(packet.catalog.images).toHaveLength(1)
    expect(Object.values(packet.images)).toEqual([png])
    expect(packet.catalog.document).not.toContain('data:image')
    expect(packet.catalog.document.length).toBeLessThan(100_000)
    const reopened = openLibrary(packet.catalog, name => `/images/${name}`)
    expect(reopened.assets[0].frames).toEqual(Array(600).fill(`/images/${packet.catalog.images[0]}`))
    expect(reopened.deletedAssetIds).toEqual(['removed'])
  })

  it('opens a compact catalog even when its image resolver returns shared data URLs', async () => {
    const name = await imageIdentity(png)
    const catalog: LibraryCatalog = {
      version: 3, images: [name],
      document: encodeValue({ assets: [asset], categories: ['Geral'] }, new Map([[png, name]])),
    }

    const reopened = openLibrary(catalog, () => png, false)

    expect(reopened.assets[0].frames).toEqual(asset.frames)
    expect(reopened.categories).toEqual(['Geral'])
  })

  it('deletes furniture through the real save pipeline while retaining the other assets and deletion marker', async () => {
    const save = vi.fn(async (packet: LibraryPacket) => ({ catalog: packet.catalog, baseUrl: 'file:///profile/library/' }))
    const alert = vi.fn()
    vi.stubGlobal('window', { location: { protocol: 'file:', href: 'file:///app/index.html' }, alert, electronAPI: { saveIndividualLibrary: save } })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const { useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    useCustomAssetsStore.setState({ customAssets: [asset, { ...asset, id: 'removed', frames: [png] }], customCategories: ['Geral'], deletedAssetIds: [] })

    await useCustomAssetsStore.getState().deleteCustomAsset('removed')

    expect(save).toHaveBeenCalledOnce()
    const saved = openLibrary(save.mock.calls[0][0].catalog, name => `/images/${name}`)
    expect(saved.assets.map(item => item.id)).toEqual([asset.id])
    expect(saved.assets[0].frames).toHaveLength(600)
    expect(saved.deletedAssetIds).toEqual(['removed'])
    expect(useCustomAssetsStore.getState().deletedAssetIds).toEqual(['removed'])
    expect(useCustomAssetsStore.getState().customAssets[0].frames[0]).toMatch(/^file:\/\/\/profile\/library\/sprites\//)
    expect(peer.sendCustomAssetDelete).toHaveBeenCalledWith('removed')
    expect(alert).not.toHaveBeenCalled()
  })

  it('receives large shared images from another participant and saves them without expanding the catalog', async () => {
    const save = vi.fn(async (packet: LibraryPacket) => ({ catalog: packet.catalog, baseUrl: 'file:///profile/library/' }))
    const alert = vi.fn()
    vi.stubGlobal('window', { location: { protocol: 'file:', href: 'file:///app/index.html' }, alert, electronAPI: { saveIndividualLibrary: save } })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    const { useCustomAssetsStore } = await import('../../store/useCustomAssetsStore')
    useCustomAssetsStore.setState({ customAssets: [], customCategories: ['Geral'], deletedAssetIds: [] })
    const sender = new IndividualLibrarySync()
    const receiver = new IndividualLibrarySync(() => undefined)
    const outgoing: LibraryMessage[] = []
    const requests: LibraryMessage[] = []
    const commit = async (document: { assets: CustomAsset[]; categories: string[] }) => {
      await useCustomAssetsStore.getState().syncRemoteCustomAssets(document.assets, document.categories)
    }

    await sender.offer({ assets: [asset], categories: ['Geral'] }, message => { outgoing.push(message) })
    await receiver.receive(outgoing.shift()!, message => { requests.push(message) }, commit)
    await sender.receive(requests.shift()!, message => { outgoing.push(message) }, commit)
    for (const message of outgoing) await receiver.receive(message, () => {}, commit)

    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0][0].catalog.document.length).toBeLessThan(100_000)
    expect(useCustomAssetsStore.getState().customAssets[0].frames).toHaveLength(600)
    expect(useCustomAssetsStore.getState().customAssets[0].frames[0]).toMatch(/^file:\/\/\/profile\/library\/sprites\//)
    expect(alert).not.toHaveBeenCalled()
  })
})
