import type {
  AvatarAuraStyle,
  AvatarEffectDensity,
  AvatarEffectMotion,
  AvatarEffectShape,
  AvatarStepsStyle,
  Player,
} from '../../types/game'

export type ParticleShape = AvatarEffectShape

export interface AvatarEffectPalette {
  flowerPrimary: string
  flowerSecondary: string
  flowerCenter: string
  petals: readonly string[]
  stars: readonly string[]
  hearts: readonly string[]
  flames: readonly string[]
  highlight: string
  outline: string
}

export interface AvatarEffectParticle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  maxAge: number
  shape: ParticleShape
  customMatrix?: readonly string[]
  color: string
  secondaryColor: string
  outlineColor: string
  scale: number
  swayAmp: number
  swayFreq: number
  phase: number
  gravity: number
  drag: number
  twinkle: boolean
}

export interface AvatarEffectContext {
  players: readonly Player[]
  roomKey: string
  now: number
}

export interface AvatarEffectModule {
  readonly id: string
  enabled: boolean
  update(deltaTime: number, context: AvatarEffectContext): void
  renderGround?(ctx: CanvasRenderingContext2D, currentTime: number): void
  renderOverlay?(ctx: CanvasRenderingContext2D, currentTime: number): void
  reset?(): void
}

export interface ResolvedEffectSpec {
  shapes: readonly ParticleShape[]
  pixelMatrix?: readonly string[]
  color: string
  motion: AvatarEffectMotion
  density: AvatarEffectDensity
  glowHalo?: boolean
  groundCircle?: boolean
  groundCircleSize?: number
}

export interface AuraOptionMeta {
  id: Exclude<AvatarAuraStyle, 'custom'>
  label: string
  description: string
  defaultColor: string
  motion: AvatarEffectMotion
  density: AvatarEffectDensity
  glowHalo?: boolean
  groundCircle?: boolean
  groundCircleSize?: number
  previewShapes: readonly ParticleShape[]
}

export interface StepsOptionMeta {
  id: Exclude<AvatarStepsStyle, 'custom'>
  label: string
  description: string
  defaultColor: string
  motion: AvatarEffectMotion
  density: AvatarEffectDensity
  previewShapes: readonly ParticleShape[]
}

export interface ShapeOptionMeta {
  id: ParticleShape
  label: string
}

export interface EffectColorPreset {
  label: string
  hex: string
}
