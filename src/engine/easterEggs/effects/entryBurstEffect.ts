import { TILE_SIZE } from '../../Constants'
import { matchesNickname, normalizeNickname } from '../matchers'
import { renderEasterEggParticles, stepEasterEggParticles } from '../pixelSprites'
import type {
  EasterEggContext,
  EasterEggEffect,
  EasterEggPalette,
  EasterEggParticle,
  EntryBurstConfig,
  ParticleShape,
} from '../types'

function pickRandom<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length]
}

export class EntryBurstEffect implements EasterEggEffect {
  public readonly id: string
  public enabled: boolean

  private readonly config: EntryBurstConfig
  private readonly palette: EasterEggPalette
  private readonly rng: () => number
  private particles: EasterEggParticle[] = []
  private lastRoomKey: string | null = null
  private seenEntries = new Map<string, number>()

  constructor(
    id: string,
    config: EntryBurstConfig,
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
    this.lastRoomKey = null
    this.seenEntries.clear()
  }

  public update(deltaTime: number, context: EasterEggContext): void {
    stepEasterEggParticles(this.particles, deltaTime)
    if (!this.enabled) return

    if (this.lastRoomKey !== null && this.lastRoomKey !== context.roomKey) {
      this.seenEntries.clear()
    }
    this.lastRoomKey = context.roomKey

    const currentKeys = new Set<string>()
    for (let i = 0; i < context.players.length; i++) {
      const player = context.players[i]
      if (!matchesNickname(player, this.config.targets)) continue

      const entryKey = `${player.id}:${normalizeNickname(player.name)}`
      currentKeys.add(entryKey)

      if (!this.seenEntries.has(entryKey)) {
        this.spawnBurst(player.x, player.y)
      }
      this.seenEntries.set(entryKey, context.now)
    }

    for (const [key, lastSeen] of this.seenEntries) {
      if (!currentKeys.has(key) && context.now - lastSeen >= this.config.reentryGraceMs) {
        this.seenEntries.delete(key)
      }
    }
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, currentTime: number): void {
    if (!this.enabled && this.particles.length === 0) return
    renderEasterEggParticles(ctx, this.particles, this.palette, currentTime)
  }

  private spawnBurst(tileX: number, tileY: number): void {
    const originX = (tileX + 0.5) * TILE_SIZE
    const originY = (tileY + 0.35) * TILE_SIZE
    const count = this.config.particleCount

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.config.maxParticles) {
        this.particles.shift()
      }

      const angle = (i / count) * Math.PI * 2 + (this.rng() - 0.5) * 0.45
      const speed = 22 + this.rng() * 34
      const vx = Math.cos(angle) * speed
      const vy = Math.sin(angle) * speed * 0.72 - (14 + this.rng() * 14)

      const roll = this.rng()
      let shape: ParticleShape
      let color: string
      let secondaryColor: string | undefined
      let twinkle = false
      let scale = 1

      if (roll < 0.32) {
        shape = 'star'
        color = pickRandom(this.palette.stars, this.rng)
        secondaryColor = this.palette.highlight
        twinkle = true
      } else if (roll < 0.58) {
        shape = 'flower'
        color = this.rng() < 0.5 ? this.palette.flowerPrimary : this.palette.flowerSecondary
        secondaryColor = this.palette.flowerCenter
      } else if (roll < 0.78) {
        shape = 'petal'
        color = pickRandom(this.palette.petals, this.rng)
        secondaryColor = this.palette.highlight
      } else if (roll < 0.92) {
        shape = 'heart'
        color = pickRandom(this.palette.hearts, this.rng)
        secondaryColor = this.palette.highlight
      } else {
        shape = 'sparkle'
        color = this.palette.highlight
        secondaryColor = this.palette.flowerSecondary
        twinkle = true
        scale = 1
      }

      this.particles.push({
        x: originX + (this.rng() - 0.5) * 8,
        y: originY + (this.rng() - 0.5) * 6,
        vx,
        vy,
        age: 0,
        maxAge: 1.25 + this.rng() * 0.85,
        shape,
        color,
        secondaryColor,
        scale,
        swayAmp: 2 + this.rng() * 3,
        swayFreq: 3 + this.rng() * 2.5,
        phase: this.rng() * Math.PI * 2,
        gravity: shape === 'petal' || shape === 'flower' ? 16 : 8,
        drag: 2.1,
        twinkle,
      })
    }
  }
}
