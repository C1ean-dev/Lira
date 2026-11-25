import type { AvatarEffectDensity, Direction } from '../../../types/game'
import { TILE_SIZE } from '../../Constants'
import { deriveEffectPalette } from '../palette'
import {
  renderEffectParticles,
  resolveParticleColors,
  stepEffectParticles,
} from '../pixelSprites'
import { resolveStepsSpec } from '../presets'
import type {
  AvatarEffectContext,
  AvatarEffectModule,
  AvatarEffectParticle,
  ResolvedEffectSpec,
} from '../types'

interface TrackedWalker {
  x: number
  y: number
  distanceAccum: number
  lastSeenAt: number
}

function directionBehindOffset(dir: Direction): { dx: number; dy: number } {
  switch (dir) {
    case 'right':
      return { dx: -0.22, dy: 0 }
    case 'left':
      return { dx: 0.22, dy: 0 }
    case 'down':
      return { dx: 0, dy: -0.18 }
    case 'up':
      return { dx: 0, dy: 0.14 }
    default:
      return { dx: 0, dy: 0 }
  }
}

function densityStepFactor(density: AvatarEffectDensity): number {
  switch (density) {
    case 'subtle':
      return 1.45
    case 'intense':
      return 0.65
    default:
      return 1
  }
}

export class StepsTrailEffect implements AvatarEffectModule {
  public readonly id = 'avatar:steps'
  public enabled = true

  private readonly stepDistanceTiles: number
  private readonly teleportThresholdTiles: number
  private readonly maxParticles: number
  private readonly rng: () => number
  private particles: AvatarEffectParticle[] = []
  private walkers = new Map<string, TrackedWalker>()

  constructor(options?: {
    stepDistanceTiles?: number
    teleportThresholdTiles?: number
    maxParticles?: number
    rng?: () => number
  }) {
    this.stepDistanceTiles = options?.stepDistanceTiles ?? 0.34
    this.teleportThresholdTiles = options?.teleportThresholdTiles ?? 3.5
    this.maxParticles = options?.maxParticles ?? 160
    this.rng = options?.rng ?? Math.random
  }

  public getParticles(): readonly AvatarEffectParticle[] {
    return this.particles
  }

  public reset(): void {
    this.particles = []
    this.walkers.clear()
  }

  public update(deltaTime: number, context: AvatarEffectContext): void {
    stepEffectParticles(this.particles, deltaTime)
    if (!this.enabled) return

    const activeIds = new Set<string>()
    for (let i = 0; i < context.players.length; i++) {
      const player = context.players[i]
      const spec = resolveStepsSpec(player.avatar?.steps)
      if (!spec) continue

      activeIds.add(player.id)
      const tracker = this.walkers.get(player.id)
      if (!tracker) {
        this.walkers.set(player.id, {
          x: player.x,
          y: player.y,
          distanceAccum: 0,
          lastSeenAt: context.now,
        })
        continue
      }

      const moved = Math.hypot(player.x - tracker.x, player.y - tracker.y)
      tracker.x = player.x
      tracker.y = player.y
      tracker.lastSeenAt = context.now

      if (moved > this.teleportThresholdTiles) {
        tracker.distanceAccum = 0
        continue
      }

      if (moved > 0.005) {
        tracker.distanceAccum += moved
        const step = Math.max(0.08, this.stepDistanceTiles * densityStepFactor(spec.density))
        let spawns = 0
        while (tracker.distanceAccum >= step && spawns < 3) {
          tracker.distanceAccum -= step
          this.spawnParticle(player.x, player.y, player.direction || 'down', spec)
          spawns++
        }
      }
    }

    for (const [id, tracker] of this.walkers) {
      if (!activeIds.has(id) && context.now - tracker.lastSeenAt > 3000) {
        this.walkers.delete(id)
      }
    }
  }

  public renderGround(ctx: CanvasRenderingContext2D, currentTime: number): void {
    if (!this.enabled && this.particles.length === 0) return
    renderEffectParticles(ctx, this.particles, currentTime)
  }

  private spawnParticle(
    tileX: number,
    tileY: number,
    direction: Direction,
    spec: ResolvedEffectSpec
  ): void {
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift()
    }

    const palette = deriveEffectPalette(spec.color)
    const shape = spec.shapes[Math.floor(this.rng() * spec.shapes.length) % spec.shapes.length]
    const { color, secondaryColor, twinkle } = spec.pixelMatrix
      ? { color: palette.flowerPrimary, secondaryColor: palette.highlight, twinkle: spec.motion === 'orbit' || spec.motion === 'spark' }
      : resolveParticleColors(shape, palette, this.rng)

    const behind = directionBehindOffset(direction)
    const jitterX = (this.rng() - 0.5) * 10
    const jitterY = (this.rng() - 0.5) * 6

    let vx = (this.rng() - 0.5) * 7
    let vy = -(2.5 + this.rng() * 5)
    let gravity = shape === 'petal' || shape === 'leaf' ? 2.5 : 0
    let maxAge = 0.85 + this.rng() * 0.55
    let swayAmp = 1.5 + this.rng() * 2.5

    if (spec.motion === 'rise') {
      vy = -(10 + this.rng() * 9)
      vx = (this.rng() - 0.5) * 8
      gravity = -2
      maxAge = 0.65 + this.rng() * 0.4
    } else if (spec.motion === 'fall') {
      vy = 2 + this.rng() * 4
      gravity = 5
      swayAmp = 2.5 + this.rng() * 3
    } else if (spec.motion === 'spark') {
      const a = this.rng() * Math.PI * 2
      const s = 14 + this.rng() * 16
      vx = Math.cos(a) * s
      vy = Math.sin(a) * s
      maxAge = 0.4 + this.rng() * 0.35
      swayAmp = 0.5
    }

    this.particles.push({
      x: (tileX + 0.5 + behind.dx) * TILE_SIZE + jitterX,
      y: (tileY + 0.86 + behind.dy) * TILE_SIZE + jitterY,
      vx,
      vy,
      age: 0,
      maxAge,
      shape,
      customMatrix: spec.pixelMatrix,
      color,
      secondaryColor,
      outlineColor: palette.outline,
      scale: 1,
      swayAmp,
      swayFreq: 3.5 + this.rng() * 2.5,
      phase: this.rng() * Math.PI * 2,
      gravity,
      drag: 1.4,
      twinkle,
    })
  }
}
