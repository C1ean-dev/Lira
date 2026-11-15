import type { PixelImage, RGBA } from './pixelEditor'

export type PixelPreviewTool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'move'
export interface PixelPreviewRect { x: number; y: number; width: number; height: number }

// Read-only geometry: the preview is never painted into the image or its history.
export function pixelToolPreview(image: PixelImage, tool: PixelPreviewTool, point: { x: number; y: number }, size: number, color: RGBA): PixelPreviewRect[] {
  const { width, height, data } = image
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return []
  const x = Math.floor(point.x), y = Math.floor(point.y)
  if (tool === 'pencil' || tool === 'eraser' || tool === 'picker') {
    const brush = tool === 'picker' ? 1 : Math.max(1, Math.round(size))
    const left = Math.max(0, x - Math.floor(brush / 2)), top = Math.max(0, y - Math.floor(brush / 2))
    return [{ x: left, y: top, width: Math.min(width, x - Math.floor(brush / 2) + brush) - left,
      height: Math.min(height, y - Math.floor(brush / 2) + brush) - top }]
  }
  if (tool === 'move') {
    let left = width, top = height, right = -1, bottom = -1
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) if (data[(row * width + col) * 4 + 3]) {
      left = Math.min(left, col); top = Math.min(top, row); right = Math.max(right, col); bottom = Math.max(bottom, row)
    }
    return right < 0 ? [] : [{ x: left, y: top, width: right - left + 1, height: bottom - top + 1 }]
  }
  const origin = (y * width + x) * 4
  const target = data.subarray(origin, origin + 4)
  if (color.every((value, channel) => value === target[channel])) return []
  const mask = new Uint8Array(width * height), queue = new Int32Array(width * height)
  let head = 0, tail = 0
  const visit = (at: number) => {
    if (mask[at] || !target.every((value, channel) => data[at * 4 + channel] === value)) return
    mask[at] = 1; queue[tail++] = at
  }
  visit(y * width + x)
  while (head < tail) {
    const at = queue[head++]
    if (at % width > 0) visit(at - 1)
    if (at % width < width - 1) visit(at + 1)
    if (at >= width) visit(at - width)
    if (at < width * (height - 1)) visit(at + width)
  }
  // Merge equal spans vertically to avoid an SVG element for every pixel.
  const rectangles: PixelPreviewRect[] = []
  let previous = new Map<string, PixelPreviewRect>()
  for (let row = 0; row < height; row++) {
    const current = new Map<string, PixelPreviewRect>()
    for (let col = 0; col < width;) {
      if (!mask[row * width + col]) { col++; continue }
      const start = col
      while (col < width && mask[row * width + col]) col++
      const key = `${start}:${col - start}`, above = previous.get(key)
      if (above) { above.height++; current.set(key, above) }
      else { const rect = { x: start, y: row, width: col - start, height: 1 }; rectangles.push(rect); current.set(key, rect) }
    }
    previous = current
  }
  return rectangles
}
