import { readSpriteFrame } from '../assets/spriteFrame'
import { loadRasterImage } from './loadRasterImage'
import { canvasToPngDataUrl } from './canvasPng'

const previews = new Map<string, Promise<string>>()
/** DOM <img> and export tools need a URL. These previews live only in memory;
 * the library always persists the original sheet and XML, never these PNGs. */
export function rasterImageUrl(source: string): Promise<string> {
  if (!readSpriteFrame(source)) return Promise.resolve(source)
  let preview = previews.get(source)
  if (!preview) {
    preview = loadRasterImage(source).then(image => canvasToPngDataUrl(image as unknown as HTMLCanvasElement))
    if (previews.size >= 256) previews.delete(previews.keys().next().value!)
    previews.set(source, preview)
    preview.catch(() => previews.delete(source))
  }
  return preview
}

export function setRasterImageSource(image: HTMLImageElement, source: string): void {
  if (!readSpriteFrame(source)) { image.src = source; return }
  void rasterImageUrl(source).then(url => { image.src = url }, () => image.dispatchEvent(new Event('error')))
}

/** Convert only for readers that predate source-sheet references. */
export async function materializeSpriteDocument<T>(value: T): Promise<T> {
  if (typeof value === 'string') return (readSpriteFrame(value) ? await rasterImageUrl(value) : value) as T
  if (Array.isArray(value)) return await Promise.all(value.map(materializeSpriteDocument)) as T
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await materializeSpriteDocument(item)]))) as T
  return value
}
