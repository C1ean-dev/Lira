// Table of images for the native data files (src/data/nativeAssets.json).
//
// An asset keeps the same picture in several fields (frames, directionalFrames,
// slicerPresets, the editor's layers, thumbnail...) and each copy used to be a
// whole base64 data URL: 41% of the file was repeats. On disk every distinct
// image is now written once, in a top-level "images" table, and the fields that
// use it hold a reference, "@<id>":
//
//   { "categories": [...],
//     "assets": [{ "frames": ["@k3f9a0b1c2d"] }],
//     "images": { "k3f9a0b1c2d": "data:image/png;base64,..." } }
//
// Reading expands the references back into the data URLs the rest of the app
// works with, so nothing else has to know about the table.
//
// - The id comes from the content of the image, so it does not depend on the
//   order of the assets and an image that did not change keeps its id.
// - Text that starts with "@" is written with one more "@", so it can never be
//   taken for a reference.
// - A file with no "images" table is the old format and is returned as it is.

const IMAGE_PREFIX = 'data:image/'
const REF_PREFIX = '@'
const TABLE_KEY = 'images'

/** Shorter strings gain nothing from a reference. */
export const MIN_IMAGE_LENGTH = 128

export interface PackOptions {
  /** Called once for each distinct image; what it returns is what gets stored. */
  transform?: (dataUrl: string) => string
  /** Names an image from the content that gets stored. Replaceable so tests can force a collision. */
  hash?: (dataUrl: string) => string
}

type Tree = Record<string, unknown>

const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value)

/** 53-bit hash of the text (cyrb53), in base 36. */
export function hashDataUrl(dataUrl: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < dataUrl.length; i++) {
    const ch = dataUrl.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Moves every image of `root` into a table and leaves a reference in its place. `root` is not changed. */
export function packImages(root: Tree, options: PackOptions = {}): Tree {
  if (Object.prototype.hasOwnProperty.call(root, TABLE_KEY)) {
    throw new Error(`packImages: the root already has an "${TABLE_KEY}" key`)
  }
  const transform = options.transform ?? ((url: string) => url)
  const hash = options.hash ?? hashDataUrl

  const table = new Map<string, string>() // id -> stored image
  const idOfInput = new Map<string, string>() // image as found -> id, so a copy is not transformed again

  const refFor = (url: string): string => {
    let id = idOfInput.get(url)
    if (id === undefined) {
      const stored = transform(url)
      const base = hash(stored)
      id = base
      for (let n = 1; table.has(id) && table.get(id) !== stored; n++) id = `${base}-${n}`
      table.set(id, stored)
      idOfInput.set(url, id)
    }
    return REF_PREFIX + id
  }

  const pack = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (isPackableImage(value)) return refFor(value)
      return value.startsWith(REF_PREFIX) ? REF_PREFIX + value : value
    }
    if (Array.isArray(value)) return value.map(pack)
    if (isTree(value)) {
      const out: Tree = {}
      for (const [key, inner] of Object.entries(value)) out[key] = pack(inner)
      return out
    }
    return value
  }

  const packed = pack(root) as Tree
  // Sorted, so the table does not move around when the assets are reordered.
  const sorted = [...table.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  packed[TABLE_KEY] = Object.fromEntries(sorted)
  return packed
}

const isPackableImage = (value: string) => value.length >= MIN_IMAGE_LENGTH && value.startsWith(IMAGE_PREFIX)

/** The distinct images of `root` that packImages puts in the table, in the order they first appear. */
export function collectImages(root: Tree): string[] {
  const found = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (isPackableImage(value)) found.add(value)
    } else if (Array.isArray(value)) {
      value.forEach(visit)
    } else if (isTree(value)) {
      Object.values(value).forEach(visit)
    }
  }
  visit(root)
  return [...found]
}

export interface PackAsyncOptions extends PackOptions {
  /** Called between images when the time slice is used up; lets the event loop run. */
  pause: () => Promise<void>
  /** How long to work before pausing. Default 8 ms. */
  budgetMs?: number
  now?: () => number
}

/**
 * packImages for a transform that is slow (re-encoding images): the same result, but the work is done
 * in time slices with a pause between them, so a process that also has other things to do stays responsive.
 */
export async function packImagesAsync(root: Tree, options: PackAsyncOptions): Promise<Tree> {
  const { pause, budgetMs = 8, now = () => performance.now() } = options
  const transform = options.transform ?? ((url: string) => url)

  const stored = new Map<string, string>()
  const urls = collectImages(root)
  let sliceStart = now()
  for (let i = 0; i < urls.length; i++) {
    stored.set(urls[i], transform(urls[i]))
    if (i < urls.length - 1 && now() - sliceStart >= budgetMs) {
      await pause()
      sliceStart = now()
    }
  }
  return packImages(root, { hash: options.hash, transform: (url) => stored.get(url) ?? url })
}

/** Gives every reference its image back and drops the table. A file with no table is returned as it is. */
export function unpackImages(root: Tree): Tree {
  const table = root[TABLE_KEY]
  if (!isTree(table)) return root

  const unpack = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (!value.startsWith(REF_PREFIX)) return value
      if (value.startsWith(REF_PREFIX + REF_PREFIX)) return value.slice(1)
      const id = value.slice(1)
      const stored = Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined
      return typeof stored === 'string' ? stored : value
    }
    if (Array.isArray(value)) return value.map(unpack)
    if (isTree(value)) {
      const out: Tree = {}
      for (const [key, inner] of Object.entries(value)) out[key] = unpack(inner)
      return out
    }
    return value
  }

  const { [TABLE_KEY]: _table, ...rest } = root
  return unpack(rest) as Tree
}
