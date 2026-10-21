import { cropSpriteFrame, readSpriteFrame } from '../assets/spriteFrame'
const sprites = new Map<string, Promise<HTMLImageElement>>()
/** Decodable canvas source in both the renderer and an image-processing worker. */
export async function loadRasterImage(src: string): Promise<HTMLImageElement> {
  const frame = readSpriteFrame(src)
  if (frame) {
    let pending = sprites.get(src)
    if (!pending) {
      pending = loadRasterImage(frame.source).then(image => cropSpriteFrame(image, frame))
      if (sprites.size >= 256) sprites.delete(sprites.keys().next().value!)
      sprites.set(src, pending)
      pending.catch(() => sprites.delete(src))
    }
    return pending
  }
  if (typeof Image !== 'undefined') return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => image.naturalWidth > 0 ? resolve(image) : reject(new Error('Imagem vazia'))
    image.onerror = () => reject(new Error('Não foi possível carregar a imagem do atlas'))
    image.src = src
  })
  const image = await createImageBitmap(await (await fetch(src)).blob())
  return Object.assign(image, { naturalWidth: image.width, naturalHeight: image.height, complete: true }) as unknown as HTMLImageElement
}
