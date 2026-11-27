import { fromBase64Url, randomBytes, toBase64Url, utf8Bytes, utf8Decode } from './primitives'
import { getLocalStorage } from '../store/persistedState'

export interface EncryptedDmStorageEnvelope {
  __liraEncV: 1
  mode: 'safeStorage' | 'webcrypto'
  iv?: string
  ciphertext: string
}

const DB_NAME = 'lira-e2ee-dm-storage-v1'
const STORE_NAME = 'keys'
const KEY_ID = 'dm-rest-key'
const LOCAL_STORAGE_KEY_NAME = 'lira_dm_rest_key'
const DM_STORAGE_AAD = utf8Bytes('lira-dm-rest-v1')

let cachedRestKey: CryptoKey | null = null
let pendingRestKey: Promise<CryptoKey> | null = null

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes as Uint8Array<ArrayBuffer>
  }
  return new Uint8Array(bytes)
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto SubtleCrypto API is unavailable')
  }
  return subtle
}

export function isEncryptedDmEnvelope(value: unknown): value is EncryptedDmStorageEnvelope {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EncryptedDmStorageEnvelope>
  if (candidate.__liraEncV !== 1) return false
  if (candidate.mode !== 'safeStorage' && candidate.mode !== 'webcrypto') return false
  if (typeof candidate.ciphertext !== 'string' || candidate.ciphertext.length === 0) return false
  if (candidate.mode === 'webcrypto' && (typeof candidate.iv !== 'string' || candidate.iv.length === 0)) {
    return false
  }
  return true
}

async function readKeyFromIdb(): Promise<CryptoKey | null> {
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
            const val = getReq.result
            resolve(val && typeof val === 'object' ? (val as CryptoKey) : null)
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

async function writeKeyToIdb(key: CryptoKey): Promise<boolean> {
  if (typeof globalThis.indexedDB === 'undefined') return false
  return new Promise((resolve) => {
    try {
      const req = globalThis.indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      req.onerror = () => resolve(false)
      req.onsuccess = () => {
        const db = req.result
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite')
          tx.objectStore(STORE_NAME).put(key, KEY_ID)
          tx.oncomplete = () => {
            try { db.close() } catch {}
            resolve(true)
          }
          tx.onerror = () => {
            try { db.close() } catch {}
            resolve(false)
          }
        } catch {
          try { db.close() } catch {}
          resolve(false)
        }
      }
    } catch {
      resolve(false)
    }
  })
}

async function importRawAesKey(rawBytes: Uint8Array): Promise<CryptoKey> {
  return getSubtle().importKey(
    'raw',
    asBufferSource(rawBytes),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function getOrCreateWebCryptoRestKey(): Promise<CryptoKey> {
  if (cachedRestKey) return cachedRestKey
  if (pendingRestKey) return pendingRestKey

  pendingRestKey = (async () => {
    const idbKey = await readKeyFromIdb()
    if (idbKey) {
      cachedRestKey = idbKey
      return idbKey
    }

    if (typeof globalThis.indexedDB !== 'undefined') {
      const generated = await getSubtle().generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
      const persisted = await writeKeyToIdb(generated)
      if (persisted) {
        cachedRestKey = generated
        return generated
      }
    }

    const storage = getLocalStorage()
    const savedB64 = storage?.getItem(LOCAL_STORAGE_KEY_NAME)
    if (savedB64) {
      try {
        const raw = fromBase64Url(savedB64)
        if (raw.byteLength === 32) {
          const imported = await importRawAesKey(raw)
          cachedRestKey = imported
          return imported
        }
      } catch {}
    }

    const rawBytes = randomBytes(32)
    try {
      storage?.setItem(LOCAL_STORAGE_KEY_NAME, toBase64Url(rawBytes))
    } catch {}
    const imported = await importRawAesKey(rawBytes)
    cachedRestKey = imported
    return imported
  })().finally(() => {
    pendingRestKey = null
  })

  return pendingRestKey
}

async function canUseElectronSafeStorage(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const api = window.electronAPI
  if (!api?.secureStorageAvailable || !api?.secureStorageEncrypt) return false
  try {
    return Boolean(await api.secureStorageAvailable())
  } catch {
    return false
  }
}

/**
 * Encrypts serialized DM history for local persistence at rest.
 * Prefers Electron OS-backed safeStorage when available, falling back to local AES-256-GCM WebCrypto.
 */
export async function encryptDmPayload(plaintextJson: string): Promise<EncryptedDmStorageEnvelope> {
  if (await canUseElectronSafeStorage()) {
    const ciphertext = await window.electronAPI!.secureStorageEncrypt!(plaintextJson)
    if (typeof ciphertext === 'string' && ciphertext.length > 0) {
      return {
        __liraEncV: 1,
        mode: 'safeStorage',
        ciphertext,
      }
    }
  }

  const key = await getOrCreateWebCryptoRestKey()
  const iv = randomBytes(12)
  const encrypted = await getSubtle().encrypt(
    {
      name: 'AES-GCM',
      iv: asBufferSource(iv),
      tagLength: 128,
      additionalData: asBufferSource(DM_STORAGE_AAD),
    },
    key,
    asBufferSource(utf8Bytes(plaintextJson))
  )

  return {
    __liraEncV: 1,
    mode: 'webcrypto',
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(encrypted)),
  }
}

/**
 * Decrypts a local encrypted DM storage envelope back into serialized JSON.
 */
export async function decryptDmPayload(envelope: EncryptedDmStorageEnvelope): Promise<string> {
  if (envelope.mode === 'safeStorage') {
    const decryptFn = typeof window !== 'undefined' ? window.electronAPI?.secureStorageDecrypt : undefined
    if (!decryptFn) {
      throw new Error('Electron safeStorage decrypt API is unavailable')
    }
    const plaintext = await decryptFn(envelope.ciphertext)
    if (typeof plaintext !== 'string') {
      throw new Error('Electron safeStorage failed to decrypt DM history')
    }
    return plaintext
  }

  if (!envelope.iv) {
    throw new Error('Missing IV for WebCrypto DM storage envelope')
  }
  const key = await getOrCreateWebCryptoRestKey()
  const iv = fromBase64Url(envelope.iv)
  const ciphertext = fromBase64Url(envelope.ciphertext)
  const decrypted = await getSubtle().decrypt(
    {
      name: 'AES-GCM',
      iv: asBufferSource(iv),
      tagLength: 128,
      additionalData: asBufferSource(DM_STORAGE_AAD),
    },
    key,
    asBufferSource(ciphertext)
  )
  return utf8Decode(new Uint8Array(decrypted))
}

export function resetDmStorageCryptoForTests(): void {
  cachedRestKey = null
  pendingRestKey = null
}
