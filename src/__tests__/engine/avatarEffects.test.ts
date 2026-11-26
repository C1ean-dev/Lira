import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AVATAR } from '../../engine/Constants'
import {
  AURA_OPTIONS,
  AvatarEffectsManager,
  AuraEffect,
  DEFAULT_AVATAR_EFFECT_COLOR,
  STEPS_OPTIONS,
  StepsTrailEffect,
  createDefaultAvatarEffects,
  deriveEffectPalette,
  drawAvatarAuraPreview,
  drawAvatarStepsPreview,
  drawEffectPresetIcon,
  resolveAuraSpec,
  resolveStepsSpec,
} from '../../engine/avatarEffects'
import type { AvatarEffectContext, AvatarEffectModule } from '../../engine/avatarEffects'
import type { CustomAvatarEffectSpec, Player } from '../../types/game'
import { playerSchema } from '../../validation/schemas'

function makePlayer(overrides: Partial<Player> & { id: string; name: string }): Player {
  return {
    x: 10,
    y: 10,
    direction: 'down',
    isMoving: false,
    avatar: { ...DEFAULT_AVATAR },
    status: 'available',
    currentZoneId: null,
    lastUpdated: 0,
    ...overrides,
  }
}

function makeContext(overrides: Partial<AvatarEffectContext> = {}): AvatarEffectContext {
  return {
    players: [],
    roomKey: 'room-1',
    now: 1000,
    ...overrides,
  }
}

function makeMockCanvasCtx() {
  const fillRect = vi.fn()
  const clearRect = vi.fn()
  const save = vi.fn()
  const restore = vi.fn()
  return {
    fillRect,
    clearRect,
    save,
    restore,
    fillStyle: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D & {
    fillRect: ReturnType<typeof vi.fn>
    clearRect: ReturnType<typeof vi.fn>
  }
}

describe('Avatar Aura & Steps modular effects', () => {
  it('derives harmonious hex palettes for custom colors and invalid fallbacks', () => {
    const purple = deriveEffectPalette('#a855f7')
    const blue = deriveEffectPalette('#3b82f6')
    const fallback = deriveEffectPalette('not-a-color')

    expect(purple.flowerPrimary).toBe('#a855f7')
    expect(blue.flowerPrimary).toBe('#3b82f6')
    expect(fallback.flowerPrimary).toBe(DEFAULT_AVATAR_EFFECT_COLOR)
    expect(purple.outline).toMatch(/^#[0-9a-f]{6}$/)
    expect(purple.highlight).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('spawns walking step particles for any player with steps enabled, ignoring teleports and disabled players', () => {
    const stepsEffect = new StepsTrailEffect({ rng: () => 0.45 })
    const walker = makePlayer({
      id: 'p1',
      name: 'QualquerUsuario',
      x: 4,
      y: 6,
      direction: 'right',
      isMoving: true,
      avatar: { ...DEFAULT_AVATAR, steps: { style: 'floral_stars', color: '#a855f7' } },
    })
    const plain = makePlayer({
      id: 'p2',
      name: 'SemPassos',
      x: 12,
      y: 6,
      direction: 'right',
      isMoving: true,
      avatar: { ...DEFAULT_AVATAR, steps: { style: 'none' } },
    })

    stepsEffect.update(0.05, makeContext({ players: [walker, plain], now: 1000 }))
    expect(stepsEffect.getParticles()).toHaveLength(0)

    plain.x = 14
    stepsEffect.update(0.05, makeContext({ players: [walker, plain], now: 1050 }))
    expect(stepsEffect.getParticles()).toHaveLength(0)

    walker.x = 4.5
    stepsEffect.update(0.05, makeContext({ players: [walker, plain], now: 1100 }))
    walker.x = 5.0
    stepsEffect.update(0.05, makeContext({ players: [walker, plain], now: 1150 }))
    expect(stepsEffect.getParticles().length).toBeGreaterThanOrEqual(2)

    // Teleport jump does not create a streak
    const beforeTeleport = stepsEffect.getParticles().length
    walker.x = 22
    stepsEffect.update(0.01, makeContext({ players: [walker, plain], now: 1160 }))
    expect(stepsEffect.getParticles().length).toBe(beforeTeleport)

    const ctx = makeMockCanvasCtx()
    stepsEffect.renderGround(ctx, 1200)
    expect(ctx.fillRect).toHaveBeenCalled()

    for (let i = 0; i < 30; i++) {
      stepsEffect.update(0.1, makeContext({ players: [walker, plain], now: 1200 + i * 100 }))
    }
    expect(stepsEffect.getParticles()).toHaveLength(0)
  })

  it('emits entry bloom and ambient floating aura particles for players with aura enabled', () => {
    const auraEffect = new AuraEffect({ entryBurstCount: 14, emitIntervalSec: 0.3, rng: () => 0.3 })
    const user = makePlayer({
      id: 'u1',
      name: 'Visitante',
      x: 8,
      y: 9,
      avatar: { ...DEFAULT_AVATAR, aura: { style: 'floral_stars', color: '#ec4899' } },
    })
    const noAura = makePlayer({
      id: 'u2',
      name: 'SemAura',
      x: 15,
      y: 9,
      avatar: { ...DEFAULT_AVATAR, aura: { style: 'none' } },
    })

    // Player without aura produces nothing
    auraEffect.update(0.05, makeContext({ players: [noAura], roomKey: 'room-A', now: 1000 }))
    expect(auraEffect.getParticles()).toHaveLength(0)

    // Player with aura triggers initial entry burst
    auraEffect.update(0.05, makeContext({ players: [noAura, user], roomKey: 'room-A', now: 1100 }))
    expect(auraEffect.getParticles()).toHaveLength(14)

    // Let entry burst finish while ambient particles keep spawning
    for (let i = 0; i < 25; i++) {
      auraEffect.update(0.1, makeContext({ players: [noAura, user], roomKey: 'room-A', now: 1200 + i * 100 }))
    }
    expect(auraEffect.getParticles().length).toBeGreaterThan(0)

    // Switching aura style triggers a fresh bloom
    const countBeforeSwitch = auraEffect.getParticles().length
    user.avatar = { ...user.avatar, aura: { style: 'hearts', color: '#a855f7' } }
    auraEffect.update(0.05, makeContext({ players: [noAura, user], roomKey: 'room-A', now: 4000 }))
    expect(auraEffect.getParticles().length).toBeGreaterThanOrEqual(countBeforeSwitch + 14)

    const ctx = makeMockCanvasCtx()
    auraEffect.renderOverlay(ctx, 4050)
    expect(ctx.fillRect).toHaveBeenCalled()
  })

  it('supports modular registration, toggling, and exposes UI preset metadata', () => {
    expect(AURA_OPTIONS.some((o) => o.id === 'floral_stars')).toBe(true)
    expect(STEPS_OPTIONS.some((o) => o.id === 'floral_stars')).toBe(true)

    const manager = new AvatarEffectsManager(createDefaultAvatarEffects(() => 0.4))
    expect(manager.listEffects().map((e) => e.id)).toEqual(['avatar:steps', 'avatar:aura'])

    const customSpy = vi.fn()
    const custom: AvatarEffectModule = {
      id: 'custom:effect',
      enabled: true,
      update: customSpy,
    }
    manager.registerEffect(custom)
    manager.update(0.05, makeContext({ now: 1000 }))
    expect(customSpy).toHaveBeenCalledTimes(1)

    expect(manager.setEffectEnabled('avatar:aura', false)).toBe(true)
    expect(manager.getEffect('avatar:aura')?.enabled).toBe(false)

    manager.setEnabled(false)
    manager.update(0.05, makeContext({ now: 1100 }))
    expect(customSpy).toHaveBeenCalledTimes(1)

    expect(manager.unregisterEffect('custom:effect')).toBe(true)
  })

  it('draws live preview overlays and preset icons when enabled and stays clean when none', () => {
    const emptyCtx = makeMockCanvasCtx()
    drawAvatarAuraPreview(emptyCtx, { ...DEFAULT_AVATAR, aura: { style: 'none' } }, 500)
    drawAvatarStepsPreview(emptyCtx, { ...DEFAULT_AVATAR, steps: { style: 'none' } }, 500)
    expect(emptyCtx.fillRect).not.toHaveBeenCalled()

    const activeCtx = makeMockCanvasCtx()
    drawAvatarAuraPreview(activeCtx, { ...DEFAULT_AVATAR, aura: { style: 'floral_stars', color: '#a855f7' } }, 500)
    drawAvatarStepsPreview(activeCtx, { ...DEFAULT_AVATAR, steps: { style: 'hearts', color: '#ec4899' } }, 500)
    expect(activeCtx.fillRect).toHaveBeenCalled()

    const iconCtx = makeMockCanvasCtx()
    drawEffectPresetIcon(iconCtx, ['flower', 'star', 'petal'], '#a855f7', 48, 48)
    expect(iconCtx.clearRect).toHaveBeenCalled()
    expect(iconCtx.fillRect).toHaveBeenCalled()
  })

  it('validates and preserves avatar aura and steps (including custom pixel art specs) through playerSchema', () => {
    const customAura: CustomAvatarEffectSpec = {
      id: 'custom_aura_1',
      name: 'Chama Solar',
      kind: 'aura',
      shapes: ['flame', 'sunray'],
      pixelMatrix: ['000100000', '001210000', '000100000'],
      color: '#f97316',
      motion: 'rise',
      density: 'intense',
    }
    const parsed = playerSchema.parse({
      id: 'user-1',
      name: 'Teste',
      avatar: {
        ...DEFAULT_AVATAR,
        aura: { style: 'custom', color: '#f97316', custom: customAura },
        steps: { style: 'fire', color: '#f97316' },
      },
    })

    expect(parsed.avatar?.aura).toEqual({ style: 'custom', color: '#f97316', custom: customAura })
    expect(parsed.avatar?.steps).toEqual({ style: 'fire', color: '#f97316' })
  })

  it('includes fire, sunlight, lightning, frost, nature, bubbles and music presets and supports custom specs in effects', () => {
    const auraIds = AURA_OPTIONS.map((o) => o.id)
    const stepsIds = STEPS_OPTIONS.map((o) => o.id)
    for (const id of ['fire', 'sunlight', 'lightning', 'frost', 'nature', 'bubbles', 'music'] as const) {
      expect(auraIds).toContain(id)
      expect(stepsIds).toContain(id)
    }

    const fireSpec = resolveAuraSpec({ style: 'fire' })
    const sunSpec = resolveAuraSpec({ style: 'sunlight' })
    expect(fireSpec?.glowHalo).toBe(true)
    expect(fireSpec?.motion).toBe('rise')
    expect(sunSpec?.glowHalo).toBe(true)
    expect(sunSpec?.motion).toBe('orbit')

    const customSpec: CustomAvatarEffectSpec = {
      id: 'custom_steps_9x9',
      name: 'Runa Custom',
      kind: 'steps',
      shapes: ['sparkle'],
      pixelMatrix: ['010', '121', '010'],
      color: '#facc15',
      motion: 'spark',
      density: 'intense',
    }
    const resolvedSteps = resolveStepsSpec({ style: 'custom', color: '#facc15', custom: customSpec })
    expect(resolvedSteps?.pixelMatrix).toEqual(['010', '121', '010'])
    expect(resolvedSteps?.motion).toBe('spark')

    const stepsEffect = new StepsTrailEffect({ rng: () => 0.5 })
    const walker = makePlayer({
      id: 'c1',
      name: 'Criador',
      x: 5,
      y: 5,
      avatar: { ...DEFAULT_AVATAR, steps: { style: 'custom', color: '#facc15', custom: customSpec } },
    })
    stepsEffect.update(0.05, makeContext({ players: [walker], now: 1000 }))
    walker.x = 5.6
    stepsEffect.update(0.05, makeContext({ players: [walker], now: 1050 }))
    expect(stepsEffect.getParticles().some((p) => p.customMatrix?.length === 3)).toBe(true)

    const ctx = makeMockCanvasCtx()
    drawEffectPresetIcon(ctx, ['sparkle'], '#facc15', 44, 44, ['010', '121', '010'])
    expect(ctx.fillRect).toHaveBeenCalled()
  })

  it('supports optional groundCircle, size clamping, and objectless circle-only custom auras', () => {
    const circleOnlySpec: CustomAvatarEffectSpec = {
      id: 'custom_circle_only',
      name: 'Circulo Arcano',
      kind: 'aura',
      shapes: [],
      color: '#38bdf8',
      motion: 'orbit',
      density: 'normal',
      groundCircle: true,
      groundCircleSize: 200,
    }

    const resolvedCircleOnly = resolveAuraSpec({
      style: 'custom',
      color: '#38bdf8',
      custom: circleOnlySpec,
    })
    expect(resolvedCircleOnly).not.toBeNull()
    expect(resolvedCircleOnly?.shapes).toEqual([])
    expect(resolvedCircleOnly?.groundCircle).toBe(true)
    expect(resolvedCircleOnly?.groundCircleSize).toBe(128)

    const resolvedSmall = resolveAuraSpec({
      style: 'custom',
      custom: { ...circleOnlySpec, groundCircleSize: 8 },
    })
    expect(resolvedSmall?.groundCircleSize).toBe(24)

    const explicitNoCircle = resolveAuraSpec({
      style: 'fire',
      groundCircle: false,
      groundCircleSize: 96,
    })
    expect(explicitNoCircle?.groundCircle).toBe(false)
    expect(explicitNoCircle?.groundCircleSize).toBe(96)

    const auraEffect = new AuraEffect({ entryBurstCount: 10, emitIntervalSec: 0.25, rng: () => 0.2 })
    const circlePlayer = makePlayer({
      id: 'c-circle',
      name: 'Arcano',
      x: 6,
      y: 6,
      avatar: {
        ...DEFAULT_AVATAR,
        aura: { style: 'custom', color: '#38bdf8', custom: circleOnlySpec, groundCircle: true, groundCircleSize: 96 },
      },
    })
    auraEffect.update(0.05, makeContext({ players: [circlePlayer], roomKey: 'r1', now: 1000 }))
    auraEffect.update(0.3, makeContext({ players: [circlePlayer], roomKey: 'r1', now: 1300 }))
    expect(auraEffect.getParticles()).toHaveLength(0)

    const objectPlayer = makePlayer({
      id: 'c-objs',
      name: 'Coracoes',
      x: 9,
      y: 9,
      avatar: {
        ...DEFAULT_AVATAR,
        aura: {
          style: 'custom',
          color: '#ec4899',
          custom: {
            id: 'custom_hearts',
            name: 'So Coracao',
            kind: 'aura',
            shapes: ['heart', 'flame'],
            color: '#ec4899',
            motion: 'rise',
            density: 'normal',
            groundCircle: false,
            groundCircleSize: 56,
          },
          groundCircle: false,
        },
      },
    })
    auraEffect.update(0.05, makeContext({ players: [circlePlayer, objectPlayer], roomKey: 'r1', now: 1400 }))
    const spawned = auraEffect.getParticles()
    expect(spawned.length).toBeGreaterThan(0)
    expect(spawned.every((p) => p.shape === 'heart' || p.shape === 'flame')).toBe(true)

    const parsed = playerSchema.parse({
      id: 'u-circle',
      name: 'Circulo',
      avatar: {
        ...DEFAULT_AVATAR,
        aura: {
          style: 'custom',
          color: '#38bdf8',
          groundCircle: true,
          groundCircleSize: 84,
          custom: { ...circleOnlySpec, groundCircleSize: 84 },
        },
      },
    })
    expect(parsed.avatar?.aura?.groundCircle).toBe(true)
    expect(parsed.avatar?.aura?.groundCircleSize).toBe(84)
    expect(parsed.avatar?.aura?.custom?.groundCircle).toBe(true)
    expect(parsed.avatar?.aura?.custom?.groundCircleSize).toBe(84)
  })
})
