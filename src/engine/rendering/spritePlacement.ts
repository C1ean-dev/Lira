export interface SpritePlacement {
  offsetX: number
  offsetY: number
  drawWidth: number
  drawHeight: number
}

export function resolveSpritePlacement(
  imageWidth: number,
  imageHeight: number,
  areaWidth: number,
  areaHeight: number
): SpritePlacement {
  if (imageWidth === areaWidth && imageHeight === areaHeight) {
    return { offsetX: 0, offsetY: 0, drawWidth: areaWidth, drawHeight: areaHeight }
  }
  if (imageWidth <= areaWidth && imageHeight <= areaHeight) {
    return {
      offsetX: Math.round((areaWidth - imageWidth) / 2),
      offsetY: areaHeight - imageHeight,
      drawWidth: imageWidth,
      drawHeight: imageHeight,
    }
  }
  const scale = Math.min(areaWidth / imageWidth, areaHeight / imageHeight)
  const drawWidth = Math.max(1, Math.round(imageWidth * scale))
  const drawHeight = Math.max(1, Math.round(imageHeight * scale))
  return {
    offsetX: Math.round((areaWidth - drawWidth) / 2),
    offsetY: areaHeight - drawHeight,
    drawWidth,
    drawHeight,
  }
}
