import { setRasterImageSource } from './rasterImageSource'
import { loadRasterImage } from './loadRasterImage'
import { cropImage, getTrimmedBounds } from './imageTransparency'
import type { Direction } from '../types/game'

export const MAX_SIZE = 4096

export function parseSizeInput(typedText: string): number | null {
  const parsedSize = parseInt(typedText, 10)
  return isNaN(parsedSize) || parsedSize < 1 ? null : Math.min(MAX_SIZE, parsedSize)
}

export function clampedSizeText(typedText: string): string {
  return parseInt(typedText, 10) > MAX_SIZE ? String(MAX_SIZE) : typedText
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export function centerOffset(target: Size, source: Size): Point {
  return {
    x: Math.round((target.width - source.width) / 2),
    y: Math.round((target.height - source.height) / 2),
  }
}

export interface FrameSourceLayout {
  size: Size
  unclipped: Point | null
  current: Point
}

export function layoutFrameSource(unclippedSize: Size | null, currentSize: Size): FrameSourceLayout {
  const size = {
    width: Math.max(currentSize.width, unclippedSize?.width ?? 0),
    height: Math.max(currentSize.height, unclippedSize?.height ?? 0),
  }
  return {
    size,
    unclipped: unclippedSize ? centerOffset(size, unclippedSize) : null,
    current: centerOffset(size, currentSize),
  }
}

export async function composeFrameSource(
  unclippedCanvas: HTMLCanvasElement | undefined,
  frameUrl: string
): Promise<HTMLCanvasElement | null> {
  const frameImage = new Image()
  setRasterImageSource(frameImage, frameUrl)
  const loaded = await new Promise<boolean>((resolve) => {
    frameImage.onload = () => resolve(true)
    frameImage.onerror = () => resolve(false)
  })
  if (!loaded || frameImage.naturalWidth <= 0 || frameImage.naturalHeight <= 0) return null

  const currentSize = { width: frameImage.naturalWidth, height: frameImage.naturalHeight }
  const layout = layoutFrameSource(
    unclippedCanvas ? { width: unclippedCanvas.width, height: unclippedCanvas.height } : null,
    currentSize
  )
  const composedCanvas = document.createElement('canvas')
  composedCanvas.width = layout.size.width
  composedCanvas.height = layout.size.height
  const context = composedCanvas.getContext('2d')
  if (!context) return null
  context.imageSmoothingEnabled = false
  if (unclippedCanvas && layout.unclipped) {
    context.drawImage(unclippedCanvas, layout.unclipped.x, layout.unclipped.y)
  }
  context.clearRect(layout.current.x, layout.current.y, currentSize.width, currentSize.height)
  context.drawImage(frameImage, layout.current.x, layout.current.y)
  return composedCanvas
}

export async function trimStudioFrames(frames: Record<Direction, string[]>): Promise<{
  frames: Record<Direction, string[]>
  bounds: { x: number; y: number; w: number; h: number }
} | null> {
  const directions: Direction[] = ['down', 'up', 'left', 'right']
  const images: Record<Direction, (HTMLImageElement | null)[]> = { down: [], up: [], left: [], right: [] }
  const scratch = document.createElement('canvas')
  const context = scratch.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Não foi possível ler os pixels dos quadros.')

  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1

  for (const direction of directions) {
    for (const frame of frames[direction]) {
      const image = frame ? await loadRasterImage(frame) : null
      images[direction].push(image)
      if (!image) continue
      scratch.width = image.naturalWidth
      scratch.height = image.naturalHeight
      context.drawImage(image, 0, 0)
      // Only fully transparent pixels may be removed, including around faint artwork.
      const bounds = getTrimmedBounds(scratch, 0)
      if (!bounds) continue
      minX = Math.min(minX, bounds.x)
      minY = Math.min(minY, bounds.y)
      maxX = Math.max(maxX, bounds.x + bounds.w)
      maxY = Math.max(maxY, bounds.y + bounds.h)
    }
  }

  if (maxX < 0) return null
  const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  const cropped: Record<Direction, string[]> = { down: [], up: [], left: [], right: [] }
  for (const direction of directions) {
    // A common crop keeps every animation frame and direction aligned.
    cropped[direction] = images[direction].map(image => image
      ? cropImage(image, bounds.x, bounds.y, bounds.w, bounds.h).toDataURL('image/png')
      : '')
  }
  return { frames: cropped, bounds }
}
