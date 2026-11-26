import { Container, Filter, GlProgram, Graphics, Sprite, Texture, UniformGroup } from 'pixi.js'
import type { AvatarAuraConfig, AvatarAuraStyle } from '../../types/game'
import { AvatarEffectsManager } from '../avatarEffects/AvatarEffectsManager'
import { AuraEffect } from '../avatarEffects/effects/auraEffect'
import { SHAPE_MATRICES } from '../avatarEffects/pixelSprites'
import { clampAuraGroundCircleSize, resolveAuraSpec } from '../avatarEffects/presets'
import type { ParticleShape } from '../avatarEffects/types'
import type { LightDescriptor } from './PixiLightingSystem'
import { parseHexColor } from './PixiTextureCache'

export interface AuraShaderPreset {
  key: string
  colorA: [number, number, number]
  colorB: [number, number, number]
  lightColor: string
  particleTint: number
  speed: number
  rings: number
  densityScale: number
  groundCircle: boolean
  groundCircleSize: number
  shapes: readonly ParticleShape[]
  hasCustomMatrix: boolean
}

const FILTER_VERT = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vLocalUv;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vLocalUv = aPosition;
}
`

const AURA_FRAG = `
in vec2 vTextureCoord;
in vec2 vLocalUv;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uSpeed;
uniform float uRings;
uniform vec3 uColorA;
uniform vec3 uColorB;

void main() {
    vec4 base = texture(uTexture, vTextureCoord);
    vec2 uv = vLocalUv * 2.0 - 1.0;
    float dist = length(uv);
    if (dist > 1.0) {
        finalColor = vec4(0.0);
        return;
    }

    float angle = atan(uv.y, uv.x);
    float swirl = sin(angle * 4.0 - uTime * uSpeed + dist * 6.0) * 0.5 + 0.5;
    float wave = sin(dist * 10.0 * uRings - uTime * uSpeed * 1.4) * 0.5 + 0.5;

    float rimBand = exp(-pow((dist - 0.82) / 0.075, 2.0)) * (0.72 + 0.28 * swirl);
    float innerBand = exp(-pow((dist - 0.54) / 0.06, 2.0)) * (0.28 + 0.24 * wave);
    float coreGlow = exp(-dist * dist * 3.2) * 0.24;

    float intensity = clamp(rimBand + innerBand + coreGlow, 0.0, 0.92);
    vec3 col = mix(uColorA, uColorB, clamp(rimBand * 0.7 + swirl * 0.3, 0.0, 1.0));

    float alpha = intensity * (1.0 - smoothstep(0.88, 1.0, dist)) * 0.78;
    finalColor = vec4(col * alpha + base.rgb * 0.0, alpha);
}
`

function hexToNormRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const norm = clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean
  const n = parseInt(norm, 16)
  if (!Number.isFinite(n)) return [0.65, 0.55, 1.0]
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function hexToInt(hex: string): number {
  const clean = hex.replace('#', '')
  const norm = clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean
  const n = parseInt(norm, 16)
  return Number.isFinite(n) ? n : 0xa855f7
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

const STYLE_TUNING: Record<Exclude<AvatarAuraStyle, 'none'>, { speed: number; rings: number; highlight: [number, number, number] }> = {
  fire: { speed: 3.3, rings: 2.2, highlight: [1.0, 0.88, 0.32] },
  sunlight: { speed: 2.2, rings: 2.6, highlight: [1.0, 0.96, 0.65] },
  lightning: { speed: 4.2, rings: 3.4, highlight: [0.85, 0.97, 1.0] },
  frost: { speed: 1.6, rings: 2.4, highlight: [0.9, 0.99, 1.0] },
  nature: { speed: 1.8, rings: 1.6, highlight: [0.8, 0.98, 0.55] },
  hearts: { speed: 2.1, rings: 2.0, highlight: [1.0, 0.78, 0.9] },
  stardust: { speed: 2.5, rings: 3.0, highlight: [0.95, 0.85, 1.0] },
  floral_stars: { speed: 2.2, rings: 2.4, highlight: [1.0, 0.88, 0.95] },
  petals: { speed: 1.9, rings: 1.8, highlight: [1.0, 0.85, 0.92] },
  bubbles: { speed: 2.4, rings: 2.8, highlight: [0.8, 0.97, 1.0] },
  music: { speed: 2.8, rings: 2.5, highlight: [0.95, 0.78, 1.0] },
  custom: { speed: 2.6, rings: 2.4, highlight: [1.0, 0.94, 0.85] },
}

/** Maps a Lira AvatarAuraConfig into GPU GLSL shader + pixel-art object + ground-circle parameters. */
export function mapAuraSpecToShaderPreset(aura?: AvatarAuraConfig | null): AuraShaderPreset | null {
  const spec = resolveAuraSpec(aura ?? undefined)
  if (!spec) return null

  const styleKey = aura?.style && aura.style !== 'none' ? aura.style : 'custom'
  const primary = hexToNormRgb(spec.color)
  const tuning = STYLE_TUNING[styleKey] || STYLE_TUNING.custom
  const secondary = mixRgb(primary, tuning.highlight, 0.48)
  const densityScale = spec.density === 'intense' ? 1.45 : spec.density === 'subtle' ? 0.65 : 1.0
  const groundCircle = Boolean(spec.groundCircle)
  const groundCircleSize = clampAuraGroundCircleSize(spec.groundCircleSize)

  return {
    key: `${styleKey}:${spec.color.toLowerCase()}:${spec.density}:${groundCircle ? 1 : 0}:${groundCircleSize}`,
    colorA: primary,
    colorB: secondary,
    lightColor: spec.color,
    particleTint: hexToInt(spec.color),
    speed: tuning.speed,
    rings: tuning.rings,
    densityScale,
    groundCircle,
    groundCircleSize,
    shapes: spec.shapes,
    hasCustomMatrix: Boolean(spec.pixelMatrix && spec.pixelMatrix.length > 0),
  }
}

function createQuadTexture(): Texture {
  if (typeof document === 'undefined') return Texture.WHITE
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 64, 64)
  return Texture.from(c)
}

interface FilterSlot {
  filter: Filter
  uniforms: UniformGroup<{
    uTime: { value: number; type: 'f32' }
    uSpeed: { value: number; type: 'f32' }
    uRings: { value: number; type: 'f32' }
    uColorA: { value: Float32Array; type: 'vec3<f32>' }
    uColorB: { value: Float32Array; type: 'vec3<f32>' }
  }>
}

export interface AuraActorInput {
  id: string
  px: number
  py: number
  aura?: AvatarAuraConfig | null
}

/** Optional GLSL ground circle + crisp pixel-art aura object renderer for Lira avatars. */
export class PixiAuraSystem {
  private readonly groundContainer: Container
  private readonly particlesGfx: Graphics
  private readonly quadTex: Texture
  private readonly glProgram: GlProgram | null
  private readonly filterCache = new Map<string, FilterSlot>()
  private readonly actorSprites = new Map<string, Sprite>()

  constructor(groundContainer: Container, overlayContainer: Container) {
    this.groundContainer = groundContainer
    this.particlesGfx = new Graphics()
    overlayContainer.addChild(this.particlesGfx)

    this.quadTex = createQuadTexture()
    this.glProgram =
      typeof document !== 'undefined'
        ? GlProgram.from({
            vertex: FILTER_VERT,
            fragment: AURA_FRAG,
            name: 'lira-avatar-aura-shader',
          })
        : null
  }

  private getFilterSlot(preset: AuraShaderPreset, timeSec: number): FilterSlot | null {
    if (!this.glProgram) return null
    let slot = this.filterCache.get(preset.key)
    if (!slot) {
      if (this.filterCache.size >= 24) {
        const firstKey = this.filterCache.keys().next().value
        if (firstKey) {
          this.filterCache.get(firstKey)?.filter.destroy()
          this.filterCache.delete(firstKey)
        }
      }
      const uniforms = new UniformGroup({
        uTime: { value: timeSec, type: 'f32' as const },
        uSpeed: { value: preset.speed, type: 'f32' as const },
        uRings: { value: preset.rings, type: 'f32' as const },
        uColorA: { value: new Float32Array(preset.colorA), type: 'vec3<f32>' as const },
        uColorB: { value: new Float32Array(preset.colorB), type: 'vec3<f32>' as const },
      })
      const filter = new Filter({
        glProgram: this.glProgram,
        resources: { auraUniforms: uniforms },
        blendMode: 'add',
      })
      slot = { filter, uniforms }
      this.filterCache.set(preset.key, slot)
    }
    slot.uniforms.uniforms.uTime = timeSec
    return slot
  }

  private getAuraSprite(actorId: string): Sprite {
    let spr = this.actorSprites.get(actorId)
    if (!spr) {
      spr = new Sprite(this.quadTex)
      spr.anchor.set(0.5)
      spr.width = 76
      spr.height = 48
      this.groundContainer.addChild(spr)
      this.actorSprites.set(actorId, spr)
    }
    return spr
  }

  private renderAuraParticles(nowMs: number): void {
    this.particlesGfx.clear()
    const effects = AvatarEffectsManager.getInstance()
    if (!effects.isEnabled()) return
    const auraEffect = effects.getEffect('avatar:aura') as AuraEffect | undefined
    if (!auraEffect || !auraEffect.enabled) return

    const particles = auraEffect.getParticles()
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      const progress = p.age / p.maxAge
      if (progress < 0 || progress >= 1) continue

      const fadeIn = Math.min(1, progress / 0.12)
      const fadeOut = progress > 0.65 ? 1 - (progress - 0.65) / 0.35 : 1
      let alpha = Math.max(0, Math.min(1, fadeIn * fadeOut))
      if (p.twinkle) {
        alpha *= 0.68 + 0.32 * Math.sin(nowMs / 95 + p.phase)
      }
      if (alpha <= 0.02) continue

      const swayX = p.swayAmp !== 0 ? Math.sin(p.age * p.swayFreq + p.phase) * p.swayAmp : 0
      const matrix = p.customMatrix && p.customMatrix.length > 0 ? p.customMatrix : SHAPE_MATRICES[p.shape]
      if (!matrix || matrix.length === 0) continue

      const pixelSize = Math.max(1, Math.round(p.scale))
      const rows = matrix.length
      const cols = matrix[0]?.length || 0
      const ox = Math.round(p.x + swayX - (cols * pixelSize) / 2)
      const oy = Math.round(p.y - (rows * pixelSize) / 2)

      const primary = parseHexColor(p.color, 0xffffff)
      const accent = parseHexColor(p.secondaryColor, 0xffffff)
      const outline = parseHexColor(p.outlineColor, 0x581c87)

      for (let r = 0; r < rows; r++) {
        const line = matrix[r]
        for (let c = 0; c < line.length; c++) {
          const cell = line[c]
          if (cell === '0' || cell === ' ') continue
          const col = cell === '3' ? outline : cell === '2' ? accent : primary
          this.particlesGfx
            .rect(ox + c * pixelSize, oy + r * pixelSize, pixelSize, pixelSize)
            .fill({ color: col, alpha })
        }
      }
    }
  }

  public update(
    _dt: number,
    timeSec: number,
    actors: readonly AuraActorInput[],
    nowMs: number = timeSec * 1000
  ): LightDescriptor[] {
    const dynamicLights: LightDescriptor[] = []
    const seenGround = new Set<string>()

    for (const actor of actors) {
      const preset = mapAuraSpecToShaderPreset(actor.aura)
      if (!preset) continue

      if (preset.groundCircle) {
        seenGround.add(actor.id)
        const spr = this.getAuraSprite(actor.id)
        const slot = this.getFilterSlot(preset, timeSec)
        spr.visible = true
        spr.width = preset.groundCircleSize
        spr.height = Math.max(12, Math.round(preset.groundCircleSize * 0.64))
        spr.position.set(actor.px, actor.py)
        if (slot && spr.filters?.[0] !== slot.filter) {
          spr.filters = [slot.filter]
        }

        dynamicLights.push({
          name: `aura-${actor.id}`,
          x: actor.px,
          y: actor.py - 6,
          color: preset.lightColor,
          radius: Math.max(70, Math.round(preset.groundCircleSize * 1.85)),
          intensity: 0.65,
          flicker: true,
        })
      }
    }

    for (const [id, spr] of this.actorSprites) {
      if (!seenGround.has(id)) spr.visible = false
    }

    this.renderAuraParticles(nowMs)
    return dynamicLights
  }

  public destroy(): void {
    for (const spr of this.actorSprites.values()) spr.destroy()
    this.actorSprites.clear()
    for (const slot of this.filterCache.values()) slot.filter.destroy()
    this.filterCache.clear()
    this.glProgram?.destroy()
    if (this.quadTex !== Texture.WHITE) {
      this.quadTex.destroy(true)
    }
    this.particlesGfx.destroy()
  }
}
