import { Application, CanvasSource, Container, Graphics, Sprite, Texture, TextureStyle } from 'pixi.js'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useGameStore } from '../../store/useGameStore'
import { houseZoneIdForFurniture, useMapStore } from '../../store/useMapStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import type { CustomAsset } from '../../types/customAsset'
import type { Player } from '../../types/game'
import type { PlacedFurniture } from '../../types/map'
import { CameraManager } from '../camera/CameraManager'
import { TILE_SIZE } from '../Constants'
import { WorldRenderer } from '../rendering/worldRenderer'
import { loadPackAtlases, type PackAtlases } from './packAtlas'
import { PixiAuraSystem, type AuraActorInput } from './PixiAuraSystem'
import { extractMapLights, PixiLightingSystem, type LightDescriptor } from './PixiLightingSystem'

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
 * Coordinates PixiJS v8 WebGL rendering for Lira:
 * - Dynamic cutaway interior/roof layers for any user-placed House asset
 * - GPU GLSL avatar auras & additive particles
 * - Screen-space RenderTexture 2D lighting (multiply blend)
 * - Offscreen 2D bridge for floors, walls, furniture, avatars & pets
 */
export class PixiWorldRenderer {
  private readonly host: HTMLElement
  private app: Application | null = null
  private lighting: PixiLightingSystem | null = null
  private auraSystem: PixiAuraSystem | null = null

  private readonly worldContainer = new Container()
  private readonly houseInteriorLayer = new Container()
  private readonly groundAuraLayer = new Container()
  private readonly roofLayer = new Container()
  private readonly overlayAuraLayer = new Container()

  private readonly bufferCanvas: HTMLCanvasElement
  private readonly bufferCtx: CanvasRenderingContext2D
  private bufferTexture: Texture | null = null
  private bufferSprite: Sprite | null = null

  private packAtlases: PackAtlases | null = null
  private packLoadStarted = false
  private readonly dynamicHouses = new Map<string, DynamicHouseNode>()
  private lastLightFurnRef: unknown = null
  private lastLightZonesRef: unknown = null
  private cachedMapLights: LightDescriptor[] = []

  private initialized = false
  private failed = false
  private disposed = false
  private initPromise: Promise<void> | null = null
  private lastTickMs = performance.now()

  constructor(host: HTMLElement) {
    this.host = host
    this.bufferCanvas = document.createElement('canvas')
    this.bufferCanvas.width = Math.max(2, host.clientWidth || 800)
    this.bufferCanvas.height = Math.max(2, host.clientHeight || 600)
    const ctx = this.bufferCanvas.getContext('2d')
    if (!ctx) throw new Error('Could not create offscreen 2D buffer for PixiWorldRenderer')
    ctx.imageSmoothingEnabled = false
    this.bufferCtx = ctx

    this.worldContainer.addChild(this.houseInteriorLayer, this.groundAuraLayer)
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
        width: Math.max(2, this.host.clientWidth || 800),
        height: Math.max(2, this.host.clientHeight || 600),
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
      })

      this.host.innerHTML = ''
      this.host.appendChild(app.canvas)

      this.app = app
      this.lighting = new PixiLightingSystem(app)
      this.auraSystem = new PixiAuraSystem(this.groundAuraLayer, this.overlayAuraLayer)

      this.rebuildBufferTexture(this.bufferCanvas.width, this.bufferCanvas.height)
      if (this.bufferSprite) {
        // Order: houseInteriorLayer (underlay) -> bufferSprite (base map + furniture + entities) -> groundAuraLayer -> roofLayer -> overlayAuraLayer
        this.worldContainer.addChildAt(this.bufferSprite, 1)
        this.worldContainer.addChild(this.roofLayer, this.overlayAuraLayer)
      }

      app.stage.addChild(this.worldContainer, this.lighting.overlaySprite)
      this.initialized = true
    } catch (err) {
      console.warn('[PixiWorldRenderer] Falling back to Canvas 2D:', err)
      this.failed = true
    }
  }

  private rebuildBufferTexture(width: number, height: number): void {
    const w = Math.max(2, Math.floor(width))
    const h = Math.max(2, Math.floor(height))
    this.bufferCanvas.width = w
    this.bufferCanvas.height = h
    this.bufferCtx.imageSmoothingEnabled = false

    const oldTex = this.bufferTexture
    const source = new CanvasSource({ resource: this.bufferCanvas, scaleMode: 'nearest' })
    this.bufferTexture = new Texture({ source })

    if (!this.bufferSprite) {
      this.bufferSprite = new Sprite(this.bufferTexture)
    } else {
      this.bufferSprite.texture = this.bufferTexture
    }
    oldTex?.destroy(true)
  }

  public syncSize(width: number, height: number): void {
    const w = Math.max(2, Math.floor(width))
    const h = Math.max(2, Math.floor(height))
    if (this.app && (this.app.screen.width !== w || this.app.screen.height !== h)) {
      this.app.renderer.resize(w, h)
    }
    if (this.bufferCanvas.width !== w || this.bufferCanvas.height !== h) {
      this.rebuildBufferTexture(w, h)
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

  public renderFrame(camera: CameraManager, currentTime: number): boolean {
    if (!this.isReady() || !this.app || !this.lighting || !this.auraSystem || !this.bufferSprite || !this.bufferTexture) {
      return false
    }

    const nowMs = performance.now()
    const dt = Math.max(0.001, Math.min((nowMs - this.lastTickMs) / 1000, 0.1))
    this.lastTickMs = nowMs
    const timeSec = nowMs / 1000

    const mapStore = useMapStore.getState()
    const map = mapStore.mapData
    const gameStore = useGameStore.getState()
    const settings = useSettingsStore.getState()
    const localPlayer = gameStore.localPlayer
    const activeZoneId = localPlayer.currentZoneId ?? null

    const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1.0
    const camX = Number.isFinite(camera.x) ? camera.x : 34 * TILE_SIZE
    const camY = Number.isFinite(camera.y) ? camera.y : 20 * TILE_SIZE
    const viewWidth = this.app.screen.width / zoom
    const viewHeight = this.app.screen.height / zoom
    const worldOffsetX = (viewWidth / 2 - camX) * zoom
    const worldOffsetY = (viewHeight / 2 - camY) * zoom

    this.app.renderer.background.color = 0x0c0e14
    this.worldContainer.scale.set(zoom)
    this.worldContainer.position.set(worldOffsetX, worldOffsetY)
    this.bufferSprite.scale.set(1 / zoom)
    this.bufferSprite.position.set(-worldOffsetX / zoom, -worldOffsetY / zoom)

    const closedZoneIds = this.syncDynamicHouses(dt, activeZoneId)

    // Render base floors, walls, furniture & entities onto buffer (with cutaway interiors drawn cleanly on top of base floor)
    WorldRenderer.renderWorldBasePass(this.bufferCtx, this.bufferCanvas, camera, currentTime, closedZoneIds, this.dynamicHouses.size > 0)
    this.bufferTexture.source.update()

    // Ensure houseInteriorLayer sits above base floor (bufferSprite) while entities render cleanly
    // Note: bufferSprite draws base floor + furniture + entities; when houses exist, draw interior wood/walls in houseInteriorLayer?
    // Wait: if bufferSprite is opaque, houseInteriorLayer below bufferSprite would be covered by base floor!
    // Put houseInteriorLayer right ABOVE base floor? Even better: renderWorldBasePass already clears/fills opaque base floor.
    // Let's keep houseInteriorLayer ABOVE bufferSprite? No — if houseInteriorLayer is above bufferSprite, it would cover sofas/avatars inside!
    // Instead, WorldRenderer.renderWorldBasePass clips/punches out open house interiors OR draws interiors.png planks/walls directly under furniture!
    // Wait: check if PixiJS houseInteriorLayer is needed when WorldRenderer clips or draws: if bufferSprite punches a transparent hole over open house footprints (clearRect), houseInteriorLayer underneath shines right through with PixiJS sharpness AND furniture/avatars sit above it? Wait — bufferSprite also draws the sofas/avatars!
    // Let's put houseInteriorLayer AT index 0 (behind bufferSprite) AND inside renderWorldBasePass, skip painting opaque floor tiles inside open house zones? No, bufferCanvas starts opaque (`fillStyle = '#0c0e14'`). If we start bufferCanvas transparent (`clearRect`) and fill only outside open house interiors, OR simply draw `houseInteriorLayer` -> wait: why not put `houseInteriorLayer` at index 0 and skip the opaque background fill ONLY inside open house rects (leaving transparent pixels where `houseInteriorLayer` is visible, while sofas & avatars draw onto `bufferCtx` on top)? YES! That's 3 lines and gives crisp PixiJS `interiors.png` underneath + Lira furniture/avatars on top + PixiJS roofs above!

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

    const dynamicLights = this.auraSystem.update(dt, timeSec, auraActors)

    if (this.lastLightFurnRef !== map.furniture || this.lastLightZonesRef !== map.zones) {
      this.lastLightFurnRef = map.furniture
      this.lastLightZonesRef = map.zones
      this.cachedMapLights = extractMapLights(map)
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

    this.app.render()
    return true
  }

  public dispose(): void {
    this.disposed = true
    for (const node of this.dynamicHouses.values()) this.removeHouseNode(node)
    this.dynamicHouses.clear()
    this.auraSystem?.destroy()
    this.lighting?.destroy()
    this.bufferSprite?.destroy()
    this.bufferTexture?.destroy(true)
    this.app?.destroy(true, { children: true })
    this.auraSystem = null
    this.lighting = null
    this.bufferSprite = null
    this.bufferTexture = null
    this.app = null
  }
}
