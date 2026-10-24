interface SpritePlacement { x: number; y: number; width: number; height: number }

/** Animate only the interior fabric; the wood and pillows stay in the base sprite. */
export function drawBedClothMotion(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  placement: SpritePlacement,
  elapsedMs: number,
) {
  if (!Number.isFinite(elapsedMs)) return
  const sourceWidth = image.naturalWidth, sourceHeight = image.naturalHeight
  const columns = 16
  const left = .16, top = .36, width = .75, height = .37
  const phase = elapsedMs / 1500 * Math.PI * 2
  const amplitude = placement.height * .035
  for (let column = 0; column < columns; column++) {
    const position = (column + .5) / columns
    const envelope = Math.sin(position * Math.PI)
    const offset = Math.sin(phase + position * Math.PI * 2) * amplitude * envelope
    const x = left + column / columns * width
    // Slightly overlap adjacent strips so fractional zoom cannot create gaps.
    const stripWidth = width / columns + .002
    ctx.drawImage(image,
      x * sourceWidth, top * sourceHeight, stripWidth * sourceWidth, height * sourceHeight,
      placement.x + x * placement.width, placement.y + top * placement.height + offset,
      stripWidth * placement.width, height * placement.height - offset,
    )
  }
}
