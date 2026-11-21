import { detectPairProximity, findPlayerPair, normalizeNickname } from '../matchers'
import { renderEasterEggParticles, stepEasterEggParticles } from '../pixelSprites'
import type {
  EasterEggContext,
  EasterEggEffect,
  EasterEggPalette,
  EasterEggParticle,
  ParticleShape,
  ProximityEffectConfig,
  ProximityMatch,
} from '../types'

interface PairRuntimeState {
  wasActive: boolean
  emitCooldown: number
}

function pickRandom<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length) % items.length]
}

export class ProximityEffect implements EasterEggEffect {
  public readonly id: string
  public enabled: boolean

  private readonly config: ProximityEffectConfig
  private readonly palette: EasterEggPalette
  private readonly rng: () => number
  private particles: EasterEggParticle[] = []
  private pairStates = new Map<string, PairRuntimeState>()

  constructor(
    id: string,
    config: ProximityEffectConfig,
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
    this.pairStates.clear()
  }

  public update(deltaTime: number, context: EasterEggContext): void {
    stepEasterEggParticles(this.particles, deltaTime)
    if (!this.enabled) return

    const dt = Math.max(0, Math.min(deltaTime, 0.1))

    for (let i = 0; i < this.config.pairs.length; i++) {
      const [nickA, nickB] = this.config.pairs[i]
      const pairKey = `${normalizeNickname(nickA)}:${normalizeNickname(nickB)}`
      let state = this.pairStates.get(pairKey)
      if (!state) {
        state = { wasActive: false, emitCooldown: 0 }
        this.pairStates.set(pairKey, state)
      }

      const pair = findPlayerPair(context.players, nickA, nickB)
      if (!pair) {
        state.wasActive = false
        state.emitCooldown = 0
        continue
      }

      const match = detectPairProximity(
        pair[0],
        pair[1],
        context.map,
        context.bedSessions,
        context.getAssetById,
        this.config.maxDistanceTiles,
        this.config.tableProximityPaddingTiles
      )

      if (!match) {
        state.wasActive = false
        state.emitCooldown = 0
        continue
      }

      if (!state.wasActive) {
        state.wasActive = true
        state.emitCooldown = this.config.emitIntervalSec
        this.spawnProximityParticle(match, 'heart')
        this.spawnProximityParticle(match, 'star')
        continue
      }

      state.emitCooldown -= dt
      if (state.emitCooldown <= 0) {
        state.emitCooldown = this.config.emitIntervalSec * (0.85 + this.rng() * 0.35)
        this.spawnProximityParticle(match)
      }
    }
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, currentTime: number): void {
    if (!this.enabled && this.particles.length === 0) return
    renderEasterEggParticles(ctx, this.particles, this.palette, currentTime)
  }

  private spawnProximityParticle(match: ProximityMatch, forcedShape?: ParticleShape): void {
    if (this.particles.length >= this.config.maxParticles) {
      this.particles.shift()
    }

    const spreadX = match.reason === 'bed' ? 24 : 16
    const x = match.anchorX + (this.rng() - 0.5) * spreadX
    const y = match.anchorY + (this.rng() - 0.5) * 6

    let shape: ParticleShape
    if (forcedShape) {
      shape = forcedShape
    } else {
      const roll = this.rng()
      if (roll < 0.64) shape = 'heart'
      else if (roll < 0.84) shape = this.rng() < 0.65 ? 'star' : 'sparkle'
      else shape = this.rng() < 0.55 ? 'flower' : 'petal'
    }

    let color: string
    let secondaryColor: string | undefined
    let twinkle = false

    switch (shape) {
      case 'heart':
        color = pickRandom(this.palette.hearts, this.rng)
        secondaryColor = this.palette.highlight
        break
      case 'flower':
        color = this.rng() < 0.5 ? this.palette.flowerPrimary : this.palette.flowerSecondary
        secondaryColor = this.palette.flowerCenter
        break
      case 'petal':
        color = pickRandom(this.palette.petals, this.rng)
        secondaryColor = this.palette.highlight
        break
      case 'star':
      case 'sparkle':
        color = pickRandom(this.palette.stars, this.rng)
        secondaryColor = this.palette.highlight
        twinkle = true
        break
    }

    this.particles.push({
      x,
      y,
      vx: (this.rng() - 0.5) * 5,
      vy: -(11 + this.rng() * 7),
      age: 0,
      maxAge: 1.35 + this.rng() * 0.55,
      shape,
      color,
      secondaryColor,
      scale: 1,
      swayAmp: 2.2 + this.rng() * 2.5,
      swayFreq: 2.8 + this.rng() * 1.8,
      phase: this.rng() * Math.PI * 2,
      gravity: 0,
      drag: 0.4,
      twinkle,
    })
  }
}
