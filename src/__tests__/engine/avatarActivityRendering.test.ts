import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomAsset } from '../../types/customAsset'
import type { Player } from '../../types/game'
import { AvatarRenderer } from '../../engine/AvatarRenderer'

const mocks = vi.hoisted(() => ({ assets: [] as CustomAsset[], image: vi.fn() }))
vi.mock('../../store/useCustomAssetsStore', () => ({
  getCustomAssetImage: mocks.image,
  useCustomAssetsStore: { getState: () => ({ customAssets: mocks.assets }) },
}))
vi.mock('../../engine/avatar/nameTagRenderer', () => ({ NameTagRenderer: { drawNameTag: vi.fn() } }))

describe('avatar activity rendering', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    mocks.assets = [{ id: 'character', frames: ['walking'], directionalFrames: { down: ['walking'] }, frameRateMs: 160,
      activityAnimations: { yawn: ['yawn0', 'yawn1', 'yawn2'], sleep: ['sleep0', 'sleep1'] } } as CustomAsset]
    mocks.image.mockImplementation(src => ({ src, complete: true, naturalWidth: 32, naturalHeight: 32 }))
    vi.spyOn(AvatarRenderer, 'drawAtlasPart').mockReturnValue(false)
  })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  const render = (change: Partial<Player>) => {
    const ctx = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), drawImage: vi.fn(), fillText: vi.fn() }
    const player = { x: 0, y: 0, direction: 'down', isMoving: false, avatar: { customAvatarId: 'character' }, activityAnimationStartedAt: 9600, ...change } as Player
    AvatarRenderer.drawPlayer(ctx as unknown as CanvasRenderingContext2D, player, true, 0, 32, false)
    return ctx
  }

  it('loops the yawning sequence while stationary', () => {
    expect(render({ activityAnimation: 'yawn' }).drawImage.mock.calls[0][0].src).toBe('yawn2')
    vi.setSystemTime(12_000)
    expect(render({ activityAnimation: 'yawn' }).drawImage.mock.calls[0][0].src).toBe('yawn0')
  })
  it('loops the same sleeping frames for every walking direction without mirroring', () => {
    const ctx = render({ activityAnimation: 'sleep', direction: 'left', activityAnimationStartedAt: 9760 })
    expect(ctx.drawImage.mock.calls[0][0].src).toBe('sleep1')
    expect(ctx.scale).not.toHaveBeenCalled()
    for (const direction of ['up', 'down', 'right'] as const) {
      const other = render({ activityAnimation: 'sleep', direction, activityAnimationStartedAt: 9760 })
      expect(other.drawImage.mock.calls[0][0].src).toBe('sleep1')
      expect(other.scale).not.toHaveBeenCalled()
    }
    vi.setSystemTime(10_160)
    expect(render({ activityAnimation: 'sleep', direction: 'right', activityAnimationStartedAt: 9760 }).drawImage.mock.calls[0][0].src).toBe('sleep0')
  })
  it('returns to walking immediately when moving and provides a cue for assets without sleeping frames', () => {
    expect(render({ activityAnimation: 'sleep', isMoving: true }).drawImage.mock.calls[0][0].src).toBe('walking')
    mocks.assets[0].activityAnimations = undefined
    expect(render({ activityAnimation: 'sleep' }).fillText).toHaveBeenCalledWith('Zzz', expect.any(Number), expect.any(Number))
  })

  it('plays the same yawning sequence when the character faces left', () => {
    const ctx = render({ activityAnimation: 'yawn', direction: 'left' })
    expect(ctx.drawImage.mock.calls[0][0].src).toBe('yawn2')
    expect(ctx.scale).not.toHaveBeenCalled()
  })
})
