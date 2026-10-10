export interface SpritePlacement {
  /** Offset of the drawn sprite from the top-left of the furniture's area, in px. */
  offsetX: number
  offsetY: number
  /** Size the sprite is drawn at, in px. */
  drawWidth: number
  drawHeight: number
}

/**
 * Where a custom furniture sprite is drawn inside its area (`areaWidth` x `areaHeight`, the "Tamanho" of the
 * asset). The renderer draws it there, and the hitbox is worked out from the same rectangle, so what is
 * drawn and what blocks cannot drift apart.
 *
 * - exactly the size of the area: 1:1;
 * - smaller than the area: 1:1, centred horizontally and resting on the bottom edge (the floor);
 * - bigger: scaled down to fit without distortion, centred horizontally and resting on the bottom edge.
 */
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
