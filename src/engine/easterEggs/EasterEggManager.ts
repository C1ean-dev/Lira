import { ARAVON_CLEAN_EASTER_EGG_CONFIG } from './config'
import { EntryBurstEffect } from './effects/entryBurstEffect'
import { ProximityEffect } from './effects/proximityEffect'
import { ScreenHeartsBorderEffect } from './effects/screenHeartsBorderEffect'
import { WalkingTrailEffect } from './effects/walkingTrailEffect'
import type { CoupleEasterEggConfig, EasterEggContext, EasterEggEffect } from './types'

export function createCoupleEasterEggEffects(
  config: CoupleEasterEggConfig = ARAVON_CLEAN_EASTER_EGG_CONFIG,
  rng: () => number = Math.random
): EasterEggEffect[] {
  return [
    new WalkingTrailEffect(`${config.id}:walking-trail`, config.walkingTrail, config.palette, rng),
    new EntryBurstEffect(`${config.id}:entry-burst`, config.entryBurst, config.palette, rng),
    new ProximityEffect(`${config.id}:proximity`, config.proximity, config.palette, rng),
    new ScreenHeartsBorderEffect(`${config.id}:screen-hearts-border`, config.screenHeartsBorder, config.palette, rng),
  ]
}

export class EasterEggManager {
  private static instance: EasterEggManager | null = null

  private enabled = true
  private effects = new Map<string, EasterEggEffect>()

  constructor(initialEffects?: readonly EasterEggEffect[]) {
    const list = initialEffects ?? createCoupleEasterEggEffects()
    for (let i = 0; i < list.length; i++) {
      this.registerEffect(list[i])
    }
  }

  public static getInstance(): EasterEggManager {
    if (!EasterEggManager.instance) {
      EasterEggManager.instance = new EasterEggManager()
    }
    return EasterEggManager.instance
  }

  public registerEffect(effect: EasterEggEffect): void {
    this.effects.set(effect.id, effect)
  }

  public unregisterEffect(id: string): boolean {
    return this.effects.delete(id)
  }

  public getEffect(id: string): EasterEggEffect | undefined {
    return this.effects.get(id)
  }

  public listEffects(): EasterEggEffect[] {
    return Array.from(this.effects.values())
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.reset()
  }

  public isEnabled(): boolean {
    return this.enabled
  }

  public setEffectEnabled(id: string, enabled: boolean): boolean {
    const effect = this.effects.get(id)
    if (!effect) return false
    effect.enabled = enabled
    if (!enabled) effect.reset?.()
    return true
  }

  public update(deltaTime: number, context: EasterEggContext): void {
    if (!this.enabled) return
    for (const effect of this.effects.values()) {
      effect.update(deltaTime, context)
    }
  }

  public renderGround(ctx: CanvasRenderingContext2D, currentTime: number): void {
    if (!this.enabled) return
    for (const effect of this.effects.values()) {
      effect.renderGround?.(ctx, currentTime)
    }
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, currentTime: number): void {
    if (!this.enabled) return
    for (const effect of this.effects.values()) {
      effect.renderOverlay?.(ctx, currentTime)
    }
  }

  public renderScreenOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    currentTime: number
  ): void {
    if (!this.enabled) return
    for (const effect of this.effects.values()) {
      effect.renderScreenOverlay?.(ctx, width, height, currentTime)
    }
  }

  public reset(): void {
    for (const effect of this.effects.values()) {
      effect.reset?.()
    }
  }
}
