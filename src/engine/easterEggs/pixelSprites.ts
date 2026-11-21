import type { EasterEggPalette, EasterEggParticle, ParticleShape } from './types'

// 0 = transparent, 1 = primary fill, 2 = bright center/highlight, 3 = deep purple outline
const FLOWER_MATRIX = [
  '0031300',
  '0311130',
  '3112113',
  '1122211',
  '3112113',
  '0311130',
  '0031300',
]

const STAR_MATRIX = [
  '0003000',
  '0031300',
  '0312130',
  '3122213',
  '0312130',
  '0031300',
  '0003000',
]

const SPARKLE_MATRIX = [
  '00100',
  '01210',
  '12221',
  '01210',
  '00100',
]

const HEART_MATRIX = [
  '033000330',
  '311303113',
  '312131113',
  '311111113',
  '031111130',
  '003111300',
  '000313000',
  '000030000',
]

const PETAL_MATRIX = [
  '0312',
  '3113',
  '0330',
]

function drawPixelMatrix(
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
  const cols = matrix[0].length
  const originX = Math.round(centerX - (cols * pixelSize) / 2)
  const originY = Math.round(centerY - (rows * pixelSize) / 2)

  for (let row = 0; row < rows; row++) {
    const line = matrix[row]
    for (let col = 0; col < cols; col++) {
      const cell = line[col]
      if (cell === '0') continue
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
  outlineColor: string = '#581c87'
) {
  const pixelSize = Math.max(1, Math.round(scale))
  switch (shape) {
    case 'flower':
      drawPixelMatrix(ctx, FLOWER_MATRIX, x, y, pixelSize, primaryColor, accentColor, outlineColor)
      break
    case 'petal':
      drawPixelMatrix(ctx, PETAL_MATRIX, x, y, pixelSize, primaryColor, accentColor, outlineColor)
      break
    case 'star':
      drawPixelMatrix(ctx, STAR_MATRIX, x, y, pixelSize, primaryColor, accentColor, outlineColor)
      break
    case 'sparkle':
      drawPixelMatrix(ctx, SPARKLE_MATRIX, x, y, pixelSize, primaryColor, accentColor, outlineColor)
      break
    case 'heart':
      drawPixelMatrix(ctx, HEART_MATRIX, x, y, pixelSize, primaryColor, accentColor, outlineColor)
      break
  }
}

export function renderEasterEggParticles(
  ctx: CanvasRenderingContext2D,
  particles: readonly EasterEggParticle[],
  palette: EasterEggPalette,
  currentTime: number
) {
  if (particles.length === 0) return

  ctx.save()
  ctx.imageSmoothingEnabled = false

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]
    const progress = p.age / p.maxAge
    if (progress < 0 || progress >= 1) continue

    // Smooth ease-in at birth and soft fade-out near end of life.
    const fadeIn = Math.min(1, progress / 0.1)
    const fadeOut = progress > 0.65 ? 1 - (progress - 0.65) / 0.35 : 1
    let alpha = Math.max(0, Math.min(1, fadeIn * fadeOut))

    if (p.twinkle) {
      const shimmer = 0.7 + 0.3 * Math.sin(currentTime / 110 + p.phase)
      alpha *= shimmer
    }

    if (alpha <= 0.02) continue

    const swayX = p.swayAmp !== 0
      ? Math.sin(p.age * p.swayFreq + p.phase) * p.swayAmp
      : 0

    ctx.globalAlpha = alpha
    const accent = p.secondaryColor ?? (p.shape === 'flower' ? palette.flowerCenter : palette.highlight)
    drawPixelShape(ctx, p.shape, p.x + swayX, p.y, p.scale, p.color, accent, palette.outline)
  }

  ctx.restore()
}

export function stepEasterEggParticles(particles: EasterEggParticle[], deltaTime: number) {
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
