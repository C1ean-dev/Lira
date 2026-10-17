import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import type { PetState } from '../../engine/pet/PetManager'
import type { PetConfig } from '../../types/game'

vi.mock('../../store/useCustomAssetsStore', () => ({
  getCustomAssetImage: () => ({ complete: true, naturalWidth: 28 }),
  useCustomAssetsStore: { getState: () => ({ customAssets: [] }) },
}))

afterEach(() => vi.unstubAllGlobals())

function context() {
  return {
    save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })), beginPath: vi.fn(),
    roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

const pet: PetState = {
  playerId: 'owner', x: 5, y: 8, direction: 'down', isMoving: false,
  walkFrame: 0, walkTick: 0, history: [], idleTime: 0,
}
const configs: PetConfig[] = [
  { type: 'meowth', name: 'Meowth' },
  { type: 'custom', name: 'Gengar', directionalFrames: { down: 'frame', up: 'frame', left: 'frame', right: 'frame' } },
]

describe('pet name placement', () => {
  it.each(configs)('keeps the $type name above every idle and walking frame', (config) => {
    vi.stubGlobal('Image', class { complete = true; naturalWidth = 80; src = '' })
    for (const isMoving of [false, true]) {
      for (const currentTime of [0, 157, 471, 1885, 3999]) {
        const ctx = context()
        PetRenderer.drawPet(ctx, { ...pet, isMoving }, config, currentTime)
        const imageArgs = vi.mocked(ctx.drawImage).mock.calls[0]
        expect(imageArgs).toBeDefined()
        const [spriteX, spriteY, spriteWidth] = imageArgs.slice(-4) as number[]
        const [tagX, tagY, tagWidth, tagHeight] = vi.mocked(ctx.roundRect).mock.calls[0] as number[]
        expect(tagY + tagHeight).toBeLessThanOrEqual(spriteY - 4)
        expect(tagX + tagWidth / 2).toBeCloseTo(spriteX + spriteWidth / 2)
        expect(ctx.fillText).toHaveBeenCalledWith(`🐾 ${config.name}`, expect.any(Number), expect.any(Number))
      }
    }
  })

  it('keeps the name hidden when name tags are disabled', () => {
    const ctx = context()
    PetRenderer.drawPet(ctx, pet, configs[1], 1000, false)
    expect(ctx.drawImage).toHaveBeenCalled()
    expect(ctx.roundRect).not.toHaveBeenCalled()
    expect(ctx.fillText).not.toHaveBeenCalled()
  })
})