import { Application, Container, Graphics, Sprite, Texture, TextureStyle } from 'pixi.js'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useGameStore } from '../../store/useGameStore'
import { houseZoneIdForFurniture, useMapStore } from '../../store/useMapStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { CustomAsset } from '../../types/customAsset'
import type { Player } from '../../types/game'
import type { PlacedFurniture } from '../../types/map'
import { CameraManager } from '../camera/CameraManager'
import { TILE_SIZE } from '../Constants'
import { loadPackAtlases, type PackAtlases } from './packAtlas'
import { PixiAuraSystem, type AuraActorInput } from './PixiAuraSystem'
import { PixiEntityLayer } from './PixiEntityLayer'
import { PixiFloorLayer } from './PixiFloorLayer'
import { PixiFurnitureLayer } from './PixiFurnitureLayer'
import { buildPlayerPersonalLights, extractMapLights, PixiLightingSystem, type LightDescriptor } from './PixiLightingSystem'
import { type OverlayRenderState, PixiOverlayLayer } from './PixiOverlayLayer'
import { PixiTextureCache } from './PixiTextureCache'
import { PixiWallLayer } from './PixiWallLayer'

interface DynamicHouseNode {
  furnId: string
  defId: string
  x: number
  y: number
  zoneId: string
  interiorContainer: Container
  exteriorContainer: Container
  alpha: number
}

function resolveExteriorTexture(defId: string, packs: PackAtlases): Texture {
  if (defId === 'lira_house_village_blue_v1') return packs.village.houseBlue
  if (defId === 'lira_house_witch_tower_v1') return packs.halloween.houseWitch
  return packs.village.houseRed
}

function createHouseNode(furn: PlacedFurniture, asset: CustomAsset, packs: PackAtlases): DynamicHouseNode {
  const shell = asset.houseShell!
  const zx = Math.round(furn.x)
  const zy = Math.round(furn.y)
  const zw = asset.width
  const zh = asset.height

  const interiorContainer = new Container()
  interiorContainer.alpha = 0
  interiorContainer.visible = false

  const roomFrame = new Graphics()
  roomFrame
    .rect(zx * TILE_SIZE - 3, zy * TILE_SIZE - 3, zw * TILE_SIZE + 6, zh * TILE_SIZE + 6)
    .fill({ color: 0x16121b, alpha: 0.96 })
    .stroke({ width: 2, color: 0x475569, alpha: 0.8 })
  interiorContainer.addChild(roomFrame)

  for (let ty = zy + 1; ty < zy + zh; ty++) {
    for (let tx = zx; tx < zx + zw; tx++) {
      const plank = new Sprite((tx + ty) % 2 === 0 ? packs.interiors.woodPlank1 : packs.interiors.woodPlank2)
      plank.position.set(tx * TILE_SIZE, ty * TILE_SIZE)
      plank.scale.set(2)
      plank.tint = shell.interiorTint ?? 0xffffff
      interiorContainer.addChild(plank)
    }
  }

  for (let tx = zx; tx < zx + zw; tx++) {
    const wall = new Sprite(packs.interiors.wallCream)
    wall.position.set(tx * TILE_SIZE, zy * TILE_SIZE)
    wall.scale.set(2)
    wall.tint = shell.wallTint ?? 0xffffff
    interiorContainer.addChild(wall)

    const trim = new Sprite(packs.interiors.wallTrimCream)
    trim.position.set(tx * TILE_SIZE, zy * TILE_SIZE - 4)
    trim.scale.set(2)
    trim.tint = shell.wallTint ?? 0xffffff
    interiorContainer.addChild(trim)
  }

  for (const col of shell.doorCols) {
    const mat = new Graphics()
    mat
      .rect((zx + col) * TILE_SIZE + 2, (zy + zh - 1) * TILE_SIZE + 6, TILE_SIZE - 4, TILE_SIZE - 8)
      .fill({ color: 0xf59e0b, alpha: 0.24 })
    interiorContainer.addChild(mat)
  }

  const exteriorContainer = new Container()
  const extTex = resolveExteriorTexture(furn.defId, packs)
  const extSprite = new Sprite(extTex)
  const drawW = zw * TILE_SIZE
  const drawH = drawW * (extTex.height / Math.max(1, extTex.width))
  extSprite.width = drawW
  extSprite.height = drawH
  extSprite.position.set(zx * TILE_SIZE, (zy + zh) * TILE_SIZE - drawH)
  exteriorContainer.addChild(extSprite)

  return {
    furnId: furn.id,
    defId: furn.defId,
    x: zx,
    y: zy,
    zoneId: houseZoneIdForFurniture(furn.id),
    interiorContainer,
    exteriorContainer,
    alpha: 1,
  }
}

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
  private readonly houseInteriorLayer = new Container()
  private readonly wallLayer = new PixiWallLayer(this.textures)
  private readonly furnitureLayer = new PixiFurnitureLayer(this.textures)
  private readonly entityLayer = new PixiEntityLayer(this.textures)
  private readonly groundAuraLayer = new Container()
  private readonly roofLayer = new Container()
  private readonly overlayAuraLayer = new Container()
  private readonly overlayLayer = new PixiOverlayLayer(this.textures)
  private readonly worldContainer = new Container()

  private packAtlases: PackAtlases | null = null
  private packLoadStarted = false
  private readonly dynamicHouses = new Map<string, DynamicHouseNode>()
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
      this.houseInteriorLayer,
      this.wallLayer.container,
      this.furnitureLayer.container,
      this.entityLayer.groundEffectsLayer,
      this.groundAuraLayer,
      this.entityLayer.entityLayer,
      this.roofLayer,
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

  private ensurePackAtlases(): PackAtlases | null {
    if (this.packAtlases) return this.packAtlases
    if (!this.packLoadStarted) {
      this.packLoadStarted = true
      loadPackAtlases()
        .then((packs) => {
          if (!this.disposed) this.packAtlases = packs
        })
        .catch((err) => {
          console.warn('[PixiWorldRenderer] Failed to load pixel packs:', err)
        })
    }
    return null
  }

  private removeHouseNode(node: DynamicHouseNode): void {
    this.houseInteriorLayer.removeChild(node.interiorContainer)
    this.roofLayer.removeChild(node.exteriorContainer)
    node.interiorContainer.destroy({ children: true })
    node.exteriorContainer.destroy({ children: true })
  }

  private syncDynamicHouses(dt: number, activeZoneId: string | null): Set<string> {
    const mapStore = useMapStore.getState()
    const assetsStore = useCustomAssetsStore.getState()
    const placedHouses: { furn: PlacedFurniture; asset: CustomAsset }[] = []

    for (const furn of mapStore.mapData.furniture || []) {
      const asset = assetsStore.getAssetById(furn.defId)
      if (asset?.houseShell) {
        placedHouses.push({ furn, asset })
      }
    }

    if (placedHouses.length === 0) {
      for (const node of this.dynamicHouses.values()) this.removeHouseNode(node)
      this.dynamicHouses.clear()
      return new Set()
    }

    const packs = this.ensurePackAtlases()
    if (!packs) return new Set()

    const placingHouse =
      mapStore.isEditorOpen &&
      mapStore.activeTool === 'place_furniture' &&
      Boolean(assetsStore.getAssetById(mapStore.selectedFurnitureDefId)?.houseShell)

    const seenIds = new Set<string>()
    const closedZoneIds = new Set<string>()

    for (const { furn, asset } of placedHouses) {
      seenIds.add(furn.id)
      const rx = Math.round(furn.x)
      const ry = Math.round(furn.y)
      let node = this.dynamicHouses.get(furn.id)
      if (!node || node.defId !== furn.defId || node.x !== rx || node.y !== ry) {
        const prevAlpha = node?.alpha ?? 1
        if (node) this.removeHouseNode(node)
        node = createHouseNode(furn, asset, packs)
        node.alpha = prevAlpha
        this.houseInteriorLayer.addChild(node.interiorContainer)
        this.roofLayer.addChild(node.exteriorContainer)
        this.dynamicHouses.set(furn.id, node)
      }

      const openInterior =
        node.zoneId === activeZoneId || (mapStore.isEditorOpen && !placingHouse)
      const targetExteriorAlpha = openInterior ? 0.0 : 1.0
      node.alpha += (targetExteriorAlpha - node.alpha) * Math.min(1, dt * 9)

      node.exteriorContainer.alpha = node.alpha
      node.exteriorContainer.visible = node.alpha > 0.02
      const interiorAlpha = 1 - node.alpha
      node.interiorContainer.alpha = interiorAlpha
      node.interiorContainer.visible = interiorAlpha > 0.02

      if (!openInterior && node.alpha > 0.5) {
        closedZoneIds.add(node.zoneId)
      }
    }

    for (const [id, node] of this.dynamicHouses) {
      if (!seenIds.has(id)) {
        this.removeHouseNode(node)
        this.dynamicHouses.delete(id)
      }
    }

    return closedZoneIds
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
    const map = mapStore.mapData
    const customAssets = useCustomAssetsStore.getState().customAssets
    const gameStore = useGameStore.getState()
    const settings = useSettingsStore.getState()
    const localPlayer = gameStore.localPlayer
    const activeZoneId = localPlayer.currentZoneId ?? null

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

    this.app.renderer.background.color = 0x0c0e14
    this.worldContainer.scale.set(zoom)
    this.worldContainer.position.set(worldOffsetX, worldOffsetY)

    const closedZoneIds = this.syncDynamicHouses(dt, activeZoneId)

    this.floorLayer.update(this.app.renderer, map, customAssets, currentTime)
    this.wallLayer.update(map, customAssets, currentTime)
    this.furnitureLayer.update(map, customAssets, currentTime)
    this.entityLayer.update(localPlayer, gameStore.remotePlayers, closedZoneIds, bounds, currentTime)

    const auraActors: AuraActorInput[] = []
    const pushAuraActor = (p: Player, isLocal: boolean) => {
      if (!isLocal && p.currentZoneId && closedZoneIds.has(p.currentZoneId)) return
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

    const auraLights = this.auraSystem.update(dt, timeSec, auraActors)
    const personalLights = buildPlayerPersonalLights(localPlayer, gameStore.remotePlayers, closedZoneIds)
    const dynamicLights = [...personalLights, ...auraLights]

    if (
      this.lastLightFurnRef !== map.furniture ||
      this.lastLightZonesRef !== map.zones ||
      this.lastLightAssetsRef !== customAssets
    ) {
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
      dynamicLights,
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
    for (const node of this.dynamicHouses.values()) this.removeHouseNode(node)
    this.dynamicHouses.clear()
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
