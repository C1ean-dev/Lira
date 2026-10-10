import { reportError } from './logger'

interface StorageLike {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
}

export interface StorageUsage {
  keys: number
  totalChars: number
  largest: { key: string; chars: number }[]
}

const LARGEST_KEYS = 5

export function measureStorage(storage: StorageLike | null | undefined): StorageUsage | undefined {
  try {
    if (!storage) return undefined
    const sizes: { key: string; chars: number }[] = []
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key === null) continue
      sizes.push({ key, chars: key.length + (storage.getItem(key)?.length ?? 0) })
    }
    return {
      keys: sizes.length,
      totalChars: sizes.reduce((total, entry) => total + entry.chars, 0),
      largest: sizes
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => b.entry.chars - a.entry.chars || a.index - b.index)
        .slice(0, LARGEST_KEYS)
        .map(({ entry }) => entry),
    }
  } catch {
    return undefined
  }
}

function currentStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? (localStorage as unknown as StorageLike) : null
  } catch {
    return null
  }
}

export function reportStorageFailure(
  action: 'read' | 'write',
  key: string,
  error: unknown,
  details: Record<string, unknown> = {}
): void {
  try {
    const usage = action === 'write' ? measureStorage(currentStorage()) : undefined
    reportError(error, {
      scope: 'Storage',
      message: `could not ${action} ${key}`,
      data: { action, key, ...details, ...(usage ? { storage: usage } : {}) },
    })
  } catch {
  }
}
