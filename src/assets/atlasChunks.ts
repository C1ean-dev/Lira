import { runAtlasTask } from './atlasWorkerClient'
import type { PersistedAtlas } from './atlasFormat'

export const ATLAS_CHUNK_SIZE = 32 * 1024
const MAX_ATLAS_SIZE = 128 * 1024 * 1024
export interface AtlasChunk { transferId: string; digest: string; field: 'xml' | 'png'; index: number; total: number; data: Uint8Array | ArrayBuffer }
export interface BinaryAtlas { xml: Uint8Array[]; png: Uint8Array[]; digest: string }
export async function sendAtlasChunks(
  atlas: PersistedAtlas, digest: string, send: (chunk: AtlasChunk) => void,
  active: () => boolean, buffered: () => number = () => 0,
): Promise<boolean> {
  const transferId = crypto.randomUUID()
  const bytes: {xml: Uint8Array; png: Uint8Array} = typeof Worker !== 'undefined' && typeof document !== 'undefined'
    ? await runAtlasTask('encode', atlas)
    : {xml: new TextEncoder().encode(atlas.xml), png: new TextEncoder().encode(atlas.png)}
  const total = Math.ceil(bytes.xml.length / ATLAS_CHUNK_SIZE) + Math.ceil(bytes.png.length / ATLAS_CHUNK_SIZE)
  if (bytes.xml.length + bytes.png.length > MAX_ATLAS_SIZE) throw new Error('Atlas excede o limite de transferência')
  let index = 0
  for (const field of ['xml', 'png'] as const) {
    for (let at = 0; at < bytes[field].length; at += ATLAS_CHUNK_SIZE) {
      while (buffered() > 512 * 1024) {
        if (!active()) return false
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      if (!active()) return false
      send({ transferId, digest, field, index, total, data: bytes[field].slice(at, at + ATLAS_CHUNK_SIZE).buffer })
      if (++index % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  return true
}

export class AtlasChunkReceiver {
  private pending = new Map<string, { id: string; digest: string; next: number; total: number; size: number; last: number; xml: Uint8Array[]; png: Uint8Array[] }>()
  accept(peerId: string, chunk: AtlasChunk): BinaryAtlas | null {
    const data = chunk?.data instanceof ArrayBuffer ? new Uint8Array(chunk.data)
      : ArrayBuffer.isView(chunk?.data) && chunk.data.buffer instanceof ArrayBuffer ? new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength) : null
    const now = Date.now()
    for (const [peer, state] of this.pending) if (now - state.last > 60000) this.pending.delete(peer)
    if (!chunk || typeof chunk.transferId !== 'string' || !chunk.transferId || chunk.transferId.length > 128
      || typeof chunk.digest !== 'string' || !chunk.digest || chunk.digest.length > 128
      || !['xml', 'png'].includes(chunk.field) || !data || data.byteLength > ATLAS_CHUNK_SIZE
      || !Number.isInteger(chunk.index) || chunk.index < 0 || !Number.isInteger(chunk.total) || chunk.total < 1
      || chunk.total > MAX_ATLAS_SIZE / ATLAS_CHUNK_SIZE + 2 || chunk.index >= chunk.total) return null
    if (chunk.index === 0) {
      if (!this.pending.has(peerId) && this.pending.size >= 8) return null
      this.pending.set(peerId, { id: chunk.transferId, digest: chunk.digest, next: 0, total: chunk.total, size: 0, last: now, xml: [], png: [] })
    }
    const state = this.pending.get(peerId)
    if (!state || state.id !== chunk.transferId || state.digest !== chunk.digest || state.total !== chunk.total || state.next !== chunk.index) return null
    if (state.size + data.byteLength > MAX_ATLAS_SIZE) { this.pending.delete(peerId); return null }
    state[chunk.field].push(data)
    state.size += data.byteLength
    state.last = now
    if (++state.next !== state.total) return null
    this.pending.delete(peerId)
    return { xml: state.xml, png: state.png, digest: state.digest }
  }
}