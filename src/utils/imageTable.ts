
const IMAGE_PREFIX = 'data:image/'
const REF_PREFIX = '@'
const TABLE_KEY = 'images'

export const MIN_IMAGE_LENGTH = 128

export interface PackOptions {
  transform?: (dataUrl: string) => string
  hash?: (dataUrl: string) => string
}

type Tree = Record<string, unknown>

const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value)

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

export function packImages(root: Tree, options: PackOptions = {}): Tree {
  if (Object.prototype.hasOwnProperty.call(root, TABLE_KEY)) {
    throw new Error(`packImages: the root already has an "${TABLE_KEY}" key`)
  }
  const transform = options.transform ?? ((url: string) => url)
  const hash = options.hash ?? hashDataUrl

  const table = new Map<string, string>()
  const idOfInput = new Map<string, string>()

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
  const sorted = [...table.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  packed[TABLE_KEY] = Object.fromEntries(sorted)
  return packed
}

const isPackableImage = (value: string) => value.length >= MIN_IMAGE_LENGTH && value.startsWith(IMAGE_PREFIX)

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
  pause: () => Promise<void>
  budgetMs?: number
  now?: () => number
}

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
