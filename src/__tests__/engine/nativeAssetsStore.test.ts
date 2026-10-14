import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  vi.doMock('../../data/nativeAssets.json', () => ({ default: file }))
  return (await import('../../store/useCustomAssetsStore')).useCustomAssetsStore
}

describe('useCustomAssetsStore reading nativeAssets.json', () => {
  it('keeps the newer shipped 256-pixel cat sheet when the native file still contains a 237-pixel copy', async () => {
    const store = await loadStoreWith({ categories: ['Geral'], assets: [{
      ...baseAsset, id: 'avatar_pet_sliced_01_gato_cabelo_rosa', type: 'avatar', avatarSlot: 'pet',
      name: 'Old cat', pixelWidth: 237, pixelHeight: 237, updatedAt: 1, frames: [SPRITE_ONE],
    }] })
    const asset = store.getState().customAssets.find(a => a.id === 'avatar_pet_sliced_01_gato_cabelo_rosa')!
    expect([asset.pixelWidth, asset.pixelHeight]).toEqual([256, 256])
    expect(asset.name).toBe('Gato de Cabelo Rosa')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    vi.resetModules()
  })

  it('includes the shipped Eclipse avatar when the saved native list does not contain it', async () => {
    const store = await loadStoreWith({ categories: ['Geral'], assets: [] })
    const avatar = store.getState().customAssets.find(a => a.id === 'avatar_other_sliced_guardiao_do_eclipse')!
    expect(avatar.name).toBe('Guardião do Eclipse')
    expect(avatar.avatarSlot).toBe('other')
    expect(avatar.thumbnail).toBe('/assets/avatar/guardiao_do_eclipse/down_0.png')
    for (const frames of Object.values(avatar.directionalFrames!)) {
      expect(frames).toHaveLength(8)
      expect(frames[7]).toBe(frames[0])
    }
  })

  it('repairs old Charmander image paths in native assets and saved edits without replacing the edit', async () => {
    const oldPath = '/assets/avatar/charmander_walk/down_0.png'
    const oldAsset = {
      ...baseAsset, id: 'avatar_pet_sliced_charmander_walk', type: 'avatar', avatarSlot: 'pet',
      name: 'Charmander', thumbnail: oldPath, frames: [oldPath],
      directionalFrames: { down: [oldPath] }, sourceImageSrc: '/assets/pet/charmander_walk.png',
      slicerPresets: [{ directions: { down: [{ dataUrl: oldPath }] } }],
    }
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => key === 'lira_custom_user_assets'
        ? JSON.stringify([{ ...oldAsset, name: 'Meu Charmander', updatedAt: Number.MAX_SAFE_INTEGER }]) : null },
    })
    const store = await loadStoreWith({ categories: ['Geral'], assets: [oldAsset] })
    const pet = store.getState().customAssets.find(a => a.id === oldAsset.id)!
    expect(pet.name).toBe('Meu Charmander')
    expect(pet.thumbnail).toMatch(/^data:image\/png;base64,/)
    expect(pet.sourceImageSrc).toMatch(/^data:image\/png;base64,/)
    expect(pet.frames[0]).toBe(pet.thumbnail)
    expect(pet.directionalFrames!.down).toEqual([pet.thumbnail])
    expect(pet.slicerPresets![0].directions.down[0].dataUrl).toBe(pet.thumbnail)
    expect(pet.petAnimations!.sleep!.frames).toHaveLength(2)
    expect(pet.petAnimations!.yawn!.frames).toHaveLength(9)
  })

  it('loads embedded frames for an already-equipped Charmander with old paths', async () => {
    vi.stubGlobal('Image', class { src = '' })
    await loadStoreWith({ categories: ['Geral'], assets: [] })
    const { getCustomAssetImage } = await import('../../store/useCustomAssetsStore')
    const image = getCustomAssetImage('/assets/avatar/charmander_walk/down_0.png')!
    expect(image.src).toMatch(/^data:image\/png;base64,/)
    expect(getCustomAssetImage(image.src)).toBe(image)
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

  it.each([
    [10, 5, 'Approved'],
    [10, 15, 'User edit'],
    [10, 10, 'User edit'],
  ])('loads the newest revision (native %s, saved %s)', async (nativeTime, savedTime, expectedName) => {
    vi.useFakeTimers()
    const saved = { ...baseAsset, id: 'native_one', name: 'User edit', frames: [SPRITE_TWO], updatedAt: savedTime }
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => key === 'lira_custom_user_assets' ? JSON.stringify([saved]) : null,
      },
    })
    const store = await loadStoreWith({
      categories: ['Geral'],
      assets: [{ ...baseAsset, id: 'native_one', name: 'Approved', frames: [SPRITE_ONE], updatedAt: nativeTime }],
    })
    expect(store.getState().customAssets.find(a => a.id === 'native_one')!.name).toBe(expectedName)
  })

  it('adds shipped characters during an update without dropping client-created characters or categories', async () => {
    vi.useFakeTimers()
    const local = {
      ...baseAsset, id: 'client_avatar', type: 'avatar', avatarSlot: 'other',
      name: 'Meu personagem', category: 'Personagens do cliente', frames: [SPRITE_TWO],
      createdAt: 5, updatedAt: 10,
    }
    const shipped = {
      ...baseAsset, id: 'publisher_avatar', type: 'avatar', avatarSlot: 'other',
      name: 'Novo personagem da atualização', frames: [SPRITE_ONE], createdAt: 20,
    }
    const storage = new Map<string, string>([
      ['lira_custom_user_assets', JSON.stringify([local])],
      ['lira_custom_categories', JSON.stringify(['Personagens do cliente'])],
    ])
    const save = vi.fn(async () => true)
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value) },
      electronAPI: { saveNativeAssets: save },
    })
    const store = await loadStoreWith({ categories: ['Geral'], assets: [shipped] })
    expect(store.getState().customAssets.find(a => a.id === local.id)).toMatchObject(local)
    expect(store.getState().customAssets.find(a => a.id === shipped.id)).toMatchObject(shipped)
    expect(store.getState().customCategories).toContain(local.category)
    const persisted = JSON.parse(storage.get('lira_custom_user_assets')!)
    expect(persisted).toEqual(expect.arrayContaining([expect.objectContaining(local), expect.objectContaining(shipped)]))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      assets: expect.arrayContaining([expect.objectContaining(local), expect.objectContaining(shipped)]),
    }))
    const restarted = await loadStoreWith({ categories: ['Geral'], assets: [shipped] })
    expect(restarted.getState().customAssets.filter(a => a.id === local.id)).toHaveLength(1)
    expect(restarted.getState().customAssets.filter(a => a.id === shipped.id)).toHaveLength(1)
  })

  it('preserves a client character with the same name as a shipped character when their IDs differ', async () => {
    vi.useFakeTimers()
    const local = { ...baseAsset, id: 'client_avatar', name: 'Aventureiro', frames: [SPRITE_TWO] }
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => key === 'lira_custom_user_assets' ? JSON.stringify([local]) : null,
        setItem: vi.fn(),
      },
      electronAPI: { saveNativeAssets: vi.fn(async () => true) },
    })
    const store = await loadStoreWith({ categories: ['Geral'], assets: [
      { ...baseAsset, id: 'publisher_avatar', name: 'Aventureiro', frames: [SPRITE_ONE] },
    ] })
    expect(store.getState().customAssets.find(a => a.id === local.id)!.frames).toEqual([SPRITE_TWO])
    expect(store.getState().customAssets.find(a => a.id === 'publisher_avatar')!.frames).toEqual([SPRITE_ONE])
  })
})
