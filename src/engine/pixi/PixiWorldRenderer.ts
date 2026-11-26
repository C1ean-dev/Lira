import { Application, Container, TextureStyle } from 'pixi.js'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { Player } from '../../types/game'
import { CameraManager } from '../camera/CameraManager'
import { TILE_SIZE } from '../Constants'
import { PixiAuraSystem, type AuraActorInput } from './PixiAuraSystem'
import { PixiEntityLayer } from './PixiEntityLayer'
import { PixiFloorLayer } from './PixiFloorLayer'
import { PixiFurnitureLayer } from './PixiFurnitureLayer'
import { extractMapLights, PixiLightingSystem, type LightDescriptor } from './PixiLightingSystem'
import { type OverlayRenderState, PixiOverlayLayer } from './PixiOverlayLayer'
import { PixiTextureCache } from './PixiTextureCache'
import { PixiWallLayer } from './PixiWallLayer'

/**
 * 100% Native PixiJS v8 WebGL world renderer for Lira:
 * - Static & animated floor tiles (RenderTexture + Sprites)
 * - Procedural & custom room walls and doors
 * - Layered furniture, interactive beds, and cutaway houses
 * - Y-sorted avatars, pets, step trails, and GPU GLSL auras
 * - Screen-space RenderTexture 2D dynamic lighting (multiply blend)
 * - Unlit crisp UI overlays (zones, gizmos, name tags, reactions, FPS)
 * No Canvas 2D fallback.
 */
export class PixiWorldRenderer {
  private readonly host: HTMLElement
  private readonly onError?: (message: string) => void
  private app: Application | null = null
  private lighting: PixiLightingSystem | null = null
  private auraSystem: PixiAuraSystem | null = null

  private readonly textures = new PixiTextureCache()
  private readonly floorLayer = new PixiFloorLayer(this.textures)
  private readonly wallLayer = new PixiWallLayer(this.textures)
  private readonly furnitureLayer = new PixiFurnitureLayer(this.textures)
  private readonly entityLayer = new PixiEntityLayer(this.textures)
  private readonly groundAuraLayer = new Container()
  private readonly overlayAuraLayer = new Container()
  private readonly overlayLayer = new PixiOverlayLayer(this.textures)
  private readonly worldContainer = new Container()

  private lastLightMapId: string | null = null
  private lastLightFurnRef: unknown = null
  private lastLightZonesRef: unknown = null
  private lastLightAssetsRef: unknown = null
  private cachedMapLights: LightDescriptor[] = []

  private initialized = false
  private failed = false
  private disposed = false
  private initPromise: Promise<void> | null = null
  private lastTickMs = performance.now()
  private pendingWidth = 800
  private pendingHeight = 600

  constructor(host: HTMLElement, onError?: (message: string) => void) {
    this.host = host
    this.onError = onError
    this.pendingWidth = Math.max(2, host.clientWidth || 800)
    this.pendingHeight = Math.max(2, host.clientHeight || 600)

    this.worldContainer.addChild(
      this.floorLayer.container,
      this.wallLayer.container,
      this.furnitureLayer.container,
      this.entityLayer.groundEffectsLayer,
      this.groundAuraLayer,
      this.entityLayer.entityLayer,
      this.overlayAuraLayer
    )
  }

  public isReady(): boolean {
    return this.initialized && !this.failed && !this.disposed
  }

  public hasFailed(): boolean {
    return this.failed
  }

  public init(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.initInternal()
    return this.initPromise
  }

  private async initInternal(): Promise<void> {
    try {
      TextureStyle.defaultOptions.scaleMode = 'nearest'
      const app = new Application()
      await app.init({
        width: this.pendingWidth,
        height: this.pendingHeight,
        backgroundColor: 0x0c0e14,
        antialias: false,
        preference: 'webgl',
        autoStart: false,
        resolution: 1,
      })

      if (this.disposed) {
        app.destroy(true, { children: true })
        return
      }

      app.canvas.style.width = '100%'
      app.canvas.style.height = '100%'
      app.canvas.style.display = 'block'
      app.canvas.style.pointerEvents = 'none'
      app.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault()
        this.failed = true
        this.onError?.('Contexto WebGL perdido no motor gráfico PixiJS v8.')
      })

      this.host.innerHTML = ''
      this.host.appendChild(app.canvas)

      this.app = app
      const liveW = Math.max(2, Math.floor(this.host.clientWidth || this.pendingWidth))
      const liveH = Math.max(2, Math.floor(this.host.clientHeight || this.pendingHeight))
      this.pendingWidth = liveW
      this.pendingHeight = liveH
      if (app.screen.width !== liveW || app.screen.height !== liveH) {
        app.renderer.resize(liveW, liveH)
      }
      this.lighting = new PixiLightingSystem(app)
      this.auraSystem = new PixiAuraSystem(this.groundAuraLayer, this.overlayAuraLayer)

      app.stage.addChild(
        this.worldContainer,
        this.lighting.overlaySprite,
        this.overlayLayer.worldOverlay,
        this.overlayLayer.hudLayer
      )
      this.initialized = true
    } catch (err) {
      this.failed = true
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[PixiWorldRenderer] Falha ao inicializar WebGL/PixiJS v8:', err)
      this.onError?.(`Falha ao inicializar PixiJS v8 (WebGL): ${msg}`)
    }
  }

  public syncSize(width: number, height: number): void {
    const w = Math.max(2, Math.floor(width))
    const h = Math.max(2, Math.floor(height))
    this.pendingWidth = w
    this.pendingHeight = h
    if (this.app && (this.app.screen.width !== w || this.app.screen.height !== h)) {
      this.app.renderer.resize(w, h)
    }
  }

  public renderFrame(camera: CameraManager, currentTime: number, overlayState: OverlayRenderState): boolean {
    if (!this.isReady() || !this.app || !this.lighting || !this.auraSystem) {
      return false
    }

    const nowMs = performance.now()
    const dt = Math.max(0.001, Math.min((nowMs - this.lastTickMs) / 1000, 0.1))
    this.lastTickMs = nowMs
    const timeSec = nowMs / 1000

    const mapStore = useMapStore.getState()
    const map = mapStore.getActiveMapData()
    const customAssets = useCustomAssetsStore.getState().customAssets
    const gameStore = useGameStore.getState()
    const settings = useSettingsStore.getState()
    const localPlayer = gameStore.localPlayer
    const activeZoneId = localPlayer.currentZoneId ?? null
    const localHouseId = localPlayer.currentHouseId ?? null

    if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) camera.zoom = 1.0
    if (!Number.isFinite(camera.x)) camera.x = 34 * TILE_SIZE
    if (!Number.isFinite(camera.y)) camera.y = 20 * TILE_SIZE

    const zoom = camera.zoom
    const camX = camera.x
    const camY = camera.y
    const viewWidth = this.app.screen.width / zoom
    const viewHeight = this.app.screen.height / zoom
    const worldOffsetX = (viewWidth / 2 - camX) * zoom
    const worldOffsetY = (viewHeight / 2 - camY) * zoom

    const bounds = {
      camMinX: camX - viewWidth / 2,
      camMaxX: camX + viewWidth / 2,
      camMinY: camY - viewHeight / 2,
      camMaxY: camY + viewHeight / 2,
      enableCulling: settings.enableCulling,
    }

    this.app.renderer.background.color = mapStore.activeHouseId ? 0x090b10 : 0x0c0e14
    this.worldContainer.scale.set(zoom)
    this.worldContainer.position.set(worldOffsetX, worldOffsetY)

    this.floorLayer.update(this.app.renderer, map, customAssets, currentTime)
    this.wallLayer.update(map, customAssets, currentTime)
    this.furnitureLayer.update(map, customAssets, currentTime)
    this.entityLayer.update(localPlayer, gameStore.remotePlayers, bounds, currentTime)

    const auraActors: AuraActorInput[] = []
    const pushAuraActor = (p: Player, isLocal: boolean) => {
      if (!isLocal && (p.currentHouseId ?? null) !== localHouseId) return
      auraActors.push({
        id: p.id,
        px: (p.x + 0.5) * TILE_SIZE,
        py: (p.y + 0.78) * TILE_SIZE,
        aura: p.avatar?.aura,
      })
    }
    pushAuraActor(localPlayer, true)
    for (const remote of Object.values(gameStore.remotePlayers)) {
      if (remote.isDjBot || remote.id.startsWith('dj-')) continue
      if (remote.id === localPlayer.id || (remote.gameId && remote.gameId === localPlayer.id)) continue
      pushAuraActor(remote, false)
    }

    const auraLights = this.auraSystem.update(dt, timeSec, auraActors, currentTime)

    if (
      this.lastLightMapId !== map.id ||
      this.lastLightFurnRef !== map.furniture ||
      this.lastLightZonesRef !== map.zones ||
      this.lastLightAssetsRef !== customAssets
    ) {
      this.lastLightMapId = map.id
      this.lastLightFurnRef = map.furniture
      this.lastLightZonesRef = map.zones
      this.lastLightAssetsRef = customAssets
      this.cachedMapLights = extractMapLights(map, customAssets)
    }

    this.lighting.update(
      settings.lightingEnabled,
      settings.lightingMode,
      dt,
      timeSec,
      zoom,
      worldOffsetX,
      worldOffsetY,
      this.cachedMapLights,
      auraLights,
      activeZoneId
    )

    this.overlayLayer.update(
      this.app.screen.width,
      this.app.screen.height,
      zoom,
      worldOffsetX,
      worldOffsetY,
      bounds,
      overlayState,
      currentTime
    )

    this.app.render()
    return true
  }

  public dispose(): void {
    this.disposed = true
    this.floorLayer.destroy()
    this.wallLayer.destroy()
    this.furnitureLayer.destroy()
    this.entityLayer.destroy()
    this.overlayLayer.destroy()
    this.auraSystem?.destroy()
    this.lighting?.destroy()
    this.textures.destroy()
    this.app?.destroy(true, { children: true })
    this.auraSystem = null
    this.lighting = null
    this.app = null
  }
}
