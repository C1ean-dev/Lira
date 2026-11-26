import type { AvatarEffectDensity } from '../../../types/game'
import { TILE_SIZE } from '../../Constants'
import { deriveEffectPalette, hexToRgba } from '../palette'
import {
  renderEffectParticles,
  resolveParticleColors,
  stepEffectParticles,
} from '../pixelSprites'
import { resolveAuraSpec } from '../presets'
import type {
  AvatarEffectContext,
  AvatarEffectModule,
  AvatarEffectParticle,
  ParticleShape,
  ResolvedEffectSpec,
} from '../types'

interface TrackedAuraOwner {
  styleKey: string
  emitCooldown: number
  lastSeenAt: number
}

interface ActiveHalo {
  x: number
  y: number
  color: string
  phase: number
  radius: number
}

function densityIntervalFactor(density: AvatarEffectDensity): number {
  switch (density) {
    case 'subtle':
      return 1.55
    case 'intense':
      return 0.58
    default:
      return 1
  }
}

export class AuraEffect implements AvatarEffectModule {
  public readonly id = 'avatar:aura'
  public enabled = true

  private readonly emitIntervalSec: number
  private readonly entryBurstCount: number
  private readonly reentryGraceMs: number
  private readonly maxParticles: number
  private readonly rng: () => number
  private particles: AvatarEffectParticle[] = []
  private owners = new Map<string, TrackedAuraOwner>()
  private halos: ActiveHalo[] = []
  private lastRoomKey: string | null = null

  constructor(options?: {
    emitIntervalSec?: number
    entryBurstCount?: number
    reentryGraceMs?: number
    maxParticles?: number
    rng?: () => number
  }) {
    this.emitIntervalSec = options?.emitIntervalSec ?? 0.26
    this.entryBurstCount = options?.entryBurstCount ?? 18
    this.reentryGraceMs = options?.reentryGraceMs ?? 1500
    this.maxParticles = options?.maxParticles ?? 220
    this.rng = options?.rng ?? Math.random
  }

  public getParticles(): readonly AvatarEffectParticle[] {
    return this.particles
  }

  public reset(): void {
    this.particles = []
    this.owners.clear()
    this.halos = []
    this.lastRoomKey = null
  }

  public update(deltaTime: number, context: AvatarEffectContext): void {
    stepEffectParticles(this.particles, deltaTime)
    this.halos = []
    if (!this.enabled) return

    const dt = Math.max(0, Math.min(deltaTime, 0.1))

    if (this.lastRoomKey !== null && this.lastRoomKey !== context.roomKey) {
      this.owners.clear()
      this.particles = []
    }
    this.lastRoomKey = context.roomKey

    const activeIds = new Set<string>()
    for (let i = 0; i < context.players.length; i++) {
      const player = context.players[i]
      const aura = player.avatar?.aura
      const spec = resolveAuraSpec(aura)
      if (!spec || !aura) {
        this.owners.delete(player.id)
        continue
      }

      activeIds.add(player.id)
      if (spec.groundCircle ?? spec.glowHalo) {
        this.halos.push({
          x: (player.x + 0.5) * TILE_SIZE,
          y: (player.y + 0.72) * TILE_SIZE,
          color: spec.color,
          phase: i * 1.3,
          radius: (spec.groundCircleSize ?? 56) * 0.5,
        })
      }

      const customSig = aura.custom
        ? `${aura.custom.id}:${aura.custom.motion}:${aura.custom.density}:${aura.custom.shapes.join(',')}:${aura.custom.pixelMatrix?.join('|') || ''}:${aura.custom.groundCircle ? 1 : 0}:${aura.custom.groundCircleSize ?? ''}`
        : ''
      const styleKey = `${aura.style}:${spec.color.toLowerCase()}:${spec.groundCircle ? 1 : 0}:${spec.groundCircleSize ?? ''}:${customSig}`
      let owner = this.owners.get(player.id)

      const interval = this.emitIntervalSec * densityIntervalFactor(spec.density)
      if (!owner || owner.styleKey !== styleKey) {
        owner = {
          styleKey,
          emitCooldown: interval,
          lastSeenAt: context.now,
        }
        this.owners.set(player.id, owner)
        this.spawnEntryBurst(player.x, player.y, spec)
        continue
      }

      owner.lastSeenAt = context.now
      owner.emitCooldown -= dt
      if (owner.emitCooldown <= 0) {
        owner.emitCooldown = interval * (0.8 + this.rng() * 0.4)
        this.spawnAmbientParticle(player.x, player.y, spec)
      }
    }

    for (const [id, owner] of this.owners) {
      if (!activeIds.has(id) && context.now - owner.lastSeenAt >= this.reentryGraceMs) {
        this.owners.delete(id)
      }
    }
  }

  public renderGround(ctx: CanvasRenderingContext2D, currentTime: number): void {
    if (!this.enabled || this.halos.length === 0) return
    if (typeof ctx.createRadialGradient !== 'function') return

    ctx.save()
    for (let i = 0; i < this.halos.length; i++) {
      const halo = this.halos[i]
      const pulse = 0.78 + 0.22 * Math.sin(currentTime / 420 + halo.phase)
      const radius = halo.radius * (0.92 + pulse * 0.08)
      const grad = ctx.createRadialGradient(halo.x, halo.y, 2, halo.x, halo.y, radius)
      grad.addColorStop(0, hexToRgba(halo.color, 0.26 * pulse))
      grad.addColorStop(0.55, hexToRgba(halo.color, 0.12 * pulse))
      grad.addColorStop(1, hexToRgba(halo.color, 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(halo.x, halo.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, currentTime: number): void {
    if (!this.enabled && this.particles.length === 0) return
    renderEffectParticles(ctx, this.particles, currentTime)
  }

  private spawnEntryBurst(tileX: number, tileY: number, spec: ResolvedEffectSpec): void {
    if (!spec.pixelMatrix && spec.shapes.length === 0) return
    const palette = deriveEffectPalette(spec.color)
    const originX = (tileX + 0.5) * TILE_SIZE
    const originY = (tileY + 0.38) * TILE_SIZE
    const count = this.entryBurstCount

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        this.particles.shift()
      }

      const angle = (i / count) * Math.PI * 2 + (this.rng() - 0.5) * 0.45
      const speed = 18 + this.rng() * 28
      const shape: ParticleShape =
        spec.shapes.length > 0
          ? spec.shapes[Math.floor(this.rng() * spec.shapes.length) % spec.shapes.length]
          : 'sparkle'
      const { color, secondaryColor, twinkle } = spec.pixelMatrix
        ? { color: palette.flowerPrimary, secondaryColor: palette.highlight, twinkle: spec.motion === 'orbit' || spec.motion === 'spark' }
        : resolveParticleColors(shape, palette, this.rng)

      this.particles.push({
        x: originX + (this.rng() - 0.5) * 8,
        y: originY + (this.rng() - 0.5) * 6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.72 - (10 + this.rng() * 12),
        age: 0,
        maxAge: 1.05 + this.rng() * 0.7,
        shape,
        customMatrix: spec.pixelMatrix,
        color,
        secondaryColor,
        outlineColor: palette.outline,
        scale: 1,
        swayAmp: 2 + this.rng() * 2.5,
        swayFreq: 3 + this.rng() * 2.5,
        phase: this.rng() * Math.PI * 2,
        gravity: spec.motion === 'rise' ? -8 : spec.motion === 'fall' ? 16 : 8,
        drag: 2.1,
        twinkle,
      })
    }
  }

  private spawnAmbientParticle(tileX: number, tileY: number, spec: ResolvedEffectSpec): void {
    if (!spec.pixelMatrix && spec.shapes.length === 0) return
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift()
    }

    const palette = deriveEffectPalette(spec.color)
    const shape: ParticleShape =
      spec.shapes.length > 0
        ? spec.shapes[Math.floor(this.rng() * spec.shapes.length) % spec.shapes.length]
        : 'sparkle'
    const { color, secondaryColor, twinkle } = spec.pixelMatrix
      ? { color: palette.flowerPrimary, secondaryColor: palette.highlight, twinkle: spec.motion === 'orbit' || spec.motion === 'spark' }
      : resolveParticleColors(shape, palette, this.rng)

    const angle = this.rng() * Math.PI * 2
    let x = (tileX + 0.5) * TILE_SIZE + Math.cos(angle) * (11 + this.rng() * 7)
    let y = (tileY + 0.44) * TILE_SIZE + Math.sin(angle) * (10 + this.rng() * 7)
    let vx = Math.cos(angle) * (2 + this.rng() * 3)
    let vy = -(9 + this.rng() * 6)
    let gravity = 0
    let maxAge = 1.05 + this.rng() * 0.55
    let swayAmp = 2 + this.rng() * 2.2
    let drag = 0.5

    switch (spec.motion) {
      case 'rise':
        x = (tileX + 0.5) * TILE_SIZE + (this.rng() - 0.5) * 22
        y = (tileY + 0.82) * TILE_SIZE + (this.rng() - 0.5) * 6
        vx = (this.rng() - 0.5) * 6
        vy = -(16 + this.rng() * 14)
        gravity = -4
        maxAge = 0.72 + this.rng() * 0.45
        swayAmp = 2.2
        break
      case 'fall':
        x = (tileX + 0.5) * TILE_SIZE + (this.rng() - 0.5) * 28
        y = (tileY - 0.15) * TILE_SIZE + (this.rng() - 0.5) * 8
        vx = (this.rng() - 0.5) * 5
        vy = 8 + this.rng() * 7
        gravity = 4
        maxAge = 1.2 + this.rng() * 0.55
        swayAmp = 3.2
        break
      case 'orbit':
        x = (tileX + 0.5) * TILE_SIZE + Math.cos(angle) * (14 + this.rng() * 6)
        y = (tileY + 0.42) * TILE_SIZE + Math.sin(angle) * (12 + this.rng() * 5)
        vx = Math.cos(angle) * 6
        vy = Math.sin(angle) * 4 - 3
        drag = 1.2
        maxAge = 0.95 + this.rng() * 0.5
        swayAmp = 1.4
        break
      case 'spark':
        x = (tileX + 0.5) * TILE_SIZE + Math.cos(angle) * (10 + this.rng() * 8)
        y = (tileY + 0.46) * TILE_SIZE + Math.sin(angle) * (10 + this.rng() * 8)
        vx = Math.cos(angle) * (12 + this.rng() * 16)
        vy = Math.sin(angle) * (12 + this.rng() * 16)
        drag = 2.6
        maxAge = 0.4 + this.rng() * 0.32
        swayAmp = 0.4
        break
      default:
        break
    }

    this.particles.push({
      x,
      y,
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
      swayFreq: 2.8 + this.rng() * 1.6,
      phase: this.rng() * Math.PI * 2,
      gravity,
      drag,
      twinkle,
    })
  }
}
