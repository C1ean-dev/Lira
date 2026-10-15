import manifest from './bundledImageManifest'

const appBase = () => typeof document !== 'undefined' ? document.baseURI : undefined
const hasManifest = Object.keys(manifest.images).length > 0
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}
let activeReads = 0
const waitingReads: Array<() => void> = []
async function limitedRead(load: () => Promise<string>): Promise<string> {
  if (activeReads >= 4) await new Promise<void>(resolve => waitingReads.push(resolve))
  else activeReads++
  try { return await load() }
  finally {
    const next = waitingReads.shift()
    if (next) next()
    else activeReads--
  }
}

function aliasKey(source: string): string | null {
  let relative = source
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)) {
    const base = appBase()
    if (!base) return null
    try {
      const root = new URL('.', base)
      const url = new URL(source, base)
      if (!url.href.startsWith(root.href)) return null
      relative = url.pathname.slice(root.pathname.length)
    } catch { return null }
  }
  try { relative = decodeURIComponent(relative) } catch { return null }
  return '/' + relative.replace(/^\.\//, '').replace(/^\//, '')
}

function mappedSource(source: string, relativeTo?: string): string {
  const key = aliasKey(source)
  if (key && manifest.aliases[key]) return manifest.aliases[key]
  if (relativeTo && !/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(source)) {
    const mappedXml = mappedSource(relativeTo)
    const base = appBase()
    if (base) {
      const image = new URL(source, new URL(mappedXml.replace(/^\//, ''), base)).href
      const relativeKey = aliasKey(image)
      return relativeKey && manifest.aliases[relativeKey] ? manifest.aliases[relativeKey] : image
    }
    const directory = mappedXml.slice(0, mappedXml.lastIndexOf('/') + 1)
    const relativeKey = aliasKey(directory + source)
    return relativeKey && manifest.aliases[relativeKey] ? manifest.aliases[relativeKey] : directory + source
  }
  return source
}

export function resolveBundledAssetUrl(source: string, relativeTo?: string): string {
  if (!source || source.startsWith('data:') || source.startsWith('blob:')) return source
  const mapped = mappedSource(source, relativeTo)
  if (!hasManifest) return source
  const canonical = mapped.replace(/^\.\//, '').replace(/^\//, '')
  const match = /^assets\/images\/([a-f0-9]{64})\.[a-z]+$/.exec(canonical)
  const registered = !!match && manifest.images[match[1]]?.path === canonical
  if (mapped === source && !manifest.aliases[source] && !registered && !relativeTo) return source
  const base = appBase()
  return base ? new URL(mapped.replace(/^\//, ''), base).href : mapped
}

function imageHash(source: string): string | null {
  if (!source || source.startsWith('data:')) return null
  const mapped = mappedSource(source).replace(/^\.\//, '').replace(/^\//, '')
  const match = /(?:^|\/)assets\/images\/([a-f0-9]{64})\.[a-z]+$/.exec(mapped)
  if (!match) return null
  const entry = manifest.images[match[1]]
  if (!entry) return null
  if (mapped === entry.path || source === resolveBundledAssetUrl(entry.path)) return match[1]
  return null
}

export function hasBundledImages(value: unknown): boolean {
  if (!hasManifest) return false
  if (typeof value === 'string') return imageHash(value) !== null
  if (Array.isArray(value)) return value.some(hasBundledImages)
  return isPlainObject(value) && Object.values(value).some(hasBundledImages)
}

export async function toPortableImages<T>(value: T): Promise<T> {
  const reads = new Map<string, Promise<string>>()
  const read = (hash: string) => {
    let pending = reads.get(hash)
    if (!pending) {
      pending = limitedRead(async () => {
        const api = typeof window !== 'undefined' ? window.electronAPI : undefined
        const entry = manifest.images[hash]
        if (api?.readBundledImage) {
          const data = await api.readBundledImage(hash)
          if (!data.startsWith(`data:${entry.mime};base64,`)) throw new Error('Invalid bundled image response')
          return data
        }
        const response = await fetch(resolveBundledAssetUrl(entry.path))
        if (!response.ok) throw new Error('Could not read bundled image')
        const bytes = new Uint8Array(await response.arrayBuffer())
        const chunks: string[] = []
        for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
        return `data:${entry.mime};base64,${btoa(chunks.join(''))}`
      })
      reads.set(hash, pending)
    }
    return pending
  }
  const visit = async (inner: any): Promise<any> => {
    if (typeof inner === 'string') { const hash = imageHash(inner); return hash ? read(hash) : inner }
    if (Array.isArray(inner)) return Promise.all(inner.map(visit))
    if (isPlainObject(inner)) return Object.fromEntries(await Promise.all(Object.entries(inner).map(async ([key, child]) => [key, await visit(child)])))
    return inner
  }
  return visit(value)
}

const snapshot = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(snapshot) as T
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child)])) as T
  return value
}

export function createPortableImageQueue() {
  let tail: Promise<unknown> | null = null
  const enqueue = <T, R>(value: T, apply: (portable: T) => R | Promise<R>): Promise<R> => {
    const captured = snapshot(value)
    let result: Promise<R>
    if (!tail && !hasBundledImages(captured)) {
      try {
        const output = apply(captured)
        if (!output || typeof (output as any).then !== 'function') return Promise.resolve(output as R)
        result = Promise.resolve(output)
      } catch (error) { result = Promise.reject(error) }
    } else result = (tail ?? Promise.resolve()).then(async () => apply(await toPortableImages(captured)))
    const continuation = result.then(() => undefined, () => undefined)
    tail = continuation
    void continuation.then(() => { if (tail === continuation) tail = null })
    return result
  }
  return Object.assign(enqueue, { isPending: () => tail !== null })
}
