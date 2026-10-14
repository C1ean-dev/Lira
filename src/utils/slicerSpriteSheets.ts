import type { CustomAsset, SpriteSheetSource } from '../types/customAsset'

export function sequentialFrameRegions(
  selection: { x: number; y: number; w: number; h: number }, width: number, height: number,
): { x: number; y: number; w: number; h: number }[] {
  const { x, y, w, h } = selection
  if (w <= 0 || h <= 0 || x < 0 || y < 0 || y + h > height) return []
  const count = Math.max(0, Math.floor((width - x) / w))
  return Array.from({ length: count }, (_, index) => ({ x: x + index * w, y, w, h }))
}

export async function resolveSlicerSheets(asset: CustomAsset | null | undefined, imageSrc: string): Promise<SpriteSheetSource[]> {
  const main: SpriteSheetSource = {
    id: 'main', name: 'Base', imageSrc, frameWidth: asset?.pixelWidth ?? 32, frameHeight: asset?.pixelHeight ?? 32,
  }
  const sheets = [main, ...(asset?.sourceSheets ?? []).filter(sheet => sheet.id !== 'main' && !sheet.animation)]
  if (typeof document === 'undefined') return sheets
  for (const animation of ['yawn', 'sleep'] as const) {
    const frames = asset?.petAnimations?.[animation]?.frames
    if (!frames?.length || sheets.some(sheet => sheet.animation === animation)) continue
    const canvas = document.createElement('canvas')
    canvas.width = main.frameWidth * frames.length
    canvas.height = main.frameHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    ctx.imageSmoothingEnabled = false
    const images = await Promise.all(frames.map(src => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Não foi possível carregar os frames da folha.'))
      img.src = src
    })))
    images.forEach((img, index) => ctx.drawImage(img, index * main.frameWidth, 0, main.frameWidth, main.frameHeight))
    sheets.push({ id: animation, name: animation === 'yawn' ? 'Bocejo' : 'Sono', animation,
      imageSrc: canvas.toDataURL('image/png'), frameWidth: main.frameWidth, frameHeight: main.frameHeight })
  }
  return sheets
}
