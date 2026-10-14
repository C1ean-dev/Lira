import { afterEach, describe, expect, it, vi } from 'vitest'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import type { PetState } from '../../engine/pet/PetManager'
import * as assetsStore from '../../store/useCustomAssetsStore'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const makePet = (): PetState => ({
  playerId: 'still-test', x: 2, y: 3, direction: 'down', isMoving: false,
  walkFrame: 0, walkTick: 0, history: [], idleTime: 0,
})
const makeContext = () => ({
  save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), fillText: vi.fn(), strokeText: vi.fn(),
  measureText: vi.fn(() => ({ width: 40 })), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
})

describe('stationary and sleeping pets', () => {
  it.each(['custom', 'meowth'] as const)('keeps %s at the exact same height while idle', type => {
    vi.stubGlobal('Image', class { complete = true; naturalWidth = 320; src = '' })
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockReturnValue({ complete: true, naturalWidth: 32 } as HTMLImageElement)
    const ctx = makeContext()
    const pet = makePet()
    for (const time of [0, 150, 475, 900]) {
      PetRenderer.drawPet(ctx as unknown as CanvasRenderingContext2D, pet,
        { type, ...(type === 'custom' ? { directionalFrames: { down: ['idle'] } } : {}) }, time, false)
    }
    expect(new Set(ctx.drawImage.mock.calls.map(call => call.slice(-4)[1])).size).toBe(1)
  })

  it('shows three Zs above the pet and its name only while a sleep animation is active', () => {
    vi.spyOn(assetsStore, 'getCustomAssetImage').mockReturnValue({ complete: true, naturalWidth: 32 } as HTMLImageElement)
    const ctx = makeContext()
    const pet = makePet()
    const config = { type: 'custom' as const, name: 'Pet', directionalFrames: { down: ['idle'] },
      petAnimations: { sleep: { frames: ['sleep'], frameRateMs: 700 } } }
    pet.idleTime = 300
    PetRenderer.drawPet(ctx as unknown as CanvasRenderingContext2D, pet, config, 1500, true)
    const zs = ctx.fillText.mock.calls.filter(call => call[0] === 'Z')
    expect(zs).toHaveLength(3)
    const [, tagY] = ctx.roundRect.mock.calls[0]
    expect(zs.every(call => call[2] < tagY)).toBe(true)
    for (const state of [{ idleTime: 299, isMoving: false, sleep: true },
      { idleTime: 300, isMoving: true, sleep: true }, { idleTime: 300, isMoving: false, sleep: false }]) {
      ctx.fillText.mockClear()
      Object.assign(pet, { idleTime: state.idleTime, isMoving: state.isMoving })
      PetRenderer.drawPet(ctx as unknown as CanvasRenderingContext2D, pet,
        { ...config, petAnimations: state.sleep ? config.petAnimations : undefined }, 1500, false)
      expect(ctx.fillText.mock.calls.filter(call => call[0] === 'Z')).toHaveLength(0)
    }
  })
})
