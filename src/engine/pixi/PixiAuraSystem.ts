import { Container, Filter, GlProgram, Sprite, Texture, UniformGroup } from 'pixi.js'
import type { AvatarAuraConfig, AvatarAuraStyle } from '../../types/game'
import { resolveAuraSpec } from '../avatarEffects/presets'
import type { LightDescriptor } from './PixiLightingSystem'

export interface AuraShaderPreset {
  key: string
  colorA: [number, number, number]
  colorB: [number, number, number]
  lightColor: string
  particleTint: number
  speed: number
  rings: number
  densityScale: number
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

    float outerRing = smoothstep(0.95, 0.52, dist) * smoothstep(0.18, 0.62, dist);
    float coreGlow = exp(-dist * dist * 3.8) * 0.62;
    float edgePulse = smoothstep(0.88, 0.72, dist) * smoothstep(0.55, 0.72, dist) * (0.55 + 0.45 * swirl);

    float intensity = clamp(outerRing * (0.35 + 0.65 * wave) + coreGlow + edgePulse * 0.75, 0.0, 1.0);
    vec3 col = mix(uColorA, uColorB, clamp(swirl * 0.65 + (1.0 - dist) * 0.35, 0.0, 1.0));

    float alpha = intensity * (1.0 - smoothstep(0.75, 1.0, dist));
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

/** Maps a Lira AvatarAuraConfig into GPU GLSL shader + particle + light parameters. */
export function mapAuraSpecToShaderPreset(aura?: AvatarAuraConfig | null): AuraShaderPreset | null {
  const spec = resolveAuraSpec(aura ?? undefined)
  if (!spec) return null

  const styleKey = aura?.style && aura.style !== 'none' ? aura.style : 'custom'
  const primary = hexToNormRgb(spec.color)
  const tuning = STYLE_TUNING[styleKey] || STYLE_TUNING.custom
  const secondary = mixRgb(primary, tuning.highlight, 0.48)
  const densityScale = spec.density === 'intense' ? 1.45 : spec.density === 'subtle' ? 0.65 : 1.0

  return {
    key: `${styleKey}:${spec.color.toLowerCase()}:${spec.density}`,
    colorA: primary,
    colorB: secondary,
    lightColor: spec.color,
    particleTint: hexToInt(spec.color),
    speed: tuning.speed,
    rings: tuning.rings,
    densityScale,
  }
}

function createParticleDotTexture(): Texture {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(8, 8, 1, 8, 8, 8)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.65)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 16, 16)
  return Texture.from(c)
}

function createQuadTexture(): Texture {
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

interface GpuParticle {
  sprite: Sprite
  vx: number
  vy: number
  age: number
  life: number
  baseScale: number
}

export interface AuraActorInput {
  id: string
  px: number
  py: number
  aura?: AvatarAuraConfig | null
}

/** GPU GLSL aura rings + additive GPU particle emitter for Lira avatars. */
export class PixiAuraSystem {
  private readonly groundContainer: Container
  private readonly particleContainer: Container
  private readonly particleTex: Texture
  private readonly quadTex: Texture
  private readonly glProgram: GlProgram
  private readonly filterCache = new Map<string, FilterSlot>()
  private readonly actorSprites = new Map<string, Sprite>()
  private readonly particles: GpuParticle[] = []
  private spawnTimer = 0

  constructor(groundContainer: Container, overlayContainer: Container) {
    this.groundContainer = groundContainer
    this.particleContainer = new Container()
    overlayContainer.addChild(this.particleContainer)

    this.particleTex = createParticleDotTexture()
    this.quadTex = createQuadTexture()
    this.glProgram = GlProgram.from({
      vertex: FILTER_VERT,
      fragment: AURA_FRAG,
      name: 'lira-avatar-aura-shader',
    })
  }

  private getFilterSlot(preset: AuraShaderPreset, timeSec: number): FilterSlot {
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

  private spawnParticle(x: number, y: number, preset: AuraShaderPreset): void {
    if (this.particles.length >= 180) return
    const sprite = new Sprite(this.particleTex)
    sprite.anchor.set(0.5)
    sprite.blendMode = 'add'
    sprite.tint = preset.particleTint
    const angle = Math.random() * Math.PI * 2
    const radius = 6 + Math.random() * 14
    sprite.position.set(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 0.55)
    const size = 0.3 + Math.random() * 0.42
    sprite.scale.set(size)
    this.particleContainer.addChild(sprite)
    this.particles.push({
      sprite,
      vx: Math.cos(angle) * (5 + Math.random() * 10),
      vy: -16 - Math.random() * 22,
      age: 0,
      life: 0.7 + Math.random() * 0.65,
      baseScale: size,
    })
  }

  public update(dt: number, timeSec: number, actors: readonly AuraActorInput[]): LightDescriptor[] {
    const dynamicLights: LightDescriptor[] = []
    const seen = new Set<string>()
    this.spawnTimer += dt
    const shouldEmit = this.spawnTimer >= 0.06
    if (shouldEmit) this.spawnTimer = 0

    for (const actor of actors) {
      const preset = mapAuraSpecToShaderPreset(actor.aura)
      if (!preset) continue
      seen.add(actor.id)

      const spr = this.getAuraSprite(actor.id)
      const slot = this.getFilterSlot(preset, timeSec)
      spr.visible = true
      spr.position.set(actor.px, actor.py)
      if (spr.filters?.[0] !== slot.filter) {
        spr.filters = [slot.filter]
      }

      if (shouldEmit && Math.random() < 0.72 * preset.densityScale) {
        this.spawnParticle(actor.px, actor.py - 4, preset)
      }

      dynamicLights.push({
        name: `aura-${actor.id}`,
        x: actor.px,
        y: actor.py - 6,
        color: preset.lightColor,
        radius: 130,
        intensity: 0.8,
        flicker: true,
      })
    }

    for (const [id, spr] of this.actorSprites) {
      if (!seen.has(id)) spr.visible = false
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i]
      pt.age += dt
      if (pt.age >= pt.life) {
        this.particleContainer.removeChild(pt.sprite)
        pt.sprite.destroy()
        this.particles.splice(i, 1)
        continue
      }
      const progress = pt.age / pt.life
      pt.sprite.x += pt.vx * dt
      pt.sprite.y += pt.vy * dt
      pt.sprite.alpha = Math.sin(progress * Math.PI) * 0.88
      pt.sprite.scale.set(pt.baseScale * (1 - progress * 0.45))
    }

    return dynamicLights
  }

  public destroy(): void {
    for (const pt of this.particles) pt.sprite.destroy()
    this.particles.length = 0
    for (const spr of this.actorSprites.values()) spr.destroy()
    this.actorSprites.clear()
    for (const slot of this.filterCache.values()) slot.filter.destroy()
    this.filterCache.clear()
    this.glProgram.destroy()
    this.particleTex.destroy(true)
    this.quadTex.destroy(true)
    this.particleContainer.destroy({ children: true })
  }
}
