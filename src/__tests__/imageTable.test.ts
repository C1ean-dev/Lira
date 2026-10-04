import { describe, it, expect } from 'vitest'
import { packImages, packImagesAsync, collectImages, unpackImages, hashDataUrl, MIN_IMAGE_LENGTH } from '../utils/imageTable'
import nativeAssets from '../data/nativeAssets.json'

type Tree = Record<string, unknown>

// A data URL long enough to be worth a reference; `tag` makes each one different.
const image = (tag: string) => `data:image/png;base64,${tag}${'A'.repeat(300)}`
const A = image('a')
const B = image('b')
const C = image('c')

const asset = (id: string, extra: Tree = {}): Tree => ({
  id,
  name: id,
  frames: [A],
  thumbnail: A,
  directionalFrames: { down: [A, B], up: [A], left: B },
  ...extra,
})

const sample = (): Tree => ({
  categories: ['Geral'],
  assets: [asset('one'), asset('two', { thumbnail: C })],
})

/** Every string value in the tree (keys are not included). */
function strings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) value.forEach((v) => strings(v, into))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, into))
  return into
}

const longImages = (value: unknown) => strings(value).filter((s) => s.startsWith('data:image/') && s.length >= MIN_IMAGE_LENGTH)

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

const tableOf = (packed: Tree) => packed.images as Record<string, string>
const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value))

describe('packImages', () => {
  it('keeps each distinct image once and replaces every copy by a reference', () => {
    const packed = packImages(sample())

    expect(Object.values(tableOf(packed)).sort()).toEqual([A, B, C].sort())
    expect(longImages({ ...packed, images: {} })).toEqual([])
    const refs = strings({ ...packed, images: {} }).filter((s) => s.startsWith('@'))
    expect(refs.length).toBe(strings(sample()).filter((s) => s.startsWith('data:image/')).length)
    refs.forEach((ref) => expect(tableOf(packed)).toHaveProperty([ref.slice(1)]))
  })

  it('puts the table last and keeps the other keys in their order', () => {
    const root = { categories: ['Geral'], assets: [], extra: 1 }
    expect(Object.keys(packImages(root))).toEqual(['categories', 'assets', 'extra', 'images'])
  })

  it('always writes the table, even when there is no image', () => {
    expect(packImages({ categories: ['a'] })).toEqual({ categories: ['a'], images: {} })
  })

  it('names an image after its content, whatever its position or its neighbours', () => {
    const first = packImages({ assets: [{ a: A }, { b: B }] })
    const reordered = packImages({ assets: [{ c: C }, { b: B }, { a: A }] })
    const ids = (packed: Tree) => Object.entries(tableOf(packed)).map(([id, url]) => [url, id])
    const idOf = (packed: Tree, url: string) => Object.fromEntries(ids(packed))[url]

    expect(idOf(reordered, A)).toBe(idOf(first, A))
    expect(idOf(reordered, B)).toBe(idOf(first, B))
    expect(idOf(first, A)).toBe(hashDataUrl(A))
  })

  it('writes the table in the same order whatever the order of the assets (stable diffs)', () => {
    const forward = packImages({ assets: [{ x: A }, { x: B }, { x: C }] })
    const backward = packImages({ assets: [{ x: C }, { x: B }, { x: A }] })
    expect(Object.keys(tableOf(forward))).toEqual(Object.keys(tableOf(backward)))
  })

  it('leaves alone what is not worth a reference: short data URLs, other kinds of data, plain text', () => {
    const inline = {
      short: 'data:image/png;base64,AAAA',
      notAnImage: `data:text/plain;base64,${'T'.repeat(300)}`,
      text: 'Cadeira azul',
      empty: '',
    }
    const packed = packImages({ inline })
    expect(packed.inline).toEqual(inline)
    expect(tableOf(packed)).toEqual({})
  })

  it('stores images of any type in the table', () => {
    const webp = `data:image/webp;base64,${'W'.repeat(300)}`
    const packed = packImages({ frames: [webp, A] })
    expect(Object.values(tableOf(packed)).sort()).toEqual([A, webp].sort())
  })

  it('escapes text that starts with "@" so it can never be taken for a reference', () => {
    const lookalike = `@${hashDataUrl(A)}`
    const root = { names: ['@home', '@', '@@x', lookalike], frames: [A] }
    const packed = packImages(root)

    expect(packed.names).toEqual(['@@home', '@@', '@@@x', `@${lookalike}`])
    expect(unpackImages(packed)).toEqual(root)
  })

  it('gives two images that hash alike two different names', () => {
    const packed = packImages({ x: [A, B, A] }, { hash: () => 'same' })
    expect(Object.keys(tableOf(packed)).sort()).toEqual(['same', 'same-1'])
    expect(unpackImages(packed)).toEqual({ x: [A, B, A] })
  })

  it('stores what the transform returns, once per distinct image', () => {
    const calls: string[] = []
    const packed = packImages(
      { x: [A, B, A] },
      {
        transform: (url) => {
          calls.push(url)
          return C
        },
      }
    )
    expect(calls).toEqual([A, B])
    expect(Object.values(tableOf(packed))).toEqual([C])
    expect(unpackImages(packed)).toEqual({ x: [C, C, C] })
  })

  it('does not touch what it is given', () => {
    const frozen = deepFreeze(sample())
    expect(() => packImages(frozen)).not.toThrow()
    expect(frozen).toEqual(sample())
  })

  it('refuses a root that already has an "images" key, since it could not be told from the table', () => {
    expect(() => packImages({ images: {} })).toThrow(/images/)
  })

  it('accepts an "images" key deeper in the tree', () => {
    const root = { assets: [{ images: [A, A], name: 'x' }] }
    expect(unpackImages(packImages(root))).toEqual(root)
  })
})

describe('unpackImages', () => {
  it('gives back exactly what was packed, also through JSON text', () => {
    const packed = packImages(sample())
    expect(unpackImages(packed)).toEqual(sample())
    expect(unpackImages(roundTrip(packed))).toEqual(sample())
  })

  it('takes the table out of the result', () => {
    expect(unpackImages(packImages(sample()))).not.toHaveProperty('images')
  })

  it('leaves a file in the old format (no table) as it is, "@" text included', () => {
    const legacy = { categories: ['@x'], assets: [{ name: '@home', frames: [A] }] }
    expect(unpackImages(legacy)).toEqual(legacy)
  })

  it('leaves a reference to a missing image, and a damaged table entry, as they are', () => {
    expect(unpackImages({ images: { a: A, n: 5 }, frames: ['@a', '@missing', '@n', '@@a'] })).toEqual({
      frames: [A, '@missing', '@n', '@a'],
    })
  })

  it('does not take names such as "constructor" for table entries', () => {
    expect(unpackImages({ images: {}, frames: ['@constructor', '@__proto__', '@toString'] })).toEqual({
      frames: ['@constructor', '@__proto__', '@toString'],
    })
  })

  it('does not touch what it is given', () => {
    const frozen = deepFreeze(roundTrip(packImages(sample())))
    expect(() => unpackImages(frozen)).not.toThrow()
  })

  it('keeps numbers, booleans, null and nesting as they are', () => {
    const root = { a: [1, 2.5, -3, true, false, null, [[], {}], { b: [0] }], c: { d: null } }
    expect(unpackImages(packImages(root))).toEqual(root)
  })
})

// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const POOL = [
  A,
  B,
  C,
  `data:image/webp;base64,${'W'.repeat(200)}`,
  `data:text/plain;base64,${'T'.repeat(200)}`,
  'data:image/png;base64,short',
  '',
  'plain',
  '@',
  '@@',
  '@x',
  '@@x',
  `@${hashDataUrl(A)}`,
  `@@${hashDataUrl(B)}`,
  'x'.repeat(300),
]
const KEYS = ['a', 'b', 'frames', 'images', 'name', '@odd', '']

function randomValue(rand: () => number, depth: number): unknown {
  const pick = rand()
  if (depth > 0 && pick < 0.25) {
    return Array.from({ length: Math.floor(rand() * 5) }, () => randomValue(rand, depth - 1))
  }
  if (depth > 0 && pick < 0.5) {
    const obj: Tree = {}
    for (let i = Math.floor(rand() * 5); i > 0; i--) obj[KEYS[Math.floor(rand() * KEYS.length)]] = randomValue(rand, depth - 1)
    return obj
  }
  if (pick < 0.85) return POOL[Math.floor(rand() * POOL.length)]
  const scalars = [0, 1, -7, 3.25, true, false, null]
  return scalars[Math.floor(rand() * scalars.length)]
}

function randomRoot(rand: () => number): Tree {
  const root: Tree = {}
  for (let i = 1 + Math.floor(rand() * 4); i > 0; i--) {
    const key = KEYS[Math.floor(rand() * KEYS.length)]
    if (key !== 'images') root[key] = randomValue(rand, 4)
  }
  return root
}

describe('pack then unpack, on random data', () => {
  it('gives back the input every time, with no long image left outside the table', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const root = randomRoot(mulberry32(seed))
      const packed = packImages(root)
      expect(unpackImages(packed), `seed ${seed}`).toEqual(root)
      expect(unpackImages(roundTrip(packed)), `seed ${seed} through JSON`).toEqual(root)
      expect(longImages({ ...packed, images: {} }), `seed ${seed}`).toEqual([])
    }
  })

  it('never changes what it is given', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const root = deepFreeze(randomRoot(mulberry32(seed)))
      expect(() => unpackImages(packImages(root)), `seed ${seed}`).not.toThrow()
    }
  })
})

describe('collectImages', () => {
  it('lists each distinct image once, in the order it first appears', () => {
    expect(collectImages(sample())).toEqual([A, B, C])
  })

  it('leaves out what packImages would leave inline', () => {
    const root = {
      short: 'data:image/png;base64,AAAA',
      other: `data:text/plain;base64,${'T'.repeat(300)}`,
      text: '@home',
      real: [A, A],
    }
    expect(collectImages(root)).toEqual([A])
  })

  it('finds nothing in data without images', () => {
    expect(collectImages({ categories: ['Geral'], n: 1, nested: { list: [null, true] } })).toEqual([])
  })
})

describe('packImagesAsync', () => {
  const never = () => Promise.resolve()

  it('gives exactly what packImages gives', async () => {
    const options = { transform: (url: string) => url.replace('AAAA', 'BBBB') }
    expect(await packImagesAsync(sample(), { ...options, pause: never })).toEqual(packImages(sample(), options))
    for (let seed = 1; seed <= 40; seed++) {
      const root = randomRoot(mulberry32(seed))
      expect(await packImagesAsync(root, { pause: never }), `seed ${seed}`).toEqual(packImages(root))
    }
  })

  it('transforms each distinct image once, in the order they first appear', async () => {
    const calls: string[] = []
    await packImagesAsync(sample(), {
      pause: never,
      transform: (url) => {
        calls.push(url)
        return url
      },
    })
    expect(calls).toEqual([A, B, C])
  })

  it('gives the event loop a turn between images once its time slice is used up', async () => {
    let clock = 0
    let pauses = 0
    await packImagesAsync(sample(), {
      budgetMs: 5,
      now: () => clock,
      transform: (url) => {
        clock += 6 // every image takes longer than the slice
        return url
      },
      pause: async () => {
        pauses++
      },
    })
    expect(pauses).toBe(2) // between 3 images, not after the last
  })

  it('does not pause while it stays inside the slice', async () => {
    let clock = 0
    let pauses = 0
    await packImagesAsync(sample(), {
      budgetMs: 100,
      now: () => clock,
      transform: (url) => {
        clock += 1
        return url
      },
      pause: async () => {
        pauses++
      },
    })
    expect(pauses).toBe(0)
  })

  it('starts a new slice after each pause', async () => {
    let clock = 0
    let pauses = 0
    await packImagesAsync(
      { x: [A, B, C, image('d'), image('e')] },
      {
        budgetMs: 10,
        now: () => clock,
        transform: (url) => {
          clock += 6 // two images fill a slice
          return url
        },
        pause: async () => {
          pauses++
        },
      }
    )
    expect(pauses).toBe(2) // after the 2nd and the 4th of 5
  })

  it('does not touch what it is given', async () => {
    const frozen = deepFreeze(sample())
    await expect(packImagesAsync(frozen, { pause: never })).resolves.toBeDefined()
    expect(frozen).toEqual(sample())
  })

  it('refuses a root that already has an "images" key, as packImages does', async () => {
    await expect(packImagesAsync({ images: {} }, { pause: never })).rejects.toThrow(/images/)
  })
})

describe('the data file shipped in the repo', () => {
  const expanded = unpackImages(nativeAssets as unknown as Tree)

  it('survives pack and unpack unchanged, whichever format it is in', () => {
    const packed = packImages(expanded)
    expect(unpackImages(roundTrip(packed))).toEqual(expanded)
  })

  it('has each image once after packing, and that is not bigger than the expanded form', () => {
    const packed = packImages(expanded)
    expect(longImages({ ...packed, images: {} })).toEqual([])
    expect(JSON.stringify(packed).length).toBeLessThanOrEqual(JSON.stringify(expanded).length)
  })
})
