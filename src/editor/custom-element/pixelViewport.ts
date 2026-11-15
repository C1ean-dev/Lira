export interface PixelViewport { x: number; y: number; zoom: number }
export interface ViewportPoint { x: number; y: number }
const clampZoom = (zoom: number) => Math.max(.125, Math.min(64, zoom))

export function fitPixelViewport(width: number, height: number, imageWidth: number, imageHeight: number): PixelViewport {
  const zoom = clampZoom(Math.min(Math.max(1, width - 48) / imageWidth, Math.max(1, height - 48) / imageHeight))
  return { zoom, x: (width - imageWidth * zoom) / 2, y: (height - imageHeight * zoom) / 2 }
}
export function zoomPixelViewport(view: PixelViewport, cursor: ViewportPoint, requestedZoom: number): PixelViewport {
  const zoom = clampZoom(requestedZoom)
  return { zoom, x: cursor.x - (cursor.x - view.x) / view.zoom * zoom, y: cursor.y - (cursor.y - view.y) / view.zoom * zoom }
}
export function pixelFromViewport(view: PixelViewport, point: ViewportPoint, width: number, height: number): ViewportPoint {
  return { x: Math.min(width - 1, Math.max(0, Math.floor((point.x - view.x) / view.zoom))),
    y: Math.min(height - 1, Math.max(0, Math.floor((point.y - view.y) / view.zoom))) }
}
