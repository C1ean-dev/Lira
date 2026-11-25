import type { AvatarEffectPalette, AvatarEffectParticle, ParticleShape } from './types'

// 0 = transparent, 1 = primary fill, 2 = bright center/highlight, 3 = outline
export const SHAPE_MATRICES: Record<ParticleShape, readonly string[]> = {
  flower: [
    '0031300',
    '0311130',
    '3112113',
    '1122211',
    '3112113',
    '0311130',
    '0031300',
  ],
  petal: [
    '0312',
    '3113',
    '0330',
  ],
  star: [
    '0003000',
    '0031300',
    '0312130',
    '3122213',
    '0312130',
    '0031300',
    '0003000',
  ],
  sparkle: [
    '00100',
    '01210',
    '12221',
    '01210',
    '00100',
  ],
  heart: [
    '033000330',
    '311303113',
    '312131113',
    '311111113',
    '031111130',
    '003111300',
    '000313000',
    '000030000',
  ],
  flame: [
    '0003000',
    '0031300',
    '0311130',
    '0312130',
    '3112113',
    '3122213',
    '3122213',
    '0312130',
    '0033300',
  ],
  ember: [
    '0310',
    '3123',
    '0310',
  ],
  sunray: [
    '000010000',
    '010020010',
    '002121200',
    '001222100',
    '122222221',
    '001222100',
    '002121200',
    '010020010',
    '000010000',
  ],
  lightning: [
    '0003130',
    '0031230',
    '0312130',
    '3122113',
    '0331213',
    '0031230',
    '0312300',
    '0313000',
    '0030000',
  ],
  snowflake: [
    '0001000',
    '0102010',
    '0012100',
    '1222221',
    '0012100',
    '0102010',
    '0001000',
  ],
  leaf: [
    '000313',
    '003123',
    '031213',
    '312130',
    '031300',
    '330000',
  ],
  bubble: [
    '0033300',
    '0312130',
    '3120013',
    '3100013',
    '0311130',
    '0033300',
  ],
  music: [
    '0003113',
    '0003123',
    '0003130',
    '0003130',
    '0333130',
    '3121130',
    '3111300',
    '0333000',
  ],
}

export function drawPixelMatrix(
  ctx: CanvasRenderingContext2D,
  matrix: readonly string[],
  centerX: number,
  centerY: number,
  pixelSize: number,
  primaryColor: string,
  accentColor: string,
  outlineColor: string
) {
  const rows = matrix.length
  if (rows === 0) return
  const cols = matrix[0]?.length || 0
  if (cols === 0) return
  const originX = Math.round(centerX - (cols * pixelSize) / 2)
  const originY = Math.round(centerY - (rows * pixelSize) / 2)

  for (let row = 0; row < rows; row++) {
    const line = matrix[row]
    for (let col = 0; col < line.length; col++) {
      const cell = line[col]
      if (cell === '0' || cell === ' ') continue
      ctx.fillStyle = cell === '3' ? outlineColor : cell === '2' ? accentColor : primaryColor
      ctx.fillRect(
        originX + col * pixelSize,
        originY + row * pixelSize,
        pixelSize,
        pixelSize
      )
    }
  }
}

export function drawPixelShape(
  ctx: CanvasRenderingContext2D,
  shape: ParticleShape,
  x: number,
  y: number,
  scale: number,
  primaryColor: string,
  accentColor: string,
  outlineColor: string = '#581c87',
  customMatrix?: readonly string[]
) {
  const pixelSize = Math.max(1, Math.round(scale))
  const matrix = customMatrix && customMatrix.length > 0 ? customMatrix : SHAPE_MATRICES[shape]
  drawPixelMatrix(ctx, matrix, x, y, pixelSize, primaryColor, accentColor, outlineColor)
}

export function resolveParticleColors(
  shape: ParticleShape,
  palette: AvatarEffectPalette,
  rng: () => number
): { color: string; secondaryColor: string; twinkle: boolean } {
  const pick = (items: readonly string[]) => items[Math.floor(rng() * items.length) % items.length]

  switch (shape) {
    case 'flower':
      return {
        color: rng() < 0.55 ? palette.flowerPrimary : palette.flowerSecondary,
        secondaryColor: palette.flowerCenter,
        twinkle: false,
      }
    case 'petal':
    case 'leaf':
      return {
        color: pick(palette.petals),
        secondaryColor: palette.highlight,
        twinkle: false,
      }
    case 'flame':
    case 'ember':
      return {
        color: pick(palette.flames),
        secondaryColor: '#fef08a',
        twinkle: shape === 'ember',
      }
    case 'sunray':
      return {
        color: palette.flowerPrimary,
        secondaryColor: '#fef9c3',
        twinkle: true,
      }
    case 'lightning':
      return {
        color: pick(palette.stars),
        secondaryColor: '#ffffff',
        twinkle: true,
      }
    case 'snowflake':
    case 'bubble':
      return {
        color: pick(palette.stars),
        secondaryColor: '#ffffff',
        twinkle: shape === 'snowflake',
      }
    case 'star':
    case 'sparkle':
      return {
        color: pick(palette.stars),
        secondaryColor: palette.highlight,
        twinkle: true,
      }
    case 'heart':
    case 'music':
      return {
        color: pick(palette.hearts),
        secondaryColor: palette.highlight,
        twinkle: false,
      }
  }
}

export function renderEffectParticles(
  ctx: CanvasRenderingContext2D,
  particles: readonly AvatarEffectParticle[],
  currentTime: number
) {
  if (particles.length === 0) return

  ctx.save()
  ctx.imageSmoothingEnabled = false

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    const progress = p.age / p.maxAge
    if (progress < 0 || progress >= 1) continue

    const fadeIn = Math.min(1, progress / 0.12)
    const fadeOut = progress > 0.65 ? 1 - (progress - 0.65) / 0.35 : 1
    let alpha = Math.max(0, Math.min(1, fadeIn * fadeOut))

    if (p.twinkle) {
      const shimmer = 0.68 + 0.32 * Math.sin(currentTime / 95 + p.phase)
      alpha *= shimmer
    }

    if (alpha <= 0.02) continue

    const swayX = p.swayAmp !== 0
      ? Math.sin(p.age * p.swayFreq + p.phase) * p.swayAmp
      : 0

    ctx.globalAlpha = alpha
    drawPixelShape(
      ctx,
      p.shape,
      p.x + swayX,
      p.y,
      p.scale,
      p.color,
      p.secondaryColor,
      p.outlineColor,
      p.customMatrix
    )
  }

  ctx.restore()
}

export function stepEffectParticles(particles: AvatarEffectParticle[], deltaTime: number) {
  const dt = Math.max(0, Math.min(deltaTime, 0.1))
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.age += dt
    if (p.age >= p.maxAge) {
      particles.splice(i, 1)
      continue
    }
    if (p.drag > 0) {
      const damping = Math.max(0, 1 - p.drag * dt)
      p.vx *= damping
      p.vy *= damping
    }
    p.vy += p.gravity * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
  }
}
