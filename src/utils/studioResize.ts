
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
  frameImage.src = frameUrl
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
