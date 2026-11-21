import { matchesNickname } from '../matchers'
import { drawPixelShape } from '../pixelSprites'
import type {
  EasterEggContext,
  EasterEggEffect,
  EasterEggPalette,
  ParticleShape,
  ScreenHeartsBorderConfig,
} from '../types'

type ScreenEdge = 'top' | 'right' | 'bottom' | 'left'

interface BorderOrnament {
  edge: ScreenEdge
  /** Normalized progress along the edge in [0, 1]. */
  t: number
  /** Distance inward from the viewport edge in px. */
  depth: number
  /** Slow drift along the edge (normalized units per second). */
  driftSpeed: number
  bobAmp: number
  bobFreq: number
  pulseFreq: number
  phase: number
  shape: ParticleShape
  color: string
  secondaryColor: string
  scale: number
  baseAlpha: number
}

const EDGES: readonly ScreenEdge[] = ['top', 'right', 'bottom', 'left']

function pickRandom<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length]
}

export class ScreenHeartsBorderEffect implements EasterEggEffect {
  public readonly id: string
  public enabled: boolean

  private readonly config: ScreenHeartsBorderConfig
  private readonly palette: EasterEggPalette
  private readonly rng: () => number
  private ornaments: BorderOrnament[] = []
  private isLocalViewerMatched = false
  private elapsed = 0

  constructor(
    id: string,
    config: ScreenHeartsBorderConfig,
    palette: EasterEggPalette,
    rng: () => number = Math.random
  ) {
    this.id = id
    this.enabled = config.enabled
    this.config = config
    this.palette = palette
    this.rng = rng
    this.ornaments = this.buildOrnaments()
  }

  public isActiveForLocalViewer(): boolean {
    return this.enabled && this.isLocalViewerMatched
  }

  public reset(): void {
    this.isLocalViewerMatched = false
    this.elapsed = 0
    this.ornaments = this.buildOrnaments()
  }

  public update(deltaTime: number, context: EasterEggContext): void {
    if (!this.enabled) {
      this.isLocalViewerMatched = false
      return
    }

    this.isLocalViewerMatched = matchesNickname(context.localPlayer, this.config.targets)
    if (!this.isLocalViewerMatched) return

    const dt = Math.max(0, Math.min(deltaTime, 0.1))
    this.elapsed += dt

    for (let i = 0; i < this.ornaments.length; i++) {
      const item = this.ornaments[i]
      item.t += item.driftSpeed * dt
      if (item.t > 1) item.t -= 1
      else if (item.t < 0) item.t += 1
    }
  }

  public renderScreenOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    _currentTime: number
  ): void {
    if (!this.enabled || !this.isLocalViewerMatched) return
    if (width <= 0 || height <= 0) return

    ctx.save()
    ctx.imageSmoothingEnabled = false

    this.drawCornerGlow(ctx, width, height)

    const padX = Math.min(28, width * 0.04)
    const padY = Math.min(28, height * 0.04)
    const spanX = Math.max(1, width - padX * 2)
    const spanY = Math.max(1, height - padY * 2)

    for (let i = 0; i < this.ornaments.length; i++) {
      const item = this.ornaments[i]
      const bob = Math.sin(this.elapsed * item.bobFreq + item.phase) * item.bobAmp
      const pulse = 0.62 + 0.38 * Math.sin(this.elapsed * item.pulseFreq + item.phase)

      // Smooth fade near wrap endpoints (t close to 0 or 1) so hearts glide seamlessly.
      const edgeFade = Math.min(1, Math.min(item.t, 1 - item.t) / 0.08)
      const alpha = Math.max(0, Math.min(1, item.baseAlpha * pulse * edgeFade))
      if (alpha <= 0.02) continue

      let x = 0
      let y = 0
      switch (item.edge) {
        case 'top':
          x = padX + item.t * spanX
          y = item.depth + bob
          break
        case 'bottom':
          x = padX + item.t * spanX
          y = height - item.depth + bob
          break
        case 'left':
          x = item.depth + bob
          y = padY + item.t * spanY
          break
        case 'right':
          x = width - item.depth + bob
          y = padY + item.t * spanY
          break
      }

      ctx.globalAlpha = alpha
      drawPixelShape(
        ctx,
        item.shape,
        x,
        y,
        item.scale,
        item.color,
        item.secondaryColor,
        this.palette.outline
      )
    }

    ctx.restore()
  }

  private drawCornerGlow(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (typeof ctx.createRadialGradient !== 'function') return

    const radius = Math.max(120, Math.min(width, height) * 0.28)
    const breath = 0.075 + 0.025 * Math.sin(this.elapsed * 1.4)
    const corners: readonly [number, number][] = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ]

    for (let i = 0; i < corners.length; i++) {
      const [cx, cy] = corners[i]
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
      grad.addColorStop(0, `rgba(168, 85, 247, ${breath.toFixed(3)})`)
      grad.addColorStop(0.55, `rgba(192, 132, 252, ${(breath * 0.35).toFixed(3)})`)
      grad.addColorStop(1, 'rgba(168, 85, 247, 0)')
      ctx.fillStyle = grad
      ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
    }
  }

  private buildOrnaments(): BorderOrnament[] {
    const items: BorderOrnament[] = []
    const margin = Math.max(18, this.config.marginPx)

    // Primary pixel-art purple hearts framing all 4 edges of the screen.
    for (let i = 0; i < this.config.heartCount; i++) {
      const edge = EDGES[i % EDGES.length]
      const indexOnEdge = Math.floor(i / EDGES.length)
      const countOnEdge = Math.max(1, Math.ceil(this.config.heartCount / EDGES.length))
      const baseT = (indexOnEdge + 0.5) / countOnEdge
      const jitterT = (this.rng() - 0.5) * (0.45 / countOnEdge)
      const t = Math.max(0.04, Math.min(0.96, baseT + jitterT))
      const direction = edge === 'top' || edge === 'right' ? 1 : -1

      items.push({
        edge,
        t,
        depth: 14 + this.rng() * (margin - 10),
        driftSpeed: direction * (0.008 + this.rng() * 0.012),
        bobAmp: 3 + this.rng() * 3.5,
        bobFreq: 1.4 + this.rng() * 1.1,
        pulseFreq: 1.6 + this.rng() * 1.4,
        phase: this.rng() * Math.PI * 2,
        shape: 'heart',
        color: pickRandom(this.palette.hearts, this.rng),
        secondaryColor: this.palette.highlight,
        scale: this.rng() < 0.72 ? 2 : 1,
        baseAlpha: 0.48 + this.rng() * 0.3,
      })
    }

    // Subtle purple star & flower accents tucked along the same frame.
    for (let i = 0; i < this.config.accentSparkleCount; i++) {
      const edge = EDGES[i % EDGES.length]
      const roll = this.rng()
      const shape: ParticleShape = roll < 0.45 ? 'star' : roll < 0.75 ? 'sparkle' : 'flower'
      const isFlower = shape === 'flower'
      const direction = edge === 'bottom' || edge === 'left' ? 1 : -1

      items.push({
        edge,
        t: 0.05 + this.rng() * 0.9,
        depth: 10 + this.rng() * (margin - 6),
        driftSpeed: direction * (0.006 + this.rng() * 0.009),
        bobAmp: 2 + this.rng() * 2.5,
        bobFreq: 1.8 + this.rng() * 1.2,
        pulseFreq: 2.4 + this.rng() * 1.8,
        phase: this.rng() * Math.PI * 2,
        shape,
        color: isFlower
          ? (this.rng() < 0.5 ? this.palette.flowerPrimary : this.palette.flowerSecondary)
          : pickRandom(this.palette.stars, this.rng),
        secondaryColor: isFlower ? this.palette.flowerCenter : this.palette.highlight,
        scale: shape === 'sparkle' ? 2 : 1,
        baseAlpha: 0.4 + this.rng() * 0.28,
      })
    }

    return items
  }
}
