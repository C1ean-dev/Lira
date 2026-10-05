/**
 * Turns any value into small, JSON-safe data for a log line or an error report:
 * bounded depth and size, no cycles, no live objects (streams, sockets, DOM
 * nodes are written as `[TheirClass]`). Pure, and never throws.
 */

export interface PlainLimits {
  maxDepth: number
  maxKeys: number
  maxArray: number
  maxString: number
}

export const DEFAULT_PLAIN_LIMITS: PlainLimits = { maxDepth: 4, maxKeys: 40, maxArray: 20, maxString: 500 }

function cutString(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isErrorLike(value: object): value is { name?: unknown; message: string; stack?: unknown; code?: unknown; type?: unknown } {
  if (value instanceof Error) return true
  const v = value as Record<string, unknown>
  return typeof v.message === 'string' && typeof v.stack === 'string'
}

/** `[Peer]`, `[Map(2)]`, `[Uint8Array(480)]`: what the object is, not what is in it. */
function describeObject(value: object): string {
  const name = (value as { constructor?: { name?: string } }).constructor?.name || 'Object'
  if (value instanceof Map || value instanceof Set) return `[${name}(${value.size})]`
  if (ArrayBuffer.isView(value) && typeof (value as unknown as { length?: unknown }).length === 'number') {
    return `[${name}(${(value as unknown as { length: number }).length})]`
  }
  if (value instanceof ArrayBuffer) return `[${name}(${value.byteLength})]`
  return `[${name}]`
}

function walk(value: unknown, depth: number, limits: PlainLimits, ancestors: Set<object>): unknown {
  if (value === null || value === undefined) return value
  switch (typeof value) {
    case 'string':
      return cutString(value, limits.maxString)
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'boolean':
      return value
    case 'bigint':
      return `${value}n`
    case 'symbol':
      return String(value)
    case 'function':
      return `[Function ${value.name || 'anonymous'}]`
  }

  const object = value as object
  if (object instanceof Date) return Number.isNaN(object.getTime()) ? 'Invalid Date' : object.toISOString()
  if (isErrorLike(object)) {
    const out: Record<string, unknown> = {
      name: typeof object.name === 'string' && object.name ? object.name : 'Error',
      message: cutString(String(object.message), limits.maxString),
    }
    const code = object.code ?? object.type
    if (typeof code === 'string' || typeof code === 'number') out.code = code
    return out
  }
  if (ancestors.has(object)) return '[Circular]'

  if (Array.isArray(object)) {
    if (depth > limits.maxDepth) return `[Array(${object.length})]`
    ancestors.add(object)
    const items = object.slice(0, limits.maxArray).map((item) => walk(item, depth + 1, limits, ancestors) ?? null)
    if (object.length > limits.maxArray) items.push(`…(+${object.length - limits.maxArray})`)
    ancestors.delete(object)
    return items
  }

  if (!isPlainObject(object)) return describeObject(object)
  if (depth > limits.maxDepth) return '[Object]'

  ancestors.add(object)
  const out: Record<string, unknown> = {}
  const keys = Object.keys(object)
  for (const key of keys.slice(0, limits.maxKeys)) {
    let item: unknown
    try {
      item = walk((object as Record<string, unknown>)[key], depth + 1, limits, ancestors)
    } catch {
      item = '[Throws]'
    }
    if (item !== undefined) out[key] = item
  }
  if (keys.length > limits.maxKeys) out['…'] = `+${keys.length - limits.maxKeys}`
  ancestors.delete(object)
  return out
}

export function toPlainData(value: unknown, limits: Partial<PlainLimits> = {}): unknown {
  try {
    return walk(value, 1, { ...DEFAULT_PLAIN_LIMITS, ...limits }, new Set())
  } catch {
    return '[Unserializable]'
  }
}

/** The plain version of an object; any other value goes under `value`. Nothing for null/undefined. */
export function toPlainRecord(value: unknown, limits: Partial<PlainLimits> = {}): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined
  const plain = toPlainData(value, limits)
  if (plain && typeof plain === 'object' && !Array.isArray(plain)) return plain as Record<string, unknown>
  return { value: plain }
}
