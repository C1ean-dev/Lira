import '../helpers/mockAssetPersistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarRenderer, AvatarAtlasManager } from '../../engine/AvatarRenderer'
import { DEFAULT_AVATAR } from '../../engine/Constants'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import type { CustomAsset } from '../../types/customAsset'
import type { AvatarConfig, Direction, Player } from '../../types/game'

const missingId = 'avatar_other_1792115460422_c79z'
const requested: string[] = []
let sequence = 0
const asset = (id: string, src: string): CustomAsset => ({
  id, name: id, type: 'avatar', avatarSlot: 'other', category: 'Geral',
  width: 1, height: 1, isObstacle: false, createdAt: 1,
  frames: [src], directionalFrames: { down: src, up: src, left: src, right: src },
})
const render = (avatar: AvatarConfig, direction: Direction = 'down') => {
  const ctx = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() }
  const player: Player = { id: 'player', name: 'Player', x: 0, y: 0, direction, isMoving: false, avatar, status: 'available', lastUpdated: 1 }
  AvatarRenderer.drawPlayer(ctx as unknown as CanvasRenderingContext2D, player, false, 0, 32, false)
  return ctx
}
beforeEach(() => {
  sequence++
  requested.length = 0
  AvatarAtlasManager.clearCache()
  useCustomAssetsStore.setState({ customAssets: [] })
  vi.stubGlobal('Image', class {
    complete = true; naturalWidth = 32; naturalHeight = 32
    private source = ''
    get src() { return this.source }
    set src(value: string) { this.source = value; requested.push(value) }
    addEventListener() {}
  })
})
afterEach(() => { vi.unstubAllGlobals(); useCustomAssetsStore.setState({ customAssets: [] }); AvatarAtlasManager.clearCache() })

describe('avatar references while assets are unavailable', () => {
  it.each(['down', 'up', 'left', 'right'] as const)('draws the default avatar facing %s without requesting the missing ID as a file', direction => {
    const source = `file:///profile/library/default-${sequence}.png`
    useCustomAssetsStore.setState({ customAssets: [asset(DEFAULT_AVATAR.customAvatarId!, source)] })
    const avatar = { customAvatarId: missingId, otherType: missingId, customComponents: { other: missingId } }

    const ctx = render(avatar, direction)

    expect(requested).not.toContain(missingId)
    expect(ctx.drawImage).toHaveBeenCalledOnce()
    expect(ctx.drawImage.mock.calls[0][0].src).toBe(source)
    expect(avatar.customComponents.other).toBe(missingId)
  })

  it('renders the selected avatar once its asset arrives, without changing its saved reference', () => {
    const avatar = { customAvatarId: missingId, customComponents: { other: missingId } }
    expect(render(avatar).drawImage).not.toHaveBeenCalled()
    expect(requested).toEqual([])

    const source = `file:///profile/library/arrived-${sequence}.png`
    useCustomAssetsStore.setState({ customAssets: [asset(missingId, source)] })

    expect(render(avatar).drawImage.mock.calls[0][0].src).toBe(source)
    expect(requested).toEqual([source])
    expect(avatar.customComponents.other).toBe(missingId)
  })

  it('uses the default atlas when the individual library is still unavailable', () => {
    const defaultId = DEFAULT_AVATAR.customAvatarId!
    AvatarAtlasManager.registerAtlasXml('other', `<TextureAtlas imagePath="characters.png"><SubTexture name="other_${defaultId}_down_0" x="0" y="0" width="32" height="32"/></TextureAtlas>`)
    const image = { complete: true, naturalWidth: 32, naturalHeight: 32 } as HTMLImageElement
    AvatarAtlasManager.setImage('other', image)

    const ctx = render({ customComponents: { other: missingId } })

    expect(requested).toEqual([])
    expect(ctx.drawImage).toHaveBeenCalledOnce()
    expect(ctx.drawImage.mock.calls[0][0]).toBe(image)
  })

  it('falls back after an equipped asset is deleted instead of loading its former ID', () => {
    const source = `file:///profile/library/removed-${sequence}.png`
    const defaultSource = `file:///profile/library/fallback-${sequence}.png`
    const fallback = asset(DEFAULT_AVATAR.customAvatarId!, defaultSource)
    useCustomAssetsStore.setState({ customAssets: [fallback, asset(missingId, source)] })
    const avatar = { customComponents: { other: missingId } }
    expect(render(avatar).drawImage.mock.calls[0][0].src).toBe(source)

    useCustomAssetsStore.setState({ customAssets: [fallback] })

    expect(render(avatar).drawImage.mock.calls[0][0].src).toBe(defaultSource)
    expect(requested).toEqual([source, defaultSource])
  })

  it('also skips unresolved atlas preset IDs and assets with no usable frames', () => {
    useCustomAssetsStore.setState({ customAssets: [{ ...asset('empty-avatar', ''), frames: [], directionalFrames: undefined }] })

    render({ customComponents: { other: 'unknown-preset' } })
    render({ customComponents: { other: 'empty-avatar' } })

    expect(requested).toEqual([])
  })

  it.each([
    'data:image/png;base64,cGl4ZWxz',
    'blob:https://lira.test/legacy-avatar',
    'file:///profile/avatar.png',
    'https://lira.test/avatar/image',
    '/assets/avatar/legacy.png',
    './assets/avatar/legacy.png',
    'legacy.png',
  ])('still renders legacy avatars stored as image sources: %s', source => {
    const ctx = render({ customComponents: { other: source } })
    expect(ctx.drawImage).toHaveBeenCalledOnce()
    expect(ctx.drawImage.mock.calls[0][0].src).toBe(source)
    expect(requested).toEqual([source])
  })
})
