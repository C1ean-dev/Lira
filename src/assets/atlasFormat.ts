import type { CustomAsset } from '../types/customAsset'

export interface AtlasRect { name: string; x: number; y: number; width: number; height: number }
export interface PersistedAtlas { xml: string; png: string }
export interface AtlasDocument { assets: CustomAsset[]; categories: string[] }
export const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
const unescape = (s: string): string => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n]!))

// A typed XML tree preserves editor metadata without embedding a second JSON catalog.
export function encodeValue(value: unknown, images: Map<string, string>): string {
  if (value === null || value === undefined) return '<Null/>'
  if (typeof value === 'string') {
    const image = images.get(value)
    return image ? `<Image>${xmlEscape(image)}</Image>` : `<String>${xmlEscape(value)}</String>`
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Número inválido no atlas')
    return `<Number>${value}</Number>`
  }
  if (typeof value === 'boolean') return `<Boolean>${value}</Boolean>`
  if (Array.isArray(value)) return `<Array>${value.map(v => encodeValue(v, images)).join('')}</Array>`
  if (typeof value !== 'object') throw new Error('Metadado não suportado')
  return `<Object>${Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => `<Entry key="${xmlEscape(k)}">${encodeValue(v, images)}</Entry>`).join('')}</Object>`
}

export function decodeValue(xml: string, image: (name: string) => string): unknown {
  let at = 0
  const read = (): unknown => {
    const open = /^<(Null\/|String|Number|Boolean|Image|Array|Object)>/.exec(xml.slice(at))
    if (!open) throw new Error('Metadados XML inválidos')
    at += open[0].length
    const type = open[1]
    if (type === 'Null/') return null
    let result: unknown
    if (type === 'Array') {
      const values: unknown[] = []
      while (!xml.startsWith('</Array>', at)) values.push(read())
      result = values
    } else if (type === 'Object') {
      const obj: Record<string, unknown> = Object.create(null)
      while (!xml.startsWith('</Object>', at)) {
        const entry = /^<Entry key="([^"<]*)">/.exec(xml.slice(at))
        if (!entry) throw new Error('Entrada XML inválida')
        at += entry[0].length
        const key = unescape(entry[1])
        if (['__proto__', 'prototype', 'constructor'].includes(key) || Object.prototype.hasOwnProperty.call(obj, key)) throw new Error('Chave XML inválida')
        obj[key] = read()
        if (!xml.startsWith('</Entry>', at)) throw new Error('Entrada XML incompleta')
        at += 8
      }
      result = obj
    } else {
      const end = xml.indexOf(`<`, at)
      if (end < 0) throw new Error('Valor XML incompleto')
      const value = unescape(xml.slice(at, end))
      at = end
      if (type === 'Number') {
        result = Number(value)
        if (!value || !Number.isFinite(result)) throw new Error('Número XML inválido')
      } else if (type === 'Boolean') {
        if (value !== 'true' && value !== 'false') throw new Error('Booleano XML inválido')
        result = value === 'true'
      } else result = type === 'Image' ? image(value) : value
    }
    const close = `</${type}>`
    if (!xml.startsWith(close, at)) throw new Error('XML incompleto')
    at += close.length
    return result
  }
  const result = read()
  if (at !== xml.length) throw new Error('Conteúdo XML inesperado')
  return result
}

export function serializeAtlas(document: AtlasDocument, rects: AtlasRect[], images: Map<string, string>, imagePath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<TextureAtlas imagePath="${xmlEscape(imagePath)}" liraVersion="1">\n${rects.map(r => `  <SubTexture name="${xmlEscape(r.name)}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"/>`).join('\n')}\n<LiraAssets>${encodeValue(document, images)}</LiraAssets>\n</TextureAtlas>\n`
}

export function parseAtlasDocument(xml: string, image: (name: string) => string): AtlasDocument {
  if (typeof DOMParser !== 'undefined' && new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')) throw new Error('XML malformado')
  if (xml.includes('<!') || !/^<\?xml[^>]*\?>\s*<TextureAtlas\b[^>]*\bliraVersion="1"[^>]*>/.test(xml.trim()) || !xml.trim().endsWith('</TextureAtlas>')) throw new Error('Versão ou estrutura do atlas inválida')
  const metadata = /<LiraAssets>([\s\S]*?)<\/LiraAssets>/.exec(xml)
  if (!metadata) throw new Error('Atlas sem metadados')
  const doc = decodeValue(metadata[1], image) as AtlasDocument
  if (!doc || !Array.isArray(doc.assets) || !Array.isArray(doc.categories) || doc.categories.some(c => typeof c !== 'string')) throw new Error('Catálogo XML inválido')
  const ids = new Set<string>()
  for (const asset of doc.assets) {
    if (!asset || typeof asset.id !== 'string' || !asset.id || ids.has(asset.id) || typeof asset.name !== 'string' || !['avatar', 'furniture', 'floor', 'wall'].includes(asset.type) || !Array.isArray(asset.frames) || !Number.isFinite(asset.width) || !Number.isFinite(asset.height)) throw new Error('Asset XML inválido')
    ids.add(asset.id)
  }
  return doc
}

export function layoutSprites(sizes: { name: string; width: number; height: number }[]): { rects: AtlasRect[]; width: number; height: number } {
  const sorted = [...sizes].sort((a, b) => b.height - a.height || a.name.localeCompare(b.name))
  const width = Math.max(1, ...sorted.map(s => s.width), Math.min(4096, Math.ceil(Math.sqrt(sorted.reduce((n, s) => n + s.width * s.height, 0)))))
  let x = 0, y = 0, row = 0
  const rects = sorted.map(s => {
    if (s.width <= 0 || s.height <= 0 || s.width > 8192 || s.height > 8192) throw new Error('Imagem excede o limite do atlas')
    if (x + s.width > width) { x = 0; y += row; row = 0 }
    const r = { ...s, x, y }
    x += s.width; row = Math.max(row, s.height)
    return r
  })
  const height = Math.max(1, y + row)
  if (height > 16384) throw new Error('Atlas excede o limite de tamanho')
  return { rects, width: Math.max(width, ...sizes.map(s => s.width)), height }
}
