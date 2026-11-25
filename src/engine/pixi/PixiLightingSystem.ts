import { Application, Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import type { LightingMode } from '../../store/useSettingsStore'
import type { CustomAsset } from '../../types/customAsset'
import type { Player } from '../../types/game'
import type { MapData, PrivateZone } from '../../types/map'
import { TILE_SIZE } from '../Constants'
import { resolveFurnitureDimensions } from '../rendering/furnitureRenderer'

export interface LightDescriptor {
  name: string
  x: number
  y: number
  color: string
  radius: number
  intensity: number
  flicker?: boolean
  zoneId?: string
}

const TIME_PRESETS = {
  day: { ambient: 0xffffff, darkness: 0.02 },
  sunset: { ambient: 0xffb38a, darkness: 0.42 },
  night: { ambient: 0x2e3b68, darkness: 0.82 },
} as const

function hexToRgb(hex: string | number): [number, number, number] {
  if (typeof hex === 'number') {
    return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
  }
  const clean = String(hex || '#ffffff').replace('#', '')
  const normalized = clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean
  const n = parseInt(normalized, 16)
  if (!Number.isFinite(n)) return [255, 255, 255]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerpColor(c1: number, c2: number, t: number): number {
  const [r1, g1, b1] = hexToRgb(c1)
  const [r2, g2, b2] = hexToRgb(c2)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return (r << 16) | (g << 8) | b
}

function createSoftLightTexture(): Texture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2
  const grad = ctx.createRadialGradient(cx, cx, 4, cx, cx, cx)
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)')
  grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.78)')
  grad.addColorStop(0.62, 'rgba(255, 255, 255, 0.28)')
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
  return Texture.from(canvas)
}

function findContainingZone(zones: readonly PrivateZone[], tx: number, ty: number): string {
  for (const z of zones) {
    if (tx >= z.x && tx <= z.x + z.width && ty >= z.y && ty <= z.y + z.height) {
      return z.id
    }
  }
  return ''
}

/** Builds automatic personal lantern lights for the local player and visible remote players. */
export function buildPlayerPersonalLights(
  localPlayer: Player,
  remotePlayers: Record<string, Player>,
  closedZoneIds: ReadonlySet<string>
): LightDescriptor[] {
  const lights: LightDescriptor[] = [
    {
      name: 'Luz do Jogador',
      x: (localPlayer.x + 0.5) * TILE_SIZE,
      y: (localPlayer.y + 0.55) * TILE_SIZE,
      color: '#ffebd2',
      radius: 135,
      intensity: 0.72,
      zoneId: localPlayer.currentZoneId || undefined,
    },
  ]

  for (const remote of Object.values(remotePlayers)) {
    if (remote.isDjBot || remote.id.startsWith('dj-')) continue
    if (remote.id === localPlayer.id || (remote.gameId && remote.gameId === localPlayer.id)) continue
    if (remote.currentZoneId && closedZoneIds.has(remote.currentZoneId)) continue
    lights.push({
      name: 'Luz de Jogador',
      x: (remote.x + 0.5) * TILE_SIZE,
      y: (remote.y + 0.55) * TILE_SIZE,
      color: '#ffebd2',
      radius: 110,
      intensity: 0.55,
      zoneId: remote.currentZoneId || undefined,
    })
  }

  return lights
}

/** Derives automatic 2D point lights from zones, custom light configs, pack props, and illuminated furniture. */
export function extractMapLights(map: MapData, customAssets?: readonly CustomAsset[]): LightDescriptor[] {
  const lights: LightDescriptor[] = []
  const zones = map.zones || []
  const assets = customAssets ?? useCustomAssetsStore.getState().customAssets
  const assetById = new Map<string, CustomAsset>()
  for (const asset of assets) {
    assetById.set(asset.id, asset)
  }

  for (const z of zones) {
    lights.push({
      name: z.name,
      x: (z.x + z.width * 0.5) * TILE_SIZE,
      y: (z.y + z.height * 0.5) * TILE_SIZE,
      color: '#ffeed6',
      radius: Math.max(150, Math.max(z.width, z.height) * TILE_SIZE * 0.72),
      intensity: 0.78,
      zoneId: z.id,
    })
  }

  for (const furn of map.furniture || []) {
    const id = furn.defId.toLowerCase()
    const customAsset = assetById.get(furn.defId)
    const { tileW, tileH } = resolveFurnitureDimensions(furn, customAsset)
    const cx = (furn.x + tileW * 0.5) * TILE_SIZE
    const cy = (furn.y + tileH * 0.5) * TILE_SIZE
    const zoneId = findContainingZone(zones, furn.x + tileW * 0.5, furn.y + tileH * 0.5)

    // Explicit per-instance light override takes top priority
    const explicitLight = furn.light ?? customAsset?.light
    if (explicitLight !== undefined) {
      if (explicitLight.enabled) {
        lights.push({
          name: customAsset?.name || furn.defId,
          x: cx,
          y: cy,
          color: explicitLight.color || '#ffd580',
          radius: Math.max(30, Math.min(500, explicitLight.radius)),
          intensity: Math.max(0.05, Math.min(1.2, explicitLight.intensity)),
          flicker: Boolean(explicitLight.flicker),
          zoneId: zoneId || undefined,
        })
      }
      continue
    }

    const tileCenterX = (furn.x + 0.5) * TILE_SIZE
    const tileCenterY = (furn.y + 0.5) * TILE_SIZE

    if (id === 'lira_pack_cauldron_v1') {
      const px = (furn.x + 1) * TILE_SIZE
      const py = (furn.y + 1) * TILE_SIZE
      lights.push({ name: 'Caldeirão Mágico', x: px, y: py - 8, color: '#4ade80', radius: 175, intensity: 0.95, flicker: true })
      lights.push({ name: 'Fogo Caldeirão', x: px, y: py + 6, color: '#fb923c', radius: 130, intensity: 0.85, flicker: true })
    } else if (id.startsWith('lira_pack_jack_')) {
      const large = id.includes('large')
      const px = (furn.x + (large ? 1 : 0.5)) * TILE_SIZE
      const py = (furn.y + (large ? 1 : 0.5)) * TILE_SIZE
      lights.push({ name: 'Abóbora Iluminada', x: px, y: py, color: '#ff7b1c', radius: large ? 150 : 120, intensity: 0.92, flicker: true })
    } else if (id === 'lira_pack_spooky_lamp_v1') {
      lights.push({ name: 'Lampião Assombrado', x: tileCenterX, y: furn.y * TILE_SIZE + 12, color: '#fbbf24', radius: 165, intensity: 0.92, flicker: true })
    } else if (id === 'lira_pack_village_lamp_v1') {
      lights.push({ name: 'Poste da Vila', x: tileCenterX, y: furn.y * TILE_SIZE + 12, color: '#ffd580', radius: 175, intensity: 0.92 })
    } else if (id === 'lira_pack_tombstone_candles_v1') {
      lights.push({ name: 'Velas Tumba', x: tileCenterX, y: tileCenterY - 6, color: '#fb923c', radius: 105, intensity: 0.78, flicker: true })
    } else if (id === 'lira_int_lamp_v1') {
      lights.push({ name: 'Abajur', x: tileCenterX, y: tileCenterY, color: '#fde047', radius: 125, intensity: 0.8, zoneId })
    } else if (id === 'lira_int_fireplace_v1') {
      lights.push({ name: 'Lareira', x: tileCenterX, y: tileCenterY, color: '#ff8f3a', radius: 185, intensity: 0.95, flicker: true, zoneId })
    } else if (id.startsWith('lira_house_')) {
      const w = id.includes('blue') ? 10 : id.includes('witch') ? 8 : 7
      const h = id.includes('blue') ? 5 : 6
      lights.push({
        name: 'Janela da Casa',
        x: (furn.x + w * 0.5) * TILE_SIZE,
        y: (furn.y + h - 0.5) * TILE_SIZE,
        color: id.includes('witch') ? '#c084fc' : '#fbbf24',
        radius: 130,
        intensity: 0.68,
      })
    } else if (/(smelter|forge|crucible|fire|torch|candle|hearth)/.test(id)) {
      lights.push({ name: furn.defId, x: cx, y: cy, color: '#ff8a36', radius: 190, intensity: 0.95, flicker: true, zoneId })
    } else if (/(lamp|light|lantern|abajur)/.test(id)) {
      lights.push({ name: furn.defId, x: cx, y: cy, color: '#ffd580', radius: 165, intensity: 0.88, zoneId })
    } else if (/(monitor|pc|tv|screen|desk|arcade)/.test(id)) {
      lights.push({ name: furn.defId, x: cx, y: cy, color: '#60a5fa', radius: 115, intensity: 0.6, zoneId })
    }
  }
  return lights
}

/** Screen-space RenderTexture 2D lightmap composited over the world via multiply blend. */
export class PixiLightingSystem {
  public readonly overlaySprite: Sprite
  private readonly app: Application
  private readonly lightTexture: Texture
  private readonly lightScene: Container
  private readonly ambientRect: Graphics
  private readonly lightsContainer: Container
  private readonly renderTexture: RenderTexture
  private readonly spritePool: Sprite[] = []
  private autoPhase = 0.2

  constructor(app: Application) {
    this.app = app
    this.lightTexture = createSoftLightTexture()
    this.lightScene = new Container()
    this.ambientRect = new Graphics()
    this.lightsContainer = new Container()
    this.lightScene.addChild(this.ambientRect, this.lightsContainer)

    this.renderTexture = RenderTexture.create({
      width: Math.max(2, app.screen.width),
      height: Math.max(2, app.screen.height),
      resolution: 1,
    })

    this.overlaySprite = new Sprite(this.renderTexture)
    this.overlaySprite.blendMode = 'multiply'
    this.overlaySprite.eventMode = 'none'
  }

  private resize(width: number, height: number): void {
    const w = Math.max(2, Math.floor(width))
    const h = Math.max(2, Math.floor(height))
    if (this.renderTexture.width !== w || this.renderTexture.height !== h) {
      this.renderTexture.resize(w, h)
    }
  }

  private getAmbientInfo(dt: number, mode: LightingMode, activeZoneId: string | null) {
    let baseColor: number = TIME_PRESETS.day.ambient
    let darkness: number = TIME_PRESETS.day.darkness

    if (mode === 'auto') {
      this.autoPhase = (this.autoPhase + dt * 0.025) % 1
      if (this.autoPhase < 0.33) {
        const t = this.autoPhase / 0.33
        baseColor = lerpColor(TIME_PRESETS.day.ambient, TIME_PRESETS.sunset.ambient, t)
        darkness = TIME_PRESETS.day.darkness + (TIME_PRESETS.sunset.darkness - TIME_PRESETS.day.darkness) * t
      } else if (this.autoPhase < 0.66) {
        const t = (this.autoPhase - 0.33) / 0.33
        baseColor = lerpColor(TIME_PRESETS.sunset.ambient, TIME_PRESETS.night.ambient, t)
        darkness = TIME_PRESETS.sunset.darkness + (TIME_PRESETS.night.darkness - TIME_PRESETS.sunset.darkness) * t
      } else {
        const t = (this.autoPhase - 0.66) / 0.34
        baseColor = lerpColor(TIME_PRESETS.night.ambient, TIME_PRESETS.day.ambient, t)
        darkness = TIME_PRESETS.night.darkness + (TIME_PRESETS.day.darkness - TIME_PRESETS.night.darkness) * t
      }
    } else {
      const preset = TIME_PRESETS[mode] || TIME_PRESETS.day
      baseColor = preset.ambient
      darkness = preset.darkness
    }

    if (activeZoneId && mode !== 'day') {
      baseColor = lerpColor(baseColor, 0x1d2542, 0.25)
      darkness = Math.max(darkness, 0.45)
    }

    return { baseColor, darkness }
  }

  public update(
    enabled: boolean,
    mode: LightingMode,
    dt: number,
    timeSec: number,
    worldScale: number,
    worldOffsetX: number,
    worldOffsetY: number,
    mapLights: readonly LightDescriptor[],
    dynamicLights: readonly LightDescriptor[],
    activeZoneId: string | null
  ): void {
    const { baseColor, darkness } = this.getAmbientInfo(dt, mode, activeZoneId)
    if (!enabled || mode === 'day') {
      this.overlaySprite.visible = false
      return
    }
    this.overlaySprite.visible = true

    const w = this.app.screen.width
    const h = this.app.screen.height
    this.resize(w, h)

    this.ambientRect.clear()
    this.ambientRect.rect(0, 0, w, h).fill(baseColor)

    const allLights: Array<LightDescriptor & { index: number; boost: number }> = []
    for (let i = 0; i < mapLights.length; i++) {
      const l = mapLights[i]
      const isSameZone = Boolean(l.zoneId && l.zoneId === activeZoneId)
      if (l.zoneId && !isSameZone && darkness < 0.35) continue
      allLights.push({ ...l, index: i, boost: isSameZone ? 1.25 : 1 })
    }
    for (let i = 0; i < dynamicLights.length; i++) {
      allLights.push({ ...dynamicLights[i], index: 100 + i, boost: 1 })
    }

    while (this.spritePool.length < allLights.length) {
      const s = new Sprite(this.lightTexture)
      s.anchor.set(0.5)
      s.blendMode = 'add'
      this.lightsContainer.addChild(s)
      this.spritePool.push(s)
    }

    for (let i = 0; i < this.spritePool.length; i++) {
      const sprite = this.spritePool[i]
      if (i >= allLights.length) {
        sprite.visible = false
        continue
      }

      const l = allLights[i]
      const screenX = l.x * worldScale + worldOffsetX
      const screenY = l.y * worldScale + worldOffsetY
      let radius = l.radius * worldScale
      let intensity = l.intensity * l.boost

      if (l.flicker) {
        const wave =
          Math.sin(timeSec * 8.5 + l.index * 2.1) * 0.06 +
          Math.sin(timeSec * 14.3 + l.index * 5.7) * 0.04
        radius *= 1 + wave
        intensity *= 0.94 + wave * 0.9
      }

      if (
        screenX + radius < 0 ||
        screenX - radius > w ||
        screenY + radius < 0 ||
        screenY - radius > h
      ) {
        sprite.visible = false
        continue
      }

      sprite.visible = true
      sprite.position.set(screenX, screenY)
      sprite.scale.set((radius * 2) / 256)
      sprite.tint = l.color
      const daylightFactor = 0.25 + darkness * 0.95
      sprite.alpha = Math.min(1, intensity * daylightFactor)
    }

    this.app.renderer.render({
      container: this.lightScene,
      target: this.renderTexture,
      clear: true,
    })
  }

  public destroy(): void {
    this.overlaySprite.destroy()
    this.renderTexture.destroy(true)
    this.lightTexture.destroy(true)
    this.lightScene.destroy({ children: true })
  }
}
