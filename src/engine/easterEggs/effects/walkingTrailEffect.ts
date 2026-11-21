import type { Direction } from '../../../types/game'
import { TILE_SIZE } from '../../Constants'
import { matchesNickname } from '../matchers'
import { renderEasterEggParticles, stepEasterEggParticles } from '../pixelSprites'
import type {
  EasterEggContext,
  EasterEggEffect,
  EasterEggPalette,
  EasterEggParticle,
  ParticleShape,
  WalkingTrailConfig,
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

function pickRandom<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length]
}

export class WalkingTrailEffect implements EasterEggEffect {
  public readonly id: string
  public enabled: boolean

  private readonly config: WalkingTrailConfig
  private readonly palette: EasterEggPalette
  private readonly rng: () => number
  private particles: EasterEggParticle[] = []
  private walkers = new Map<string, TrackedWalker>()

  constructor(
    id: string,
    config: WalkingTrailConfig,
    palette: EasterEggPalette,
    rng: () => number = Math.random
  ) {
    this.id = id
    this.enabled = config.enabled
    this.config = config
    this.palette = palette
    this.rng = rng
  }

  public getParticles(): readonly EasterEggParticle[] {
    return this.particles
  }

  public reset(): void {
    this.particles = []
    this.walkers.clear()
  }

  public update(deltaTime: number, context: EasterEggContext): void {
    stepEasterEggParticles(this.particles, deltaTime)
    if (!this.enabled) return

    const activeIds = new Set<string>()
    for (let i = 0; i < context.players.length; i++) {
      const player = context.players[i]
      if (!matchesNickname(player, this.config.targets)) continue

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

      if (moved > this.config.teleportThresholdTiles) {
        tracker.distanceAccum = 0
        continue
      }

      if (moved > 0.005) {
        tracker.distanceAccum += moved
        const step = Math.max(0.08, this.config.stepDistanceTiles)
        let spawns = 0
        while (tracker.distanceAccum >= step && spawns < 3) {
          tracker.distanceAccum -= step
          this.spawnTrailParticle(player.x, player.y, player.direction || 'down')
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
    renderEasterEggParticles(ctx, this.particles, this.palette, currentTime)
  }

  private spawnTrailParticle(tileX: number, tileY: number, direction: Direction): void {
    if (this.particles.length >= this.config.maxParticles) {
      this.particles.shift()
    }

    const behind = directionBehindOffset(direction)
    const jitterX = (this.rng() - 0.5) * 10
    const jitterY = (this.rng() - 0.5) * 6
    const x = (tileX + 0.5 + behind.dx) * TILE_SIZE + jitterX
    const y = (tileY + 0.86 + behind.dy) * TILE_SIZE + jitterY

    const roll = this.rng()
    let shape: ParticleShape
    let color: string
    let secondaryColor: string | undefined
    let scale = 1
    let twinkle = false
    let vy = -3 - this.rng() * 5

    if (roll < 0.36) {
      shape = 'petal'
      color = pickRandom(this.palette.petals, this.rng)
      secondaryColor = this.palette.highlight
      scale = this.rng() < 0.7 ? 1 : 2
      vy = -2 - this.rng() * 4
    } else if (roll < 0.66) {
      shape = 'flower'
      color = this.rng() < 0.55 ? this.palette.flowerPrimary : this.palette.flowerSecondary
      secondaryColor = this.palette.flowerCenter
      scale = 1
      vy = -1.5 - this.rng() * 3
    } else if (roll < 0.9) {
      shape = this.rng() < 0.55 ? 'star' : 'sparkle'
      color = pickRandom(this.palette.stars, this.rng)
      secondaryColor = this.palette.highlight
      scale = 1
      twinkle = true
      vy = -5 - this.rng() * 6
    } else {
      shape = 'heart'
      color = pickRandom(this.palette.hearts, this.rng)
      secondaryColor = this.palette.highlight
      scale = 1
      vy = -6 - this.rng() * 5
    }

    this.particles.push({
      x,
      y,
      vx: (this.rng() - 0.5) * 7,
      vy,
      age: 0,
      maxAge: 0.85 + this.rng() * 0.55,
      shape,
      color,
      secondaryColor,
      scale,
      swayAmp: 1.5 + this.rng() * 2.5,
      swayFreq: 3.5 + this.rng() * 2.5,
      phase: this.rng() * Math.PI * 2,
      gravity: shape === 'petal' ? 2.5 : 0,
      drag: 1.4,
      twinkle,
    })
  }
}
