export interface DrawingRasterPixels { width: number; height: number; data: Uint8ClampedArray }

// Replace RGBA bytes, including transparent eraser pixels; retain everything outside
// the visible canvas. Offsets also cover trimming and undoing a trim.
export function mergeDrawingRaster(backing: DrawingRasterPixels, visible: DrawingRasterPixels, x: number, y: number) {
  const left = Math.min(0, x), top = Math.min(0, y)
  const width = Math.max(backing.width, x + visible.width) - left
  const height = Math.max(backing.height, y + visible.height) - top
  const data = new Uint8ClampedArray(width * height * 4)
  const copy = (source: DrawingRasterPixels, dx: number, dy: number) => {
    for (let row = 0; row < source.height; row++) {
      data.set(source.data.subarray(row * source.width * 4, (row + 1) * source.width * 4), ((row + dy) * width + dx) * 4)
    }
  }
  copy(backing, -left, -top)
  copy(visible, x - left, y - top)
  return { width, height, data, x: x - left, y: y - top }
}
