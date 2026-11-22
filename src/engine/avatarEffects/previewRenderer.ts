import type { AvatarConfig } from '../../types/game'
import { deriveEffectPalette, hexToRgba } from './palette'
import { drawPixelMatrix, drawPixelShape } from './pixelSprites'
import { resolveAuraSpec, resolveStepsSpec } from './presets'
import type { AvatarEffectPalette, ParticleShape } from './types'

function shapePreviewColors(
  shape: ParticleShape,
  palette: AvatarEffectPalette,
  index: number
): { primary: string; secondary: string } {
  switch (shape) {
    case 'flower':
      return {
        primary: index % 2 === 0 ? palette.flowerPrimary : palette.flowerSecondary,
        secondary: palette.flowerCenter,
      }
    case 'petal':
    case 'leaf':
      return {
        primary: palette.petals[index % palette.petals.length],
        secondary: palette.highlight,
      }
    case 'flame':
    case 'ember':
      return {
        primary: palette.flames[index % palette.flames.length],
        secondary: '#fef08a',
      }
    case 'sunray':
      return {
        primary: palette.flowerPrimary,
        secondary: '#fef9c3',
      }
    case 'lightning':
    case 'snowflake':
    case 'bubble':
      return {
        primary: palette.stars[index % palette.stars.length],
        secondary: '#ffffff',
      }
    case 'star':
    case 'sparkle':
      return {
        primary: palette.stars[index % palette.stars.length],
        secondary: palette.highlight,
      }
    case 'heart':
    case 'music':
      return {
        primary: palette.hearts[index % palette.hearts.length],
        secondary: palette.highlight,
      }
  }
}

/**
 * Draws animated walking-steps preview (plus aura ground halo when enabled)
 * behind the avatar in AvatarPreviewCanvas (in 32x32 avatar-local coordinates).
 */
export function drawAvatarStepsPreview(
  ctx: CanvasRenderingContext2D,
  avatar: AvatarConfig,
  tick: number,
  size: number = 32
): void {
  const t = tick / 1000
  const auraSpec = resolveAuraSpec(avatar.aura)
  if (auraSpec?.glowHalo && typeof ctx.createRadialGradient === 'function') {
    ctx.save()
    const pulse = 0.8 + 0.2 * Math.sin(t * 2.5)
    const cx = size * 0.5
    const cy = size * 0.56
    const radius = 19 + pulse * 4
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius)
    grad.addColorStop(0, hexToRgba(auraSpec.color, 0.28 * pulse))
    grad.addColorStop(0.6, hexToRgba(auraSpec.color, 0.12 * pulse))
    grad.addColorStop(1, hexToRgba(auraSpec.color, 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  const spec = resolveStepsSpec(avatar.steps)
  if (!spec) return

  const palette = deriveEffectPalette(spec.color)
  const count = spec.density === 'intense' ? 7 : spec.density === 'subtle' ? 4 : 5

  ctx.save()
  ctx.imageSmoothingEnabled = false

  for (let i = 0; i < count; i++) {
    const speed = spec.motion === 'rise' ? 1.0 : spec.motion === 'spark' ? 1.25 : 0.72
    const cycle = (t * speed + i / count) % 1
    const alpha = Math.min(1, cycle / 0.15) * (cycle > 0.65 ? 1 - (cycle - 0.65) / 0.35 : 1)
    if (alpha <= 0.03) continue

    const lane = ((i % 3) - 1) * 5.8
    const x = size * 0.5 + lane + Math.sin(t * 3 + i * 1.7) * 2
    const y = size * 0.9 - cycle * 15
    const shape = spec.shapes[i % spec.shapes.length]
    const { primary, secondary } = spec.pixelMatrix
      ? { primary: palette.flowerPrimary, secondary: palette.highlight }
      : shapePreviewColors(shape, palette, i)

    ctx.globalAlpha = alpha * 0.94
    drawPixelShape(ctx, shape, x, y, 1, primary, secondary, palette.outline, spec.pixelMatrix)
  }

  ctx.restore()
}

/**
 * Draws animated aura preview around the avatar in AvatarPreviewCanvas
 * (in 32x32 avatar-local coordinates).
 */
export function drawAvatarAuraPreview(
  ctx: CanvasRenderingContext2D,
  avatar: AvatarConfig,
  tick: number,
  size: number = 32
): void {
  const spec = resolveAuraSpec(avatar.aura)
  if (!spec) return

  const palette = deriveEffectPalette(spec.color)
  const count = spec.density === 'intense' ? 8 : spec.density === 'subtle' ? 4 : 6
  const t = tick / 1000

  ctx.save()
  ctx.imageSmoothingEnabled = false

  for (let i = 0; i < count; i++) {
    let x = size * 0.5
    let y = size * 0.44
    let alpha = 0.85

    if (spec.motion === 'rise') {
      const cycle = (t * 0.95 + i / count) % 1
      const spread = Math.sin(i * 2.3) * 14
      x = size * 0.5 + spread + Math.sin(t * 4 + i) * 2
      y = size * 0.86 - cycle * 28
      alpha = Math.min(1, cycle / 0.15) * (1 - cycle * 0.85)
    } else if (spec.motion === 'fall') {
      const cycle = (t * 0.65 + i / count) % 1
      const spread = Math.cos(i * 1.9) * 16
      x = size * 0.5 + spread + Math.sin(t * 2.5 + i) * 3
      y = size * 0.05 + cycle * 26
      alpha = Math.min(1, cycle / 0.15) * (1 - cycle * 0.8)
    } else if (spec.motion === 'spark') {
      const cycle = (t * 1.45 + i / count) % 1
      const angle = i * 2.1 + Math.floor(t * 2) * 0.7
      const r = 10 + cycle * 9
      x = size * 0.5 + Math.cos(angle) * r
      y = size * 0.45 + Math.sin(angle) * (r * 0.8)
      alpha = Math.max(0, 1 - cycle)
    } else {
      const angle = (i / count) * Math.PI * 2 + t * (spec.motion === 'orbit' ? 1.15 : 0.85)
      const floatY = Math.sin(t * 2.4 + i * 1.3) * 3.2
      x = size * 0.5 + Math.cos(angle) * 16.5
      y = size * 0.44 + Math.sin(angle) * 11.5 + floatY
      alpha = 0.68 + 0.32 * Math.sin(t * 3.5 + i * 2.1)
    }

    if (alpha <= 0.03) continue

    const shape = spec.shapes[i % spec.shapes.length]
    const { primary, secondary } = spec.pixelMatrix
      ? { primary: palette.flowerPrimary, secondary: palette.highlight }
      : shapePreviewColors(shape, palette, i)

    ctx.globalAlpha = alpha
    drawPixelShape(ctx, shape, x, y, 1, primary, secondary, palette.outline, spec.pixelMatrix)
  }

  ctx.restore()
}

/**
 * Draws a crisp thumbnail icon of an effect preset or custom pixel matrix inside an option card.
 */
export function drawEffectPresetIcon(
  ctx: CanvasRenderingContext2D,
  shapes: readonly ParticleShape[],
  colorHex: string | undefined,
  width: number,
  height: number,
  customMatrix?: readonly string[]
): void {
  ctx.clearRect(0, 0, width, height)
  const palette = deriveEffectPalette(colorHex)

  ctx.save()
  ctx.imageSmoothingEnabled = false

  if (customMatrix && customMatrix.some((row) => /[123]/.test(row))) {
    const maxDim = Math.max(customMatrix.length, customMatrix[0]?.length || 1)
    const pixelSize = Math.max(2, Math.floor((Math.min(width, height) - 10) / maxDim))
    drawPixelMatrix(
      ctx,
      customMatrix,
      width * 0.5,
      height * 0.5,
      pixelSize,
      palette.flowerPrimary,
      palette.highlight,
      palette.outline
    )
    ctx.restore()
    return
  }

  if (shapes.length === 0) {
    ctx.restore()
    return
  }

  const positions: readonly [number, number, number][] =
    shapes.length === 1
      ? [[width * 0.5, height * 0.5, 2]]
      : shapes.length === 2
        ? [
            [width * 0.36, height * 0.54, 2],
            [width * 0.68, height * 0.36, 2],
          ]
        : [
            [width * 0.32, height * 0.58, 2],
            [width * 0.66, height * 0.34, 2],
            [width * 0.64, height * 0.7, 2],
          ]

  for (let i = 0; i < Math.min(shapes.length, positions.length); i++) {
    const shape = shapes[i]
    const [x, y, scale] = positions[i]
    const { primary, secondary } = shapePreviewColors(shape, palette, i)
    drawPixelShape(ctx, shape, x, y, scale, primary, secondary, palette.outline)
  }

  ctx.restore()
}
