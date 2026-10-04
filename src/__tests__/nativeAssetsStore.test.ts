import { describe, it, expect, vi, beforeEach } from 'vitest'

// The store reads src/data/nativeAssets.json through an import. Two shapes of that
// file have to work: the one with a table of images (what the app writes now) and
// the old one with every image written in place.

const SPRITE_ONE = `data:image/png;base64,${'ONE'.repeat(100)}`
const SPRITE_TWO = `data:image/png;base64,${'TWO'.repeat(100)}`

const baseAsset = {
  type: 'furniture',
  category: 'Mobília',
  width: 1,
  height: 1,
  isObstacle: false,
  createdAt: 1,
}

const packed = {
  categories: ['Geral', 'Mobília'],
  assets: [
    { ...baseAsset, id: 'native_one', name: 'Um', frames: ['@one', '@two'], thumbnail: '@one' },
    {
      ...baseAsset,
      id: 'native_two',
      name: '@@arroba',
      frames: ['@two'],
      directionalFrames: { down: ['@one'], left: '@two' },
    },
  ],
  images: { one: SPRITE_ONE, two: SPRITE_TWO },
}

const legacy = {
  categories: ['Geral', 'Mobília'],
  assets: [
    { ...baseAsset, id: 'native_one', name: 'Um', frames: [SPRITE_ONE, SPRITE_TWO], thumbnail: SPRITE_ONE },
    {
      ...baseAsset,
      id: 'native_two',
      name: '@arroba',
      frames: [SPRITE_TWO],
      directionalFrames: { down: [SPRITE_ONE], left: SPRITE_TWO },
    },
  ],
}

async function loadStoreWith(file: unknown) {
  vi.resetModules()
  vi.doMock('../data/nativeAssets.json', () => ({ default: file }))
  return (await import('../store/useCustomAssetsStore')).useCustomAssetsStore
}

describe('useCustomAssetsStore reading nativeAssets.json', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it.each([
    ['the table of images', packed],
    ['the old format, with every image in place', legacy],
  ])('gives the assets their images back from %s', async (_name, file) => {
    const store = await loadStoreWith(file)
    const assets = store.getState().customAssets

    const one = assets.find((a) => a.id === 'native_one')!
    expect(one.frames).toEqual([SPRITE_ONE, SPRITE_TWO])
    expect(one.thumbnail).toBe(SPRITE_ONE)

    const two = assets.find((a) => a.id === 'native_two')!
    expect(two.frames).toEqual([SPRITE_TWO])
    expect(two.directionalFrames).toEqual({ down: [SPRITE_ONE], left: SPRITE_TWO })
  })

  it('reads a name that starts with "@" as the text it was', async () => {
    const store = await loadStoreWith(packed)
    expect(store.getState().customAssets.find((a) => a.id === 'native_two')!.name).toBe('@arroba')
  })

  it('keeps the categories of the file', async () => {
    const store = await loadStoreWith(packed)
    expect(store.getState().customCategories).toEqual(expect.arrayContaining(['Geral', 'Mobília']))
  })

  it('leaves no reference or table behind in the assets', async () => {
    const store = await loadStoreWith(packed)
    const text = JSON.stringify(store.getState().customAssets)
    expect(text).not.toContain('"@one"')
    expect(text).not.toContain('"@two"')
    expect(text).not.toContain('"images"')
  })
})
