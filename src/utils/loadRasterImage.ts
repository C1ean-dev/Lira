/** Decodable canvas source in both the renderer and an image-processing worker. */
export async function loadRasterImage(src: string): Promise<HTMLImageElement> {
  if (typeof Image !== 'undefined') return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => image.naturalWidth > 0 ? resolve(image) : reject(new Error('Imagem vazia'))
    image.onerror = () => reject(new Error('Não foi possível carregar a imagem do atlas'))
    image.src = src
  })
  const image = await createImageBitmap(await (await fetch(src)).blob())
  return Object.assign(image, { naturalWidth: image.width, naturalHeight: image.height, complete: true }) as unknown as HTMLImageElement
}