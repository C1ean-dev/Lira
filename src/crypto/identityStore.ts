import {
  computeKeyFingerprint,
  exportPublicKeyB64,
  generateIdentityKeyPair,
} from './primitives'
import { useSecurityStore } from '../store/useSecurityStore'

export interface LocalIdentity {
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyB64: string
  fingerprint: string
}

const DB_NAME = 'lira-e2ee-identity-v1'
const STORE_NAME = 'keys'
const KEY_ID = 'local-identity'

interface StoredRecord {
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyB64: string
  fingerprint: string
}

let cachedIdentity: LocalIdentity | null = null
let pendingLoad: Promise<LocalIdentity> | null = null

async function readFromIdb(): Promise<StoredRecord | null> {
  if (typeof globalThis.indexedDB === 'undefined') return null
  return new Promise((resolve) => {
    try {
      const req = globalThis.indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      req.onerror = () => resolve(null)
      req.onsuccess = () => {
        const db = req.result
        try {
          const tx = db.transaction(STORE_NAME, 'readonly')
          const getReq = tx.objectStore(STORE_NAME).get(KEY_ID)
          getReq.onsuccess = () => {
            const val = getReq.result as StoredRecord | undefined
            if (val?.publicKey && val?.privateKey && typeof val.publicKeyB64 === 'string' && typeof val.fingerprint === 'string') {
              resolve(val)
            } else {
              resolve(null)
            }
          }
          getReq.onerror = () => resolve(null)
          tx.oncomplete = () => { try { db.close() } catch {} }
        } catch {
          try { db.close() } catch {}
          resolve(null)
        }
      }
    } catch {
      resolve(null)
    }
  })
}

async function writeToIdb(record: StoredRecord): Promise<void> {
  if (typeof globalThis.indexedDB === 'undefined') return
  return new Promise((resolve) => {
    try {
      const req = globalThis.indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      req.onerror = () => resolve()
      req.onsuccess = () => {
        const db = req.result
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite')
          tx.objectStore(STORE_NAME).put(record, KEY_ID)
          tx.oncomplete = () => {
            try { db.close() } catch {}
            resolve()
          }
          tx.onerror = () => {
            try { db.close() } catch {}
            resolve()
          }
        } catch {
          try { db.close() } catch {}
          resolve()
        }
      }
    } catch {
      resolve()
    }
  })
}

export async function createEphemeralIdentityForTests(): Promise<LocalIdentity> {
  const pair = await generateIdentityKeyPair()
  const publicKeyB64 = await exportPublicKeyB64(pair.publicKey)
  const fingerprint = await computeKeyFingerprint(publicKeyB64)
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyB64,
    fingerprint,
  }
}

export async function getLocalIdentity(): Promise<LocalIdentity> {
  if (cachedIdentity) return cachedIdentity
  if (pendingLoad) return pendingLoad

  pendingLoad = (async () => {
    const stored = await readFromIdb()
    if (stored) {
      cachedIdentity = stored
    } else {
      const created = await createEphemeralIdentityForTests()
      cachedIdentity = created
      await writeToIdb(created)
    }
    try {
      useSecurityStore.getState().setLocalIdentity(cachedIdentity.publicKeyB64, cachedIdentity.fingerprint)
    } catch {}
    return cachedIdentity
  })().finally(() => {
    pendingLoad = null
  })

  return pendingLoad
}

export function getCachedLocalIdentity(): LocalIdentity | null {
  return cachedIdentity
}

export function resetLocalIdentityForTests(): void {
  cachedIdentity = null
  pendingLoad = null
}
