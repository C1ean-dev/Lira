import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { avatarAnimationOptions } from '../../utils/avatarAnimationOptions'
import { playAvatarAnimation } from '../../engine/avatar/avatarAnimationControls'
import type { CustomAsset } from '../../types/customAsset'
import type { AvatarConfig } from '../../types/game'
const mocks = vi.hoisted(() => ({ player: {} as any, assets: [] as CustomAsset[], send: vi.fn(), set: vi.fn() }))
vi.mock('../../store/useGameStore', () => ({ useGameStore: { getState: () => ({ localPlayer: mocks.player, setLocalPlayer: mocks.set }) } }))
vi.mock('../../store/useCustomAssetsStore', () => ({ useCustomAssetsStore: { getState: () => ({ customAssets: mocks.assets }) } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ sendPlayerUpdate: mocks.send }) } }))
const character = (id: string, animations: any): CustomAsset => ({ id, type: 'avatar', activityAnimations: animations }) as CustomAsset
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(5000)
  mocks.player = { avatar: { customAvatarId: 'hero', otherType: 'none' } }
  mocks.assets = [character('hero', { sleep: ['sleep'], yawn: ['yawn'], empty: [], dance: ['dance'], none: ['bad'] }), character('other', { wave: ['wave'] })]
  mocks.send.mockClear(); mocks.set.mockClear()
})
afterEach(() => vi.useRealTimers())
it('discovers every playable activity of the active character including newly added ones', () => {
  expect(avatarAnimationOptions(mocks.player.avatar, mocks.assets)).toEqual([
    { id: 'sleep', label: 'Dormir', emoji: '😴' }, { id: 'yawn', label: 'Bocejar', emoji: '🥱' }, { id: 'dance', label: 'Dance', emoji: '🎭' },
  ])
  mocks.assets[0].activityAnimations!.wave = ['new']
  expect(avatarAnimationOptions(mocks.player.avatar, mocks.assets).map(a => a.id)).toContain('wave')
})
it('uses the same character priority as the renderer and supports default and legacy sequences', () => {
  mocks.assets.push(character('avatar_other_sliced_1788355059618_ozg3', { yawn: { down: ['legacy'] } }))
  expect(avatarAnimationOptions({ otherType: 'none' } as AvatarConfig, mocks.assets).map(a => a.id)).toEqual(['yawn'])
  expect(avatarAnimationOptions({ otherType: 'other', customAvatarId: 'hero' } as AvatarConfig, mocks.assets).map(a => a.id)).toEqual(['wave'])
  expect(avatarAnimationOptions({ ...mocks.player.avatar, customComponents: { other: 'other' } }, mocks.assets).map(a => a.id)).toEqual(['wave'])
  expect(avatarAnimationOptions({ ...mocks.player.avatar, customSkinUrl: 'skin.png' }, mocks.assets)).toEqual([])
})
it('starts a manual animation locally and broadcasts its synchronized start time', () => {
  expect(playAvatarAnimation('dance')).toBe(true)
  expect(mocks.set).toHaveBeenCalledWith({ activityAnimation: 'dance', activityAnimationStartedAt: 5000, activityAnimationManual: true })
  expect(mocks.send).toHaveBeenCalledWith({ activityAnimation: 'dance', activityAnimationStartedAt: 5000 })
})
it('stops the selected animation and rejects animations unavailable on the character', () => {
  expect(playAvatarAnimation('unknown')).toBe(false)
  expect(mocks.send).not.toHaveBeenCalled()
  expect(playAvatarAnimation('none')).toBe(true)
  expect(mocks.set).toHaveBeenCalledWith({ activityAnimation: 'none', activityAnimationStartedAt: 0, activityAnimationManual: false })
  expect(mocks.send).toHaveBeenCalledWith({ activityAnimation: 'none', activityAnimationStartedAt: 0 })
})
