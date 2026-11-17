import { createStore } from 'zustand/vanilla'
import { persist, type PersistStorage } from 'zustand/middleware'
import type { z } from 'zod'
import { reportStorageFailure } from '../utils/storageReport'

export function getLocalStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null
}

/** A persistent substore keeps high-frequency session updates out of storage.
 * The adapter deliberately preserves the raw JSON format used by existing installs.
 */
export function createStoredState<T>(key: string, schema: z.ZodType<T>, defaults: T,
  options: { onWrite?: (error: unknown | null) => void } = {}) {
  const storage: PersistStorage<T> = {
    getItem() {
      try {
        const raw = getLocalStorage()?.getItem(key)
        if (!raw) return null
        const data: unknown = JSON.parse(raw)
        const value = data && typeof data === 'object' && 'state' in data && 'version' in data ? data.state : data
        const result = schema.safeParse(value)
        if (!result.success) throw result.error
        return { state: result.data, version: 1 }
      } catch (error) { reportStorageFailure('read', key, error); return null }
    },
    setItem(_name, { state }) {
      try {
        const target = getLocalStorage()
        if (!target) throw new Error('Armazenamento local indisponível')
        target.setItem(key, JSON.stringify(state))
        options.onWrite?.(null)
      } catch (error) {
        reportStorageFailure('write', key, error)
        options.onWrite?.(error)
      }
    },
    removeItem() {
      try { getLocalStorage()?.removeItem(key) }
      catch (error) { reportStorageFailure('write', key, error) }
    },
  }
  let current = () => defaults
  return createStore<T>()(persist((_set, get) => { current = get; return defaults }, {
    name: key, storage, version: 1,
    // persist spreads its state before partialize; retain arrays/null exactly.
    partialize: () => current(),
    merge: (saved, current) => saved === undefined ? current :
      Array.isArray(saved) || saved === null ? saved as T : { ...current, ...saved as T },
  }))
}
