import { loadRasterImage } from '../../utils/loadRasterImage'
import type { PreservedDrawingRaster } from '../../types/customAsset'
import type { PixelLayerEdit } from './assetStudioDraft'

export async function resizeDrawingLayer(source: string | undefined, requestedWidth: number, requestedHeight: number, preserved?: PreservedDrawingRaster): Promise<PixelLayerEdit> {
  const width = Math.max(1, Math.min(4096, Math.round(requestedWidth) || 1))
  const height = Math.max(1, Math.min(4096, Math.round(requestedHeight) || 1))
  const imageSource = preserved?.dataUrl || source
  const image = imageSource ? await loadRasterImage(imageSource) : null
  const x = preserved?.x || 0, y = preserved?.y || 0
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(width + x, image?.width || 0)
  canvas.height = Math.max(height + y, image?.height || 0)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível redimensionar a tela. A imagem original foi preservada.')
  context.imageSmoothingEnabled = false
  if (image) context.drawImage(image, 0, 0)
  const preservedRaster = { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, x, y }
  const visible = document.createElement('canvas')
  visible.width = width; visible.height = height
  const visibleContext = visible.getContext('2d')
  if (!visibleContext) throw new Error('Não foi possível redimensionar a tela. A imagem original foi preservada.')
  visibleContext.imageSmoothingEnabled = false
  visibleContext.drawImage(canvas, -x, -y)
  return { dataUrl: visible.toDataURL('image/png'), width, height, preservedRaster }
}
