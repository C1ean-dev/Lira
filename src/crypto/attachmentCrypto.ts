import type { ChatAttachment } from '../types/chat'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  constantTimeEqual,
  fromBase64Url,
  randomBytes,
  sha256,
  toBase64Url,
  utf8Bytes,
  utf8Decode,
} from './primitives'

export interface EncryptedAttachmentDescriptor {
  id: string
  name: string
  size: number
  mimeType: string
  iv: string
  keyB64: string
  digestB64: string
  ciphertextB64: string
}

const CHUNK_SIZE = 0x8000

/**
 * Converte bytes para Base64 padrao usando chunks para evitar stack overflow em arquivos grandes.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length))
    parts.push(String.fromCharCode(...slice))
  }
  return btoa(parts.join(''))
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

async function computeCipherDigest(ivB64: string, ciphertextB64: string): Promise<Uint8Array> {
  return sha256(utf8Bytes(`lira-e2ee-v1-att|${ivB64}|${ciphertextB64}`))
}

export async function encryptAttachment(
  attachment: ChatAttachment
): Promise<EncryptedAttachmentDescriptor> {
  const fileKey = randomBytes(32)
  const aad = utf8Bytes(`lira-e2ee-v1-att-aad|${attachment.id}|${attachment.name}|${attachment.type}`)
  const plainBytes = utf8Bytes(attachment.dataUrl)
  const { ivB64, ciphertextB64 } = await aesGcmEncrypt(fileKey, plainBytes, aad)
  const digest = await computeCipherDigest(ivB64, ciphertextB64)

  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.type,
    iv: ivB64,
    keyB64: toBase64Url(fileKey),
    digestB64: toBase64Url(digest),
    ciphertextB64,
  }
}

export async function decryptAttachment(
  descriptor: EncryptedAttachmentDescriptor
): Promise<ChatAttachment> {
  const expectedDigest = fromBase64Url(descriptor.digestB64)
  const actualDigest = await computeCipherDigest(descriptor.iv, descriptor.ciphertextB64)
  if (!constantTimeEqual(expectedDigest, actualDigest)) {
    throw new Error(`Attachment digest mismatch for ${descriptor.id}`)
  }

  const fileKey = fromBase64Url(descriptor.keyB64)
  const aad = utf8Bytes(
    `lira-e2ee-v1-att-aad|${descriptor.id}|${descriptor.name}|${descriptor.mimeType}`
  )
  const plainBytes = await aesGcmDecrypt(fileKey, descriptor.iv, descriptor.ciphertextB64, aad)
  return {
    id: descriptor.id,
    name: descriptor.name,
    size: descriptor.size,
    type: descriptor.mimeType,
    dataUrl: utf8Decode(plainBytes),
  }
}
