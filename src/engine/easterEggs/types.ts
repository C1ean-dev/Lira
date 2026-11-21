import type { Player } from '../../types/game'
import type { MapData } from '../../types/map'
import type { CustomAsset } from '../../types/customAsset'
import type { BedSession } from '../../store/useBedStore'

export type ParticleShape = 'flower' | 'petal' | 'star' | 'sparkle' | 'heart'

export interface EasterEggPalette {
  /** Primary purple flower petals. */
  flowerPrimary: string
  /** Secondary softer lilac flower petals. */
  flowerSecondary: string
  /** Warm/bright flower center pixel. */
  flowerCenter: string
  /** Falling petal shades. */
  petals: readonly string[]
  /** Twinkling star & sparkle shades. */
  stars: readonly string[]
  /** Proximity / burst heart shades. */
  hearts: readonly string[]
  /** 1px specular highlight on hearts/stars. */
  highlight: string
  /** Deep violet outline so pixel sprites pop on both light and dark floors. */
  outline: string
}

export interface EasterEggParticle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  maxAge: number
  shape: ParticleShape
  color: string
  secondaryColor?: string
  scale: number
  swayAmp: number
  swayFreq: number
  phase: number
  gravity: number
  drag: number
  twinkle: boolean
}

export interface EasterEggContext {
  localPlayer: Player
  players: readonly Player[]
  map: MapData
  roomKey: string
  bedSessions: Readonly<Record<string, BedSession>>
  getAssetById: (id: string) => CustomAsset | undefined
  now: number
}

export interface EasterEggEffect {
  readonly id: string
  enabled: boolean
  update(deltaTime: number, context: EasterEggContext): void
  renderGround?(ctx: CanvasRenderingContext2D, currentTime: number): void
  renderOverlay?(ctx: CanvasRenderingContext2D, currentTime: number): void
  renderScreenOverlay?(ctx: CanvasRenderingContext2D, width: number, height: number, currentTime: number): void
  reset?(): void
}

export type ProximityReason = 'bed' | 'seat' | 'table' | 'proximity'

export interface ProximityMatch {
  reason: ProximityReason
  /** World-space pixel center between the two avatars. */
  anchorX: number
  anchorY: number
  playerA: Player
  playerB: Player
}

export interface WalkingTrailConfig {
  enabled: boolean
  targets: readonly string[]
  /** Tiles traveled before spawning the next trail particle. */
  stepDistanceTiles: number
  /** Ignore single-frame jumps larger than this (teleports/spawns). */
  teleportThresholdTiles: number
  maxParticles: number
}

export interface EntryBurstConfig {
  enabled: boolean
  targets: readonly string[]
  /** Grace period (ms) a player must be absent before re-triggering on re-entry. */
  reentryGraceMs: number
  particleCount: number
  maxParticles: number
}

export interface ProximityEffectConfig {
  enabled: boolean
  pairs: readonly (readonly [string, string])[]
  /** Euclidean distance in tiles that triggers proximity hearts. */
  maxDistanceTiles: number
  /** Extra padding (in tiles) around a shared table bounding box. */
  tableProximityPaddingTiles: number
  /** Seconds between ambient proximity particle spawns while close. */
  emitIntervalSec: number
  maxParticles: number
}

export interface ScreenHeartsBorderConfig {
  enabled: boolean
  /** Only local players matching these nicknames see the screen border animation. */
  targets: readonly string[]
  heartCount: number
  accentSparkleCount: number
  marginPx: number
}

export interface CoupleEasterEggConfig {
  id: string
  palette: EasterEggPalette
  walkingTrail: WalkingTrailConfig
  entryBurst: EntryBurstConfig
  proximity: ProximityEffectConfig
  screenHeartsBorder: ScreenHeartsBorderConfig
}
