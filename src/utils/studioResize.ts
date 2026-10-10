// Resizing the canvas of the pixel art studio. Each frame keeps an "unclipped" image: the drawing as it was
// before a smaller canvas cut it, so that a bigger canvas gets the cut part back. What was drawn on the
// canvas since then has to go into it as well, or the next resize throws the new drawing away.

export const MAX_SIZE = 4096

/** The size typed in a field, 1 to MAX_SIZE; null while the field is empty or below 1. */
export function parseSizeInput(typedText: string): number | null {
  const parsedSize = parseInt(typedText, 10)
  return isNaN(parsedSize) || parsedSize < 1 ? null : Math.min(MAX_SIZE, parsedSize)
}

/** What a field shows for what was typed: above MAX_SIZE it becomes MAX_SIZE, anything else is left as typed. */
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

/** Where `source` goes to be centred in an area of size `target`. */
export function centerOffset(target: Size, source: Size): Point {
  return {
    x: Math.round((target.width - source.width) / 2),
    y: Math.round((target.height - source.height) / 2),
  }
}

export interface FrameSourceLayout {
  /** Size of the image that holds both. */
  size: Size
  /** Where the old unclipped image goes in it (null when the frame had none). */
  unclipped: Point | null
  /** Where the drawing of the canvas goes in it. */
  current: Point
}

/**
 * The image to resize a frame from: the old unclipped image and the drawing of the canvas, centred on each
 * other, in an image as big as the bigger of the two in each direction.
 */
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

/**
 * The unclipped image of a frame brought up to date: the old one, with the part the canvas shows replaced
 * by the drawing in `frameUrl`. Null if the drawing cannot be read.
 */
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
