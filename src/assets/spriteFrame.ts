export interface SpriteFrame { source: string; x: number; y: number; width: number; height: number }
const prefix = 'lira-sprite:'
const parsed = new Map<string, SpriteFrame>()

export function spriteFrame(source: string, x: number, y: number, width: number, height: number): string {
  if (!source || source.startsWith(prefix) || ![x, y, width, height].every(Number.isSafeInteger)
    || x < 0 || y < 0 || width <= 0 || height <= 0 || width > 16384 || height > 16384) throw new Error('Recorte de sprite inválido')
  return prefix + encodeURIComponent(JSON.stringify([source, x, y, width, height]))
}

export function readSpriteFrame(value: string): SpriteFrame | null {
  if (!value.startsWith(prefix)) return null
  const known = parsed.get(value)
  if (known) return known
  let values: unknown
  try { values = JSON.parse(decodeURIComponent(value.slice(prefix.length))) } catch { throw new Error('Recorte de sprite inválido') }
  if (!Array.isArray(values) || values.length !== 5 || typeof values[0] !== 'string') throw new Error('Recorte de sprite inválido')
  const [source, x, y, width, height] = values
  spriteFrame(source, x, y, width, height)
  const frame = { source, x, y, width, height }
  // Temporary editor data URLs may contain an entire sheet; do not retain
  // another decoded copy of that sheet for every cut.
  if (value.length < 8192) {
    if (parsed.size > 2048) parsed.clear()
    parsed.set(value, frame)
  }
  return frame
}

// Rasterize only in memory for canvas/editor consumers. No PNG is encoded or saved.
export function cropSpriteFrame(image: CanvasImageSource, frame: SpriteFrame): HTMLImageElement {
  const source = image as HTMLImageElement
  const width = source.naturalWidth || source.width
  const height = source.naturalHeight || source.height
  if (frame.x + frame.width > width || frame.y + frame.height > height) throw new Error('Recorte fora da imagem original')
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(frame.width, frame.height) : document.createElement('canvas')
  canvas.width = frame.width; canvas.height = frame.height
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('Não foi possível renderizar o recorte')
  ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height)
  return Object.assign(canvas, { naturalWidth: frame.width, naturalHeight: frame.height, complete: true }) as unknown as HTMLImageElement
}
