import { hkdfDeriveBytes, importAesGcmKey, utf8Bytes } from './primitives'

export const SFRAME_MAGIC_0 = 0x53 // 'S'
export const SFRAME_MAGIC_1 = 0x46 // 'F'
export const SFRAME_MAGIC_H264_1 = 0x48 // 'H'
export const SFRAME_MAGIC = (SFRAME_MAGIC_0 << 8) | SFRAME_MAGIC_1
export const SFRAME_TRAILER_BYTES = 8 // counter(4) + kid(1) + prefixLen(1) + magic(2)
export const SFRAME_TAG_BYTES = 16
export const SFRAME_MIN_FRAME_BYTES = SFRAME_TAG_BYTES + SFRAME_TRAILER_BYTES
export const SFRAME_REPLAY_WINDOW = 1024
export const MAX_SFRAME_COUNTER = 0xffffffff

export type SFrameMediaKind = 'audio' | 'video'

export interface SFrameKeyMaterial {
  kid: number
  rawKey: Uint8Array
  salt: Uint8Array
  cryptoKey?: CryptoKey
}

interface RecvKeyState {
  kid: number
  cryptoKey: CryptoKey
  salt: Uint8Array
  maxCounter: number
  seen: Set<number>
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto API unavailable for SFrame')
  }
  return subtle
}

function toArrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  out.set(bytes)
  return out
}

export async function deriveMediaKeyMaterial(
  rootKey: Uint8Array,
  senderId: string,
  recipientId: string,
  kid = 0,
  label = 'lira-sframe-v1'
): Promise<{ kid: number; rawKey: Uint8Array; salt: Uint8Array }> {
  const normalizedKid = kid & 0xff
  const material = await hkdfDeriveBytes(
    rootKey,
    utf8Bytes(`${label}|${senderId}|${recipientId}|${normalizedKid}`),
    'lira-sframe-key-salt',
    44
  )
  return {
    kid: normalizedKid,
    rawKey: material.slice(0, 32),
    salt: material.slice(32, 44),
  }
}

export async function ratchetMediaKeyMaterial(
  prevKey: Uint8Array,
  nextKid: number,
  label = 'lira-sframe-v1'
): Promise<{ kid: number; rawKey: Uint8Array; salt: Uint8Array }> {
  const normalizedKid = nextKid & 0xff
  const material = await hkdfDeriveBytes(
    prevKey,
    utf8Bytes(`${label}|ratchet|${normalizedKid}`),
    'lira-sframe-ratchet',
    44
  )
  return {
    kid: normalizedKid,
    rawKey: material.slice(0, 32),
    salt: material.slice(32, 44),
  }
}

function trailingZeroCount(bytes: Uint8Array): number {
  let zeros = 0
  for (let i = bytes.byteLength - 1; i >= 0 && zeros < 2; i--) {
    if (bytes[i] !== 0) break
    zeros++
  }
  return zeros
}

function annexBStartCodeLen(data: Uint8Array, offset: number): number {
  if (
    offset + 4 <= data.byteLength &&
    data[offset] === 0 &&
    data[offset + 1] === 0 &&
    data[offset + 2] === 0 &&
    data[offset + 3] === 1
  ) {
    return 4
  }
  if (
    offset + 3 <= data.byteLength &&
    data[offset] === 0 &&
    data[offset + 1] === 0 &&
    data[offset + 2] === 1
  ) {
    return 3
  }
  return 0
}

/**
 * Returns true if the encoded video frame begins with an H.264 Annex-B start code.
 */
export function isH264AnnexB(data: Uint8Array, mediaKind: SFrameMediaKind): boolean {
  if (mediaKind !== 'video') return false
  const scLen = annexBStartCodeLen(data, 0)
  return scLen > 0 && data.byteLength > scLen
}

/**
 * Inserts H.264 RBSP emulation-prevention bytes (0x03) so encrypted payloads
 * and trailers never contain false Annex-B start codes (00 00 00/01/02/03).
 */
export function escapeH264EmulationBytes(input: Uint8Array, initialZeros = 0): Uint8Array {
  const out: number[] = []
  let zeros = Math.min(2, Math.max(0, initialZeros))
  for (let i = 0; i < input.byteLength; i++) {
    const b = input[i]
    if (zeros >= 2 && b <= 0x03) {
      out.push(0x03)
      zeros = 0
    }
    out.push(b)
    zeros = b === 0 ? Math.min(2, zeros + 1) : 0
  }
  return new Uint8Array(out)
}

/**
 * Reverses `escapeH264EmulationBytes`, removing RBSP 0x03 emulation-prevention bytes.
 */
export function unescapeH264EmulationBytes(input: Uint8Array, initialZeros = 0): Uint8Array {
  const out: number[] = []
  let zeros = Math.min(2, Math.max(0, initialZeros))
  for (let i = 0; i < input.byteLength; i++) {
    const b = input[i]
    if (zeros >= 2 && b === 0x03 && i + 1 < input.byteLength && input[i + 1] <= 0x03) {
      zeros = 0
      continue
    }
    out.push(b)
    zeros = b === 0 ? Math.min(2, zeros + 1) : 0
  }
  return new Uint8Array(out)
}

export function computeUnencryptedPrefixLength(
  data: Uint8Array,
  mediaKind: SFrameMediaKind,
  isKeyFrame: boolean
): number {
  if (mediaKind === 'audio') return 0
  if (isH264AnnexB(data, mediaKind)) {
    const firstScLen = annexBStartCodeLen(data, 0)
    const fallback = Math.min(firstScLen + 1, data.byteLength, 255)
    let pos = 0
    let scLen = firstScLen
    while (scLen > 0) {
      const nalHeaderPos = pos + scLen
      if (nalHeaderPos >= data.byteLength) break
      const nalType = data[nalHeaderPos] & 0x1f
      if (nalType >= 1 && nalType <= 5) {
        const prefixEnd = nalHeaderPos + 1
        return prefixEnd <= 255 ? prefixEnd : fallback
      }
      // Scan for the next Annex-B start code after the current non-VCL NALU (AUD/SEI/SPS/PPS).
      let nextPos = -1
      let nextScLen = 0
      for (let i = nalHeaderPos + 1; i + 2 < data.byteLength; i++) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
          if (i > nalHeaderPos + 1 && data[i - 1] === 0) {
            nextPos = i - 1
            nextScLen = 4
          } else {
            nextPos = i
            nextScLen = 3
          }
          break
        }
      }
      if (nextPos < 0) break
      pos = nextPos
      scLen = nextScLen
    }
    return fallback
  }
  return Math.min(isKeyFrame ? 10 : 3, data.byteLength, 255)
}

export function buildSFrameIv(salt: Uint8Array, counter: number): Uint8Array<ArrayBuffer> {
  if (salt.byteLength !== 12) {
    throw new Error(`Invalid SFrame salt length: ${salt.byteLength}`)
  }
  const iv = new Uint8Array(new ArrayBuffer(12))
  iv.set(salt)
  const c = counter >>> 0
  iv[8] ^= (c >>> 24) & 0xff
  iv[9] ^= (c >>> 16) & 0xff
  iv[10] ^= (c >>> 8) & 0xff
  iv[11] ^= c & 0xff
  return iv
}

export async function encryptRawMediaPayload(
  rawKey: Uint8Array,
  salt: Uint8Array,
  counter: number,
  aad: Uint8Array,
  payload: Uint8Array
): Promise<Uint8Array> {
  const key = await importAesGcmKey(rawKey)
  const iv = buildSFrameIv(salt, counter)
  const encrypted = await getSubtle().encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: toArrayBufferView(aad),
      tagLength: 128,
    },
    key,
    toArrayBufferView(payload)
  )
  return new Uint8Array(encrypted)
}

export async function decryptRawMediaPayload(
  rawKey: Uint8Array,
  salt: Uint8Array,
  counter: number,
  aad: Uint8Array,
  ciphertext: Uint8Array
): Promise<Uint8Array> {
  const key = await importAesGcmKey(rawKey)
  const iv = buildSFrameIv(salt, counter)
  const decrypted = await getSubtle().decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: toArrayBufferView(aad),
      tagLength: 128,
    },
    key,
    toArrayBufferView(ciphertext)
  )
  return new Uint8Array(decrypted)
}

function buildSFrameAad(
  prefix: Uint8Array,
  kid: number,
  counter: number,
  prefixLen: number
): Uint8Array<ArrayBuffer> {
  const aad = new Uint8Array(new ArrayBuffer(prefix.byteLength + 6))
  if (prefix.byteLength > 0) {
    aad.set(prefix, 0)
  }
  const view = new DataView(aad.buffer, prefix.byteLength, 6)
  view.setUint8(0, kid & 0xff)
  view.setUint32(1, counter >>> 0, false)
  view.setUint8(5, prefixLen & 0xff)
  return aad
}

/**
 * Contexto SFrame para cifragem/decifragem de frames WebRTC E2EE com anti-replay e anti-DoS.
 */
export class SFrameCryptoContext {
  private sendState: { kid: number; cryptoKey: CryptoKey; salt: Uint8Array } | null = null
  private sendCounter = 0
  private recvKeys = new Map<number, RecvKeyState>()

  public async setSendKey(material: SFrameKeyMaterial): Promise<void> {
    const kid = material.kid & 0xff
    if (material.salt.byteLength !== 12) {
      throw new Error(`Invalid send salt length: ${material.salt.byteLength}`)
    }
    const cryptoKey = material.cryptoKey ?? (await importAesGcmKey(material.rawKey))
    this.sendState = {
      kid,
      cryptoKey,
      salt: new Uint8Array(material.salt),
    }
    this.sendCounter = 0
  }

  public async setRecvKey(
    material: SFrameKeyMaterial,
    keepPrevious = false
  ): Promise<void> {
    const kid = material.kid & 0xff
    if (material.salt.byteLength !== 12) {
      throw new Error(`Invalid recv salt length: ${material.salt.byteLength}`)
    }
    const cryptoKey = material.cryptoKey ?? (await importAesGcmKey(material.rawKey))
    if (!keepPrevious) {
      this.recvKeys.clear()
    } else if (this.recvKeys.size > 1) {
      const oldestKid = this.recvKeys.keys().next().value
      if (oldestKid !== undefined && oldestKid !== kid) {
        this.recvKeys.delete(oldestKid)
      }
    }
    this.recvKeys.set(kid, {
      kid,
      cryptoKey,
      salt: new Uint8Array(material.salt),
      maxCounter: -1,
      seen: new Set(),
    })
  }

  public revokeKid(kid: number): void {
    this.recvKeys.delete(kid & 0xff)
  }

  public hasSendKey(): boolean {
    return this.sendState !== null
  }

  public hasRecvKeys(): boolean {
    return this.recvKeys.size > 0
  }

  public clear(): void {
    this.sendState = null
    this.sendCounter = 0
    this.recvKeys.clear()
  }

  public async encryptFrame(
    frameData: Uint8Array,
    mediaKind: SFrameMediaKind,
    isKeyFrame: boolean
  ): Promise<Uint8Array> {
    if (!this.sendState) {
      throw new Error('Missing SFrame send key')
    }
    if (this.sendCounter >= MAX_SFRAME_COUNTER) {
      throw new Error('SFrame send counter exhausted; key rotation required')
    }

    const counter = this.sendCounter++
    const { kid, cryptoKey, salt } = this.sendState
    const h264AnnexB = isH264AnnexB(frameData, mediaKind)
    const prefixLen = computeUnencryptedPrefixLength(frameData, mediaKind, isKeyFrame)
    const prefix = frameData.subarray(0, prefixLen)
    const body = frameData.subarray(prefixLen)

    const aad = buildSFrameAad(prefix, kid, counter, prefixLen)
    const iv = buildSFrameIv(salt, counter)
    const encrypted = await getSubtle().encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad,
        tagLength: 128,
      },
      cryptoKey,
      toArrayBufferView(body)
    )

    const cipherBytes = new Uint8Array(encrypted)
    if (!h264AnnexB) {
      const out = new Uint8Array(
        new ArrayBuffer(prefixLen + cipherBytes.byteLength + SFRAME_TRAILER_BYTES)
      )
      if (prefixLen > 0) {
        out.set(prefix, 0)
      }
      out.set(cipherBytes, prefixLen)

      const trailerOffset = prefixLen + cipherBytes.byteLength
      const view = new DataView(out.buffer, trailerOffset, SFRAME_TRAILER_BYTES)
      view.setUint32(0, counter, false)
      view.setUint8(4, kid)
      view.setUint8(5, prefixLen)
      view.setUint8(6, SFRAME_MAGIC_0)
      view.setUint8(7, SFRAME_MAGIC_1)
      return out
    }

    const rawTail = new Uint8Array(cipherBytes.byteLength + 6)
    rawTail.set(cipherBytes, 0)
    const tailView = new DataView(rawTail.buffer, cipherBytes.byteLength, 6)
    tailView.setUint32(0, counter, false)
    tailView.setUint8(4, kid)
    tailView.setUint8(5, prefixLen)

    const escapedTail = escapeH264EmulationBytes(rawTail, trailingZeroCount(prefix))
    const out = new Uint8Array(new ArrayBuffer(prefixLen + escapedTail.byteLength + 2))
    out.set(prefix, 0)
    out.set(escapedTail, prefixLen)
    out[out.byteLength - 2] = SFRAME_MAGIC_0
    out[out.byteLength - 1] = SFRAME_MAGIC_H264_1
    return out
  }

  public async decryptFrame(encryptedData: Uint8Array): Promise<Uint8Array> {
    if (encryptedData.byteLength < SFRAME_MIN_FRAME_BYTES) {
      throw new Error('Truncated SFrame payload')
    }

    const magic0 = encryptedData[encryptedData.byteLength - 2]
    const magic1 = encryptedData[encryptedData.byteLength - 1]
    if (magic0 !== SFRAME_MAGIC_0 || (magic1 !== SFRAME_MAGIC_1 && magic1 !== SFRAME_MAGIC_H264_1)) {
      throw new Error('Invalid SFrame magic bytes')
    }

    let counter: number
    let kid: number
    let prefixLen: number
    let prefix: Uint8Array
    let cipherAndTag: Uint8Array

    if (magic1 === SFRAME_MAGIC_H264_1) {
      prefixLen = encryptedData[encryptedData.byteLength - 3]
      if (prefixLen < 4 || prefixLen > encryptedData.byteLength - SFRAME_MIN_FRAME_BYTES) {
        throw new Error(`Invalid SFrame prefixLen ${prefixLen}`)
      }
      prefix = encryptedData.subarray(0, prefixLen)
      const unescapedTail = unescapeH264EmulationBytes(
        encryptedData.subarray(prefixLen, encryptedData.byteLength - 2),
        trailingZeroCount(prefix)
      )
      if (unescapedTail.byteLength < SFRAME_TAG_BYTES + 6) {
        throw new Error('Truncated SFrame H.264 payload')
      }
      const tailView = new DataView(
        unescapedTail.buffer,
        unescapedTail.byteOffset + unescapedTail.byteLength - 6,
        6
      )
      counter = tailView.getUint32(0, false)
      kid = tailView.getUint8(4)
      const innerPrefixLen = tailView.getUint8(5)
      if (innerPrefixLen !== prefixLen) {
        throw new Error(`Mismatched SFrame prefixLen ${innerPrefixLen} !== ${prefixLen}`)
      }
      cipherAndTag = unescapedTail.subarray(0, unescapedTail.byteLength - 6)
    } else {
      const trailerOffset = encryptedData.byteLength - SFRAME_TRAILER_BYTES
      const view = new DataView(
        encryptedData.buffer,
        encryptedData.byteOffset + trailerOffset,
        SFRAME_TRAILER_BYTES
      )
      counter = view.getUint32(0, false)
      kid = view.getUint8(4)
      prefixLen = view.getUint8(5)

      if (prefixLen > encryptedData.byteLength - SFRAME_MIN_FRAME_BYTES) {
        throw new Error(`Invalid SFrame prefixLen ${prefixLen}`)
      }

      prefix = encryptedData.subarray(0, prefixLen)
      cipherAndTag = encryptedData.subarray(prefixLen, trailerOffset)
    }

    const recvState = this.recvKeys.get(kid)
    if (!recvState) {
      throw new Error(`Unknown SFrame key id ${kid}`)
    }

    if (recvState.seen.has(counter)) {
      throw new Error(`SFrame replay detected for kid=${kid} counter=${counter}`)
    }
    if (
      recvState.maxCounter >= 0 &&
      counter + SFRAME_REPLAY_WINDOW <= recvState.maxCounter
    ) {
      throw new Error(`SFrame counter ${counter} outside replay window (max=${recvState.maxCounter})`)
    }
    const aad = buildSFrameAad(prefix, kid, counter, prefixLen)
    const iv = buildSFrameIv(recvState.salt, counter)

    const decrypted = await getSubtle().decrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad,
        tagLength: 128,
      },
      recvState.cryptoKey,
      toArrayBufferView(cipherAndTag)
    )

    // Commit anti-replay window only after AES-GCM tag authentication succeeds.
    if (counter > recvState.maxCounter) {
      recvState.maxCounter = counter
      const minRetained = counter - SFRAME_REPLAY_WINDOW
      if (minRetained > 0) {
        for (const seenCounter of recvState.seen) {
          if (seenCounter < minRetained) {
            recvState.seen.delete(seenCounter)
          }
        }
      }
    }
    recvState.seen.add(counter)

    const bodyPlain = new Uint8Array(decrypted)
    const out = new Uint8Array(new ArrayBuffer(prefixLen + bodyPlain.byteLength))
    if (prefixLen > 0) {
      out.set(prefix, 0)
    }
    out.set(bodyPlain, prefixLen)
    return out
  }
}
