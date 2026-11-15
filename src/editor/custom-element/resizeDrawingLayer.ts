import { loadRasterImage } from '../../utils/loadRasterImage'
import type { PixelLayerEdit } from './assetStudioDraft'

export async function resizeDrawingLayer(source: string | undefined, requestedWidth: number, requestedHeight: number): Promise<PixelLayerEdit> {
  const width = Math.max(1, Math.min(4096, Math.round(requestedWidth) || 1))
  const height = Math.max(1, Math.min(4096, Math.round(requestedHeight) || 1))
  const image = source ? await loadRasterImage(source) : null
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível redimensionar a tela. A imagem original foi preservada.')
  context.imageSmoothingEnabled = false
  // Grow with transparent space, or crop the right/bottom edges; never resample.
  if (image) context.drawImage(image, 0, 0)
  return { dataUrl: canvas.toDataURL('image/png'), width, height }
}
