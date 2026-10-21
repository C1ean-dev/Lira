import { buildLibrary, openLibrary, knownLibraryImage, imageDataUrl, imageIdentity, type LibraryCatalog, type LibraryPacket } from './individualLibrary'
import type { AtlasDocument } from './atlasFormat'
import { materializeSpriteDocument } from '../utils/rasterImageSource'

export type LibraryMessage =
  | { kind: 'hello'; id: string; catalogVersion?: 2 | 3 }
  | { kind: 'offer'; id: string; catalog: LibraryCatalog }
  | { kind: 'request'; id: string; names: string[] }
  | { kind: 'image'; id: string; name: string; index: number; total: number; data: string }
type Send = (message: LibraryMessage) => unknown | Promise<unknown>
const CHUNK = 32 * 1024
interface Incoming { catalog: LibraryCatalog; missing: Set<string>; urls: Map<string, string>; parts: Map<string, string[]>; bytes: number; at: number }
export class IndividualLibrarySync {
  private offers = new Map<string, LibraryPacket>()
  private pending = new Map<string, Incoming>()
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private known = knownLibraryImage) {}
  async offer(document: AtlasDocument, send: Send, catalogVersion: 2 | 3 = 3): Promise<void> {
    const packet = await buildLibrary(catalogVersion === 2 ? await materializeSpriteDocument(document) : document)
    packet.catalog.version = catalogVersion
    if (catalogVersion === 2) delete packet.catalog.imagePaths
    const id = crypto.randomUUID()
    this.offers.set(id, packet)
    if (this.offers.size > 8) this.offers.delete(this.offers.keys().next().value!)
    await send({ kind: 'offer', id, catalog: packet.catalog })
  }
  receive(message: LibraryMessage, send: Send, commit: (document: AtlasDocument) => Promise<void>): Promise<void> {
    const result = this.queue.then(() => this.accept(message, send, commit))
    this.queue = result.catch(() => {})
    return result
  }
  private async accept(message: LibraryMessage, send: Send, commit: (document: AtlasDocument) => Promise<void>) {
    if (!message || typeof message.id !== 'string' || message.id.length > 128) throw new Error('Transferência inválida')
    for (const [id, item] of this.pending) if (Date.now() - item.at > 60000) this.pending.delete(id)
    if (message.kind === 'offer') {
      if (typeof message.catalog?.document !== 'string' || message.catalog.document.length > 32 * 1024 * 1024) throw new Error('Catálogo excede o limite')
      openLibrary(message.catalog, name => name, false)
      const urls = new Map<string, string>()
      const missing = new Set<string>()
      for (const name of message.catalog.images) {
        const existing = this.known(name)
        if (existing) urls.set(name, existing); else missing.add(name)
      }
      const item: Incoming = { catalog: message.catalog, urls, missing, parts: new Map(), bytes: 0, at: Date.now() }
      if (!missing.size) { await commit(openLibrary(item.catalog, name => urls.get(name)!)); return }
      if (this.pending.size >= 8) throw new Error('Muitas transferências pendentes')
      this.pending.set(message.id, item)
      await send({ kind: 'request', id: message.id, names: [...missing] })
    } else if (message.kind === 'request') {
      const packet = this.offers.get(message.id)
      if (!packet || !Array.isArray(message.names) || new Set(message.names).size !== message.names.length || message.names.some(n => !packet.catalog.images.includes(n))) throw new Error('Pedido de imagens inválido')
      for (const name of message.names) {
        const src = packet.images[name] || this.known(name)
        if (!src) throw new Error('Imagem para transferência ausente')
        const data = await imageDataUrl(src)
        const total = Math.ceil(data.length / CHUNK)
        for (let index = 0; index < total; index++) await send({ kind: 'image', id: message.id, name, index, total, data: data.slice(index * CHUNK, (index + 1) * CHUNK) })
      }
      this.offers.delete(message.id)
    } else if (message.kind === 'image') {
      const item = this.pending.get(message.id)
      if (!item || !item.missing.has(message.name)) return
      const parts = item.parts.get(message.name) || []
      if (typeof message.data !== 'string' || message.data.length > CHUNK || !Number.isInteger(message.index) || !Number.isInteger(message.total) || message.total < 1 || message.total > 2048 || message.index !== parts.length || message.index >= message.total || item.bytes + message.data.length > 128 * 1024 * 1024) throw new Error('Bloco de imagem inválido')
      parts.push(message.data); item.parts.set(message.name, parts); item.bytes += message.data.length; item.at = Date.now()
      if (parts.length !== message.total) return
      const data = parts.join('')
      if (await imageIdentity(data) !== message.name) { this.pending.delete(message.id); throw new Error('Assinatura da imagem inválida') }
      item.urls.set(message.name, data); item.parts.delete(message.name); item.missing.delete(message.name)
      if (!item.missing.size) {
        this.pending.delete(message.id)
        await commit(openLibrary(item.catalog, name => item.urls.get(name)!))
      }
    }
  }
}
