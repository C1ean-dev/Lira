const KEY_FP_RE = /^[a-f0-9]{64}$/

const SAS_EMOJIS = [
  '🔑', '🛡️', '🌙', '⭐', '🔥', '💧', '🍀', '🦊',
  '🦉', '🐺', '🐝', '🦋', '🐢', '🐳', '🐙', '🌵',
  '🌸', '🍎', '🍋', '🍇', '🍉', '🔔', '🧭', '⚓',
  '🚀', '🎯', '🎲', '🎸', '💎', '🏔️', '⚡', '☀️',
] as const

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto SubtleCrypto API is unavailable in this environment')
  }
  return subtle
}

function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes as Uint8Array<ArrayBuffer>
  }
  return new Uint8Array(bytes)
}

export function utf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text))
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(length)
  globalThis.crypto.getRandomValues(buf)
  return buf
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

export function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

export function constantTimeEqual(a: string | Uint8Array, b: string | Uint8Array): boolean {
  const left = typeof a === 'string' ? utf8Bytes(a) : a
  const right = typeof b === 'string' ? utf8Bytes(b) : b
  const maxLen = Math.max(left.length, right.length)
  let diff = left.length ^ right.length
  for (let i = 0; i < maxLen; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  }
  return diff === 0
}

export function isValidKeyFingerprint(value: unknown): value is string {
  return typeof value === 'string' && KEY_FP_RE.test(value)
}

export function formatShortFingerprint(hex64: string): string {
  const clean = hex64.toUpperCase().replace(/[^A-F0-9]/g, '')
  const groups: string[] = []
  for (let i = 0; i < clean.length; i += 4) {
    groups.push(clean.slice(i, i + 4))
  }
  return groups.join(' ')
}

export async function sha256(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const digest = await getSubtle().digest('SHA-256', asBufferSource(data))
  return new Uint8Array(digest)
}

export async function generateIdentityKeyPair(): Promise<CryptoKeyPair> {
  return getSubtle().generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify']
  )
}

export async function exportPublicKeyRaw(pub: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await getSubtle().exportKey('raw', pub)
  return new Uint8Array(raw)
}

export async function exportPublicKeyB64(pub: CryptoKey): Promise<string> {
  return toBase64Url(await exportPublicKeyRaw(pub))
}

export async function importIdentityPublicKey(b64: string): Promise<CryptoKey> {
  return getSubtle().importKey(
    'raw',
    fromBase64Url(b64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  )
}

export async function computeKeyFingerprint(pubB64OrBytes: string | Uint8Array): Promise<string> {
  const raw = typeof pubB64OrBytes === 'string' ? fromBase64Url(pubB64OrBytes) : pubB64OrBytes
  return toHex(await sha256(raw))
}

export async function signData(priv: CryptoKey, data: Uint8Array): Promise<string> {
  const sig = await getSubtle().sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    priv,
    asBufferSource(data)
  )
  return toBase64Url(new Uint8Array(sig))
}

export async function verifySignature(pub: CryptoKey, sigB64: string, data: Uint8Array): Promise<boolean> {
  try {
    return await getSubtle().verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      fromBase64Url(sigB64),
      asBufferSource(data)
    )
  } catch {
    return false
  }
}

export async function generateEphemeralKeyPair(): Promise<CryptoKeyPair> {
  return getSubtle().generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )
}

export async function importEphemeralPublicKey(b64: string): Promise<CryptoKey> {
  return getSubtle().importKey(
    'raw',
    fromBase64Url(b64),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  )
}

export async function deriveEcdhBits(priv: CryptoKey, peerPub: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const bits = await getSubtle().deriveBits(
    { name: 'ECDH', public: peerPub },
    priv,
    256
  )
  return new Uint8Array(bits)
}

export async function hkdfDeriveBytes(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  lengthBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  const baseKey = await getSubtle().importKey('raw', asBufferSource(ikm), 'HKDF', false, ['deriveBits'])
  const bits = await getSubtle().deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: asBufferSource(salt),
      info: utf8Bytes(info),
    },
    baseKey,
    lengthBytes * 8
  )
  return new Uint8Array(bits)
}

export async function deriveSas(
  rootKey: Uint8Array,
  transcriptHash: Uint8Array
): Promise<{ code: string; emojis: string[] }> {
  const bytes = await hkdfDeriveBytes(rootKey, transcriptHash, 'lira-e2ee-v1-sas', 12)
  const digits: string[] = []
  for (let i = 0; i < 6; i++) {
    const val = ((bytes[i * 2] << 8) | bytes[i * 2 + 1]) % 100000
    digits.push(String(val).padStart(5, '0'))
  }
  const emojis = [
    SAS_EMOJIS[bytes[0] % SAS_EMOJIS.length],
    SAS_EMOJIS[bytes[3] % SAS_EMOJIS.length],
    SAS_EMOJIS[bytes[6] % SAS_EMOJIS.length],
    SAS_EMOJIS[bytes[9] % SAS_EMOJIS.length],
  ]
  return { code: digits.join(' '), emojis }
}

const utf8Decoder = new TextDecoder()

export function utf8Decode(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes)
}

export async function importAesGcmKey(rawKey: Uint8Array): Promise<CryptoKey> {
  if (rawKey.byteLength !== 32) {
    throw new Error(`Invalid AES-256-GCM key length: ${rawKey.byteLength}`)
  }
  return getSubtle().importKey(
    'raw',
    asBufferSource(rawKey),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function aesGcmEncrypt(
  rawKey: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array
): Promise<{ ivB64: string; ciphertextB64: string }> {
  const key = await importAesGcmKey(rawKey)
  const iv = randomBytes(12)
  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: asBufferSource(iv),
    tagLength: 128,
    ...(aad ? { additionalData: asBufferSource(aad) } : {}),
  }
  const encrypted = await getSubtle().encrypt(params, key, asBufferSource(plaintext))
  return {
    ivB64: toBase64Url(iv),
    ciphertextB64: toBase64Url(new Uint8Array(encrypted)),
  }
}

export async function aesGcmDecrypt(
  rawKey: Uint8Array,
  ivB64: string,
  ciphertextB64: string,
  aad?: Uint8Array
): Promise<Uint8Array> {
  const iv = fromBase64Url(ivB64)
  if (iv.byteLength !== 12) {
    throw new Error(`Invalid AES-GCM IV length: ${iv.byteLength}`)
  }
  const ciphertext = fromBase64Url(ciphertextB64)
  const key = await importAesGcmKey(rawKey)
  const params: AesGcmParams = {
    name: 'AES-GCM',
    iv: asBufferSource(iv),
    tagLength: 128,
    ...(aad ? { additionalData: asBufferSource(aad) } : {}),
  }
  const decrypted = await getSubtle().decrypt(params, key, asBufferSource(ciphertext))
  return new Uint8Array(decrypted)
}

export async function deriveChainStep(
  chainKey: Uint8Array,
  infoPrefix: string
): Promise<{ nextChainKey: Uint8Array; messageKey: Uint8Array }> {
  const material = await hkdfDeriveBytes(
    chainKey,
    new Uint8Array(0),
    infoPrefix,
    64
  )
  return {
    nextChainKey: material.slice(0, 32),
    messageKey: material.slice(32, 64),
  }
}

