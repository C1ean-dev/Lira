import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import { PetState } from '../../engine/pet/PetManager'
import * as assetsStore from '../../store/useCustomAssetsStore'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('pet name placement', () => {
  it.each([
    { type: 'custom' as const, isMoving: false },
    { type: 'custom' as const, isMoving: true },
    { type: 'meowth' as const, isMoving: false },
    { type: 'meowth' as const, isMoving: true },
  ])('keeps the whole label above $type while moving=$isMoving', ({ type, isMoving }) => {
    vi.stubGlobal('Image', class {
      complete = true
      naturalWidth = 320
      src = ''
    })
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockReturnValue({
      complete: true, naturalWidth: 32, naturalHeight: 32,
    } as HTMLImageElement)
    const ctx = {
      save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), measureText: vi.fn(() => ({ width: 50 })),
      beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    const pet: PetState = {
      playerId: 'test', x: 3, y: 5, direction: 'down', isMoving,
      walkFrame: 0, walkTick: 0, history: [], idleTime: 0,
    }
    for (const time of [0, 150, 475]) {
      vi.mocked(ctx.drawImage).mockClear()
      vi.mocked(ctx.roundRect).mockClear()
      PetRenderer.drawPet(ctx, pet, {
        type, name: 'Pet',
        ...(type === 'custom' ? { directionalFrames: { down: ['sprite.png'] } } : {}),
      }, time)
      const [spriteX, spriteY, spriteWidth] = vi.mocked(ctx.drawImage).mock.calls[0].slice(-4) as number[]
      const [tagX, tagY, tagWidth, tagHeight] = vi.mocked(ctx.roundRect).mock.calls[0]
      expect(tagY + tagHeight).toBeLessThanOrEqual(spriteY - 4)
      expect(tagX + tagWidth / 2).toBe(spriteX + spriteWidth / 2)
    }
  })
})
