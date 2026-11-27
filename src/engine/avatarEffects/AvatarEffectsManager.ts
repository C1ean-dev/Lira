import { AuraEffect } from './effects/auraEffect'
import { StepsTrailEffect } from './effects/stepsTrailEffect'
import type { AvatarEffectContext, AvatarEffectModule } from './types'

export function createDefaultAvatarEffects(rng: () => number = Math.random): AvatarEffectModule[] {
  return [
    new StepsTrailEffect({ rng }),
    new AuraEffect({ rng }),
  ]
}

export class AvatarEffectsManager {
  private static instance: AvatarEffectsManager | null = null

  private enabled = true
  private effects = new Map<string, AvatarEffectModule>()

  constructor(initialEffects?: readonly AvatarEffectModule[]) {
    const list = initialEffects ?? createDefaultAvatarEffects()
    for (let i = 0; i < list.length; i++) {
      this.registerEffect(list[i])
    }
  }

  public static getInstance(): AvatarEffectsManager {
    if (!AvatarEffectsManager.instance) {
      AvatarEffectsManager.instance = new AvatarEffectsManager()
    }
    return AvatarEffectsManager.instance
  }

  public registerEffect(effect: AvatarEffectModule): void {
    this.effects.set(effect.id, effect)
  }

  public unregisterEffect(id: string): boolean {
    return this.effects.delete(id)
  }

  public getEffect(id: string): AvatarEffectModule | undefined {
    return this.effects.get(id)
  }

  public listEffects(): AvatarEffectModule[] {
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

  public update(deltaTime: number, context: AvatarEffectContext): void {
    if (!this.enabled) return
    for (const effect of this.effects.values()) {
      effect.update(deltaTime, context)
    }
  }

  public renderGround(ctx: CanvasRenderingContext2D, currentTime: number, excludeEffectId?: string): void {
    if (!this.enabled) return
    for (const effect of this.effects.values()) {
      if (excludeEffectId && effect.id === excludeEffectId) continue
      effect.renderGround?.(ctx, currentTime)
    }
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, currentTime: number, excludeEffectId?: string): void {
    if (!this.enabled) return
    for (const effect of this.effects.values()) {
      if (excludeEffectId && effect.id === excludeEffectId) continue
      effect.renderOverlay?.(ctx, currentTime)
    }
  }

  public reset(): void {
    for (const effect of this.effects.values()) {
      effect.reset?.()
    }
  }
}
