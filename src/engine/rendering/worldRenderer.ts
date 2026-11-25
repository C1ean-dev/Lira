import { TILE_SIZE, FURNITURE_CATALOG } from '../Constants'
import { PixelArtRenderer } from '../PixelArtRenderer'
import { AvatarRenderer, NameTagRenderer } from '../AvatarRenderer'
import { PetRenderer } from '../pet/PetRenderer'
import { PetManager, PetState } from '../pet/PetManager'
import { Player, PetConfig, Direction } from '../../types/game'
import { PlacedFurniture, PrivateZone } from '../../types/map'
import { useGameStore } from '../../store/useGameStore'
import { houseZoneIdForFurniture, useMapStore } from '../../store/useMapStore'
import { useCustomAssetsStore, getCustomAssetImage } from '../../store/useCustomAssetsStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { CameraManager } from '../camera/CameraManager'
import { getStaticLayer } from './staticLayerCache'
import { FurnitureRenderer, resolveFurnitureDimensions } from './furnitureRenderer'
import { furnitureDrawOrder } from './furnitureLayers'
import { renderBedParticipant } from './bedRenderer'
import { AvatarEffectsManager } from '../avatarEffects'

type RenderableEntity =
  | { kind: 'player'; y: number; player: Player; isLocal: boolean }
  | { kind: 'pet'; y: number; pet: PetState; petConfig: PetConfig }

interface CameraBounds {
  viewWidth: number
  viewHeight: number
  camMinX: number
  camMaxX: number
  camMinY: number
  camMaxY: number
  startX: number
  endX: number
  startY: number
  endY: number
  enableCulling: boolean
}

function normalizeAndApplyCamera(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camera: CameraManager,
  mapW: number,
  mapH: number
): CameraBounds {
  if (isNaN(camera.zoom) || camera.zoom <= 0) camera.zoom = 1.0
  if (isNaN(camera.x)) camera.x = 34 * TILE_SIZE
  if (isNaN(camera.y)) camera.y = 20 * TILE_SIZE

  const viewWidth = canvas.width / camera.zoom
  const viewHeight = canvas.height / camera.zoom

  ctx.scale(camera.zoom, camera.zoom)
  ctx.imageSmoothingEnabled = false
  ctx.translate(viewWidth / 2 - camera.x, viewHeight / 2 - camera.y)

  const enableCulling = useSettingsStore.getState().enableCulling
  const camMinX = camera.x - viewWidth / 2
  const camMaxX = camera.x + viewWidth / 2
  const camMinY = camera.y - viewHeight / 2
  const camMaxY = camera.y + viewHeight / 2

  return {
    viewWidth,
    viewHeight,
    camMinX,
    camMaxX,
    camMinY,
    camMaxY,
    startX: enableCulling ? Math.max(0, Math.floor(camMinX / TILE_SIZE) - 1) : 0,
    endX: enableCulling ? Math.min(mapW, Math.ceil(camMaxX / TILE_SIZE) + 1) : mapW,
    startY: enableCulling ? Math.max(0, Math.floor(camMinY / TILE_SIZE) - 1) : 0,
    endY: enableCulling ? Math.min(mapH, Math.ceil(camMaxY / TILE_SIZE) + 1) : mapH,
    enableCulling,
  }
}

function collectVisibleEntities(
  localPlayer: Player,
  remotePlayers: Record<string, Player>,
  bounds: CameraBounds,
  closedZoneIds?: ReadonlySet<string>
): RenderableEntity[] {
  const remoteList = Object.values(remotePlayers).filter((p) => !p.isDjBot && !p.id.startsWith('dj-'))
  const allEntities: RenderableEntity[] = [
    { kind: 'player', y: localPlayer.y, player: localPlayer, isLocal: true },
  ]

  const isHiddenBehindRoof = (p: Player) =>
    Boolean(closedZoneIds && p.currentZoneId && closedZoneIds.has(p.currentZoneId))

  for (let i = 0; i < remoteList.length; i++) {
    const p = remoteList[i]
    if (p.id === localPlayer.id || (p.gameId && p.gameId === localPlayer.id)) continue
    if (isHiddenBehindRoof(p)) continue
    if (bounds.enableCulling) {
      const ppx = (p.x + 0.5) * TILE_SIZE
      const ppy = (p.y + 0.5) * TILE_SIZE
      if (ppx < bounds.camMinX - 64 || ppx > bounds.camMaxX + 64 || ppy < bounds.camMinY - 64 || ppy > bounds.camMaxY + 64) {
        continue
      }
    }
    allEntities.push({ kind: 'player', y: p.y, player: p, isLocal: false })
  }

  const petManager = PetManager.getInstance()
  for (let i = -1; i < remoteList.length; i++) {
    const p = i === -1 ? localPlayer : remoteList[i]
    if (i !== -1 && (p.id === localPlayer.id || (p.gameId && p.gameId === localPlayer.id))) continue
    if (i !== -1 && isHiddenBehindRoof(p)) continue
    if (p.avatar?.pet && p.avatar.pet.type !== 'none') {
      const pet = petManager.getPet(p.id)
      if (pet) {
        if (bounds.enableCulling && i !== -1) {
          const ppx = (pet.x + 0.5) * TILE_SIZE
          const ppy = (pet.y + 0.5) * TILE_SIZE
          if (ppx < bounds.camMinX - 64 || ppx > bounds.camMaxX + 64 || ppy < bounds.camMinY - 64 || ppy > bounds.camMaxY + 64) {
            continue
          }
        }
        allEntities.push({ kind: 'pet', y: pet.y, pet, petConfig: p.avatar.pet })
      }
    }
  }

  if (allEntities.length > 1) allEntities.sort((a, b) => a.y - b.y)
  return allEntities
}

export class WorldRenderer {
  /** Renders the static/animated Lira world layer + entities (without name tags or editor overlays) for PixiJS composition. */
  static renderWorldBasePass(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camera: CameraManager,
    currentTime: number,
    closedZoneIds?: ReadonlySet<string>,
    skipHouseShells: boolean = false
  ) {
    const map = useMapStore.getState().mapData
    const { localPlayer, remotePlayers } = useGameStore.getState()
    const assetsStore = useCustomAssetsStore.getState()

    ctx.fillStyle = '#0c0e14'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.imageSmoothingEnabled = false

    try {
      const bounds = normalizeAndApplyCamera(ctx, canvas, camera, map.width || 68, map.height || 40)
      const staticLayer = getStaticLayer(map)
      if (staticLayer) {
        ctx.drawImage(staticLayer.canvas, 0, 0)
        for (const t of staticLayer.animatedFloorTiles) {
          if (bounds.enableCulling && (t.x < bounds.startX || t.x >= bounds.endX || t.y < bounds.startY || t.y >= bounds.endY)) continue
          PixelArtRenderer.drawFloor(ctx, t.type, t.x * TILE_SIZE, t.y * TILE_SIZE, TILE_SIZE, t.x, t.y, map.floors)
        }
        if (staticLayer.foregroundCanvas) ctx.drawImage(staticLayer.foregroundCanvas, 0, 0)
        for (const zone of staticLayer.animatedZones) {
          PixelArtRenderer.drawLiraRoom(ctx, zone, map.zones || [])
        }
        if (skipHouseShells) {
          for (const item of staticLayer.animatedFurniture) {
            const asset = assetsStore.getAssetById(item.defId)
            if (!asset?.houseShell) continue
            const linkedZoneId = houseZoneIdForFurniture(item.id)
            if (!closedZoneIds?.has(linkedZoneId)) {
              ctx.clearRect(Math.round(item.x) * TILE_SIZE, Math.round(item.y) * TILE_SIZE, asset.width * TILE_SIZE, asset.height * TILE_SIZE)
            }
          }
        }
        for (const item of staticLayer.animatedFurniture) {
          if (skipHouseShells && assetsStore.getAssetById(item.defId)?.houseShell) continue
          if (bounds.enableCulling && (item.x + 4 < bounds.startX || item.x - 1 > bounds.endX || item.y + 4 < bounds.startY || item.y - 1 > bounds.endY)) continue
          PixelArtRenderer.drawFurniture(ctx, item)
        }
      } else {
        ctx.fillStyle = '#f6e7d2'
        ctx.fillRect(bounds.startX * TILE_SIZE, bounds.startY * TILE_SIZE, (bounds.endX - bounds.startX) * TILE_SIZE + 2, (bounds.endY - bounds.startY) * TILE_SIZE + 2)
        for (let y = bounds.startY; y < bounds.endY; y++) {
          for (let x = bounds.startX; x < bounds.endX; x++) {
            const floor = map.floors?.[y]?.[x] || 'wood_parquet'
            PixelArtRenderer.drawFloor(ctx, floor, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, x, y, map.floors)
          }
        }
        for (const zone of map.zones || []) {
          if (bounds.enableCulling) {
            const zx0 = zone.x * TILE_SIZE, zx1 = (zone.x + zone.width) * TILE_SIZE
            const zy0 = zone.y * TILE_SIZE, zy1 = (zone.y + zone.height) * TILE_SIZE
            if (zx1 < bounds.camMinX || zx0 > bounds.camMaxX || zy1 < bounds.camMinY || zy0 > bounds.camMaxY) continue
          }
          PixelArtRenderer.drawLiraRoom(ctx, zone, map.zones || [])
        }
        const ordered = furnitureDrawOrder(map.furniture || [], assetsStore.customAssets)
        if (skipHouseShells) {
          for (const item of ordered) {
            const asset = assetsStore.getAssetById(item.defId)
            if (!asset?.houseShell) continue
            const linkedZoneId = houseZoneIdForFurniture(item.id)
            if (!closedZoneIds?.has(linkedZoneId)) {
              ctx.clearRect(Math.round(item.x) * TILE_SIZE, Math.round(item.y) * TILE_SIZE, asset.width * TILE_SIZE, asset.height * TILE_SIZE)
            }
          }
        }
        for (const item of ordered) {
          if (skipHouseShells && assetsStore.getAssetById(item.defId)?.houseShell) continue
          if (bounds.enableCulling && (item.x + 4 < bounds.startX || item.x - 1 > bounds.endX || item.y + 4 < bounds.startY || item.y - 1 > bounds.endY)) continue
          PixelArtRenderer.drawFurniture(ctx, item)
        }
      }

      const allEntities = collectVisibleEntities(localPlayer, remotePlayers, bounds, closedZoneIds)
      const avatarEffects = AvatarEffectsManager.getInstance()
      avatarEffects.renderGround(ctx, currentTime, 'avatar:aura')
      for (const entity of allEntities) {
        if (entity.kind === 'player') {
          renderBedParticipant(ctx, entity.player.id, () => AvatarRenderer.drawPlayer(ctx, entity.player, entity.isLocal, currentTime, TILE_SIZE, false))
        } else {
          PetRenderer.drawPet(ctx, entity.pet, entity.petConfig, currentTime, false)
        }
      }
      avatarEffects.renderOverlay(ctx, currentTime, 'avatar:aura')
    } catch (e) {
      console.error('Error in WorldRenderer.renderWorldBasePass:', e)
    } finally {
      ctx.restore()
    }
  }

  /** Renders unlit crisp UI overlays (name tags, reactions, destination pulse, editor gizmos, FPS) above PixiJS lighting. */
  static renderUiOverlayPass(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camera: CameraManager,
    hoverTile: { x: number; y: number } | null,
    zoneDragStart: { x: number; y: number } | null,
    zoneDragCurrent: { x: number; y: number } | null,
    currentTime: number,
    fps: number,
    destination?: { x: number; y: number } | null,
    isShiftPressed?: boolean
  ) {
    const mapStore = useMapStore.getState()
    const map = mapStore.mapData
    const isEditorOpen = mapStore.isEditorOpen
    const activeTool = mapStore.activeTool
    const zoneDraft = mapStore.zoneDraft
    const { localPlayer, remotePlayers, reactions } = useGameStore.getState()
    const settings = useSettingsStore.getState()
    const showNameTags = settings.showNameTags ?? true
    const assetsStore = useCustomAssetsStore.getState()
    const activeZoneId = localPlayer.currentZoneId ?? null

    // Compute which placed house zones currently have closed roofs
    const closedZoneIds = new Set<string>()
    const closedHouseZones: PrivateZone[] = []
    if (!isEditorOpen) {
      for (const furn of map.furniture || []) {
        if (!assetsStore.getAssetById(furn.defId)?.houseShell) continue
        const linkedZoneId = houseZoneIdForFurniture(furn.id)
        if (linkedZoneId !== activeZoneId) {
          closedZoneIds.add(linkedZoneId)
          const z = (map.zones || []).find((item) => item.id === linkedZoneId)
          if (z) closedHouseZones.push(z)
        }
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.imageSmoothingEnabled = false

    try {
      const bounds = normalizeAndApplyCamera(ctx, canvas, camera, map.width || 68, map.height || 40)

      if (isEditorOpen) {
        for (const zone of map.zones || []) {
          if (bounds.enableCulling) {
            const zx0 = zone.x * TILE_SIZE, zx1 = (zone.x + zone.width) * TILE_SIZE
            const zy0 = zone.y * TILE_SIZE, zy1 = (zone.y + zone.height) * TILE_SIZE
            if (zx1 < bounds.camMinX || zx0 > bounds.camMaxX || zy1 < bounds.camMinY || zy0 > bounds.camMaxY) continue
          }
          PixelArtRenderer.drawPrivateZone(ctx, zone, localPlayer.currentZoneId === zone.id)
        }
      }

      if (destination && !isEditorOpen) {
        ctx.save()
        const destX = destination.x * TILE_SIZE + 16
        const destY = destination.y * TILE_SIZE + 16
        const pulse = (Math.sin(currentTime / 160) + 1) / 2
        ctx.strokeStyle = `rgba(99, 102, 241, ${0.4 + pulse * 0.45})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(destX, destY, 7 + pulse * 5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#6366f1'
        ctx.beginPath()
        ctx.arc(destX, destY, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      if (isEditorOpen && mapStore.selectedPlacedFurnitureId) {
        const selFurn = (map.furniture || []).find((f) => f.id === mapStore.selectedPlacedFurnitureId)
        if (selFurn) {
          const customAsset = assetsStore.getAssetById(selFurn.defId)
          const def = customAsset || FURNITURE_CATALOG.find((f) => f.id === selFurn.defId)
          const { targetW: fw, targetH: fh } = resolveFurnitureDimensions(selFurn, customAsset, def)
          const fx = Math.round(selFurn.x * TILE_SIZE)
          const fy = Math.round(selFurn.y * TILE_SIZE)
          ctx.save()
          const pulse = (Math.sin(currentTime / 180) + 1) / 2
          ctx.strokeStyle = `rgba(99, 102, 241, ${0.8 + pulse * 0.2})`
          ctx.lineWidth = 2.5
          ctx.setLineDash([6, 3])
          ctx.strokeRect(fx - 1, fy - 1, fw + 2, fh + 2)
          ctx.setLineDash([])
          ctx.fillStyle = '#ffffff'
          const handleSz = 5
          ctx.fillRect(fx - handleSz / 2, fy - handleSz / 2, handleSz, handleSz)
          ctx.fillRect(fx + fw - handleSz / 2, fy - handleSz / 2, handleSz, handleSz)
          ctx.fillRect(fx - handleSz / 2, fy + fh - handleSz / 2, handleSz, handleSz)
          ctx.fillRect(fx + fw - handleSz / 2, fy + fh - handleSz / 2, handleSz, handleSz)
          ctx.restore()
        }
      }

      if (showNameTags) {
        const allEntities = collectVisibleEntities(localPlayer, remotePlayers, bounds, closedZoneIds)
        for (const entity of allEntities) {
          if (entity.kind === 'player') {
            const px = entity.player.x * TILE_SIZE
            const py = entity.player.y * TILE_SIZE
            NameTagRenderer.drawNameTag(ctx, entity.player, entity.isLocal, px + TILE_SIZE / 2, py - 13)
          } else {
            PetRenderer.drawNameTag(ctx, entity.pet.x * TILE_SIZE, entity.pet.y * TILE_SIZE, entity.petConfig, currentTime)
          }
        }
      }

      if (closedHouseZones.length > 0) {
        const allPlayers = [localPlayer, ...Object.values(remotePlayers).filter((p) => !p.isDjBot && !p.id.startsWith('dj-'))]
        for (const zone of closedHouseZones) {
          const count = allPlayers.filter((p) => p.currentZoneId === zone.id).length
          const tag = count > 0 ? `${zone.name} (${count})` : zone.name
          const cx = (zone.x + zone.width * 0.5) * TILE_SIZE
          const ty = zone.y * TILE_SIZE - 10
          ctx.save()
          ctx.font = 'bold 9px Inter, sans-serif'
          const tw = ctx.measureText(tag).width + 14
          ctx.fillStyle = 'rgba(15, 23, 42, 0.86)'
          ctx.beginPath()
          ctx.roundRect(cx - tw / 2, ty - 14, tw, 15, 7)
          ctx.fill()
          ctx.strokeStyle = zone.color || '#38bdf8'
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.fillStyle = '#f8fafc'
          ctx.textAlign = 'center'
          ctx.fillText(tag, cx, ty - 3.5)
          ctx.restore()
        }
      }

      for (const r of reactions) {
        const age = currentTime - r.createdAt
        if (age < 3000) {
          const floatY = r.y * TILE_SIZE - (age / 1000) * 20
          ctx.font = '20px serif'
          ctx.fillText(r.emoji, r.x * TILE_SIZE + 6, floatY)
        }
      }

      if (isEditorOpen && activeTool === 'draw_zone' && zoneDragStart && zoneDragCurrent) {
        WorldRenderer.drawZoneDraftOverlay(ctx, map.zones, zoneDragStart, zoneDragCurrent, zoneDraft)
      } else if (isEditorOpen && hoverTile) {
        WorldRenderer.drawEditorHoverOverlay(ctx, mapStore, hoverTile, isShiftPressed)
      }
    } catch (e) {
      console.error('Error in WorldRenderer.renderUiOverlayPass:', e)
    } finally {
      ctx.restore()
    }

    if (settings.showFpsCounter) {
      WorldRenderer.drawFpsBadge(ctx, canvas, fps)
    }
  }

  private static drawZoneDraftOverlay(
    ctx: CanvasRenderingContext2D,
    zones: PrivateZone[],
    zoneDragStart: { x: number; y: number },
    zoneDragCurrent: { x: number; y: number },
    zoneDraft: { name: string; color: string }
  ) {
    const minX = Math.min(zoneDragStart.x, zoneDragCurrent.x)
    const maxX = Math.max(zoneDragStart.x, zoneDragCurrent.x)
    const minY = Math.min(zoneDragStart.y, zoneDragCurrent.y)
    const maxY = Math.max(zoneDragStart.y, zoneDragCurrent.y)
    const w = (maxX - minX + 1) * TILE_SIZE
    const h = (maxY - minY + 1) * TILE_SIZE
    const px = minX * TILE_SIZE
    const py = minY * TILE_SIZE
    const isOverlapping = zones.some((z) => {
      const overlapX = Math.min(maxX, z.x + z.width - 1) - Math.max(minX, z.x)
      const overlapY = Math.min(maxY, z.y + z.height - 1) - Math.max(minY, z.y)
      return overlapX >= 1 && overlapY >= 1
    })
    ctx.save()
    ctx.fillStyle = isOverlapping ? 'rgba(239, 68, 68, 0.35)' : zoneDraft.color ? `${zoneDraft.color}35` : 'rgba(76, 110, 245, 0.25)'
    ctx.fillRect(px, py, w, h)
    ctx.strokeStyle = isOverlapping ? '#ef4444' : zoneDraft.color || '#4c6ef5'
    ctx.lineWidth = 3
    ctx.setLineDash([8, 4])
    ctx.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3)
    ctx.setLineDash([])
    const badgeText = isOverlapping
      ? `🚫 SOBREPOSIÇÃO NÃO PERMITIDA (${maxX - minX + 1}x${maxY - minY + 1})`
      : `${zoneDraft.name} (${maxX - minX + 1}x${maxY - minY + 1} tiles)`
    ctx.font = 'bold 11px sans-serif'
    const textWidth = ctx.measureText(badgeText).width
    ctx.fillStyle = isOverlapping ? '#dc2626' : zoneDraft.color || '#4c6ef5'
    ctx.beginPath()
    ctx.roundRect(px + 4, py - 20, textWidth + 14, 18, 5)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.fillText(badgeText, px + 11, py - 6)
    ctx.restore()
  }

  private static drawEditorHoverOverlay(
    ctx: CanvasRenderingContext2D,
    mapStore: ReturnType<typeof useMapStore.getState>,
    hoverTile: { x: number; y: number },
    isShiftPressed?: boolean
  ) {
    const map = mapStore.mapData
    const activeTool = mapStore.activeTool
    ctx.save()
    const tx = hoverTile.x
    const ty = hoverTile.y

    if (activeTool === 'place_furniture') {
      const placementDir = mapStore.placementDirection || 'down'
      const customAsset = useCustomAssetsStore.getState().getAssetById(mapStore.selectedFurnitureDefId)
      const furnDef = customAsset || FURNITURE_CATALOG.find((f) => f.id === mapStore.selectedFurnitureDefId)
      const { targetW, targetH } = resolveFurnitureDimensions(
        { defId: mapStore.selectedFurnitureDefId, direction: placementDir },
        customAsset,
        furnDef
      )
      const px = Math.round(tx * TILE_SIZE)
      const py = Math.round(ty * TILE_SIZE)
      ctx.fillStyle = furnDef?.iconColor ? `${furnDef.iconColor}33` : 'rgba(76, 110, 245, 0.25)'
      ctx.fillRect(px, py, targetW, targetH)
      ctx.strokeStyle = furnDef?.iconColor || '#4c6ef5'
      ctx.lineWidth = 1.5
      ctx.strokeRect(px + 0.5, py + 0.5, targetW - 1, targetH - 1)
      const rotMap: Record<Direction, 0 | 90 | 180 | 270> = { down: 0, left: 90, up: 180, right: 270 }
      const dummyFurn: PlacedFurniture = {
        id: '__ghost_preview__',
        defId: mapStore.selectedFurnitureDefId,
        x: tx,
        y: ty,
        direction: placementDir,
        rotation: rotMap[placementDir],
      }
      ctx.save()
      ctx.globalAlpha = 0.65
      FurnitureRenderer.drawFurniture(ctx, dummyFurn)
      ctx.restore()
    } else if (activeTool === 'paint_floor') {
      const selectedFloor = mapStore.selectedFloor
      const customAsset = useCustomAssetsStore.getState().getAssetById(selectedFloor)
      const floorW = Math.max(1, Math.round(customAsset?.width || 1))
      const floorH = Math.max(1, Math.round(customAsset?.height || 1))
      if (floorW > 1 || floorH > 1) {
        const footprintW = floorW * TILE_SIZE
        const footprintH = floorH * TILE_SIZE
        if (customAsset?.frames?.length) {
          const img = getCustomAssetImage(customAsset.frames[0])
          if (img && img.complete && img.naturalWidth > 0) {
            ctx.save()
            ctx.globalAlpha = 0.65
            ctx.drawImage(img, tx * TILE_SIZE, ty * TILE_SIZE, footprintW, footprintH)
            ctx.restore()
          }
        }
        ctx.fillStyle = 'rgba(32, 201, 151, 0.2)'
        ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, footprintW, footprintH)
        ctx.strokeStyle = '#20c997'
        ctx.lineWidth = 2
        ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, footprintW - 1, footprintH - 1)
      } else {
        const zones = map.zones
        let insideZone: PrivateZone | null = null
        if (isShiftPressed && zones) {
          let bestArea = Number.POSITIVE_INFINITY
          for (const z of zones) {
            if (tx >= z.x && tx < z.x + z.width && ty >= z.y && ty < z.y + z.height && z.width * z.height < bestArea) {
              insideZone = z
              bestArea = z.width * z.height
            }
          }
        }
        if (insideZone) {
          ctx.fillStyle = 'rgba(32, 201, 151, 0.18)'
          ctx.fillRect(insideZone.x * TILE_SIZE, insideZone.y * TILE_SIZE, insideZone.width * TILE_SIZE, insideZone.height * TILE_SIZE)
          ctx.strokeStyle = '#20c997'
          ctx.lineWidth = 2
          ctx.strokeRect(insideZone.x * TILE_SIZE + 0.5, insideZone.y * TILE_SIZE + 0.5, insideZone.width * TILE_SIZE - 1, insideZone.height * TILE_SIZE - 1)
        } else {
          ctx.fillStyle = 'rgba(32, 201, 151, 0.2)'
          ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
          ctx.strokeStyle = '#20c997'
          ctx.lineWidth = 2
          ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
        }
      }
    } else if (activeTool === 'paint_wall') {
      ctx.fillStyle = 'rgba(232, 212, 162, 0.4)'
      ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      ctx.strokeStyle = '#fab005'
      ctx.lineWidth = 2
      ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
    } else if (activeTool === 'eraser') {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.22)'
      ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
    } else {
      ctx.strokeStyle = '#20c997'
      ctx.lineWidth = 2
      ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
    }
    ctx.restore()
  }

  private static drawFpsBadge(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, fps: number) {
    ctx.save()
    const fpsText = `${fps} FPS`
    ctx.font = 'bold 12px monospace'
    const textMetrics = ctx.measureText(fpsText)
    const badgeW = textMetrics.width + 18
    const badgeH = 24
    const bx = canvas.width - badgeW - 14
    const by = 14

    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
    ctx.beginPath()
    ctx.roundRect(bx, by, badgeW, badgeH, 6)
    ctx.fill()
    ctx.strokeStyle = fps >= 50 ? '#22c55e' : fps >= 25 ? '#eab308' : '#ef4444'
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.fillStyle = fps >= 50 ? '#4ade80' : fps >= 25 ? '#fde047' : '#f87171'
    ctx.fillText(fpsText, bx + 9, by + 16)
    ctx.restore()
  }

  static render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camera: CameraManager,
    hoverTile: { x: number; y: number } | null,
    zoneDragStart: { x: number; y: number } | null,
    zoneDragCurrent: { x: number; y: number } | null,
    currentTime: number,
    fps: number,
    destination?: { x: number; y: number } | null,
    isShiftPressed?: boolean
  ) {
    const mapStore = useMapStore.getState()
    const map = mapStore.mapData
    const isEditorOpen = mapStore.isEditorOpen
    const activeTool = mapStore.activeTool
    const zoneDraft = mapStore.zoneDraft
    const localPlayer = useGameStore.getState().localPlayer
    const remotePlayers = useGameStore.getState().remotePlayers
    const reactions = useGameStore.getState().reactions

    ctx.fillStyle = '#0c0e14'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (isNaN(camera.zoom) || camera.zoom <= 0) camera.zoom = 1.0
    if (isNaN(camera.x)) camera.x = 34 * TILE_SIZE
    if (isNaN(camera.y)) camera.y = 20 * TILE_SIZE

    ctx.save()
    ctx.imageSmoothingEnabled = false

    try {
      const viewWidth = canvas.width / camera.zoom
      const viewHeight = canvas.height / camera.zoom

      ctx.scale(camera.zoom, camera.zoom)
      ctx.imageSmoothingEnabled = false
      ctx.translate(
        viewWidth / 2 - camera.x,
        viewHeight / 2 - camera.y
      )

      const mapH = map.height || 40
      const mapW = map.width || 68
      const enableCulling = useSettingsStore.getState().enableCulling

      let startX = 0
      let endX = mapW
      let startY = 0
      let endY = mapH

      const camMinX = camera.x - viewWidth / 2
      const camMaxX = camera.x + viewWidth / 2
      const camMinY = camera.y - viewHeight / 2
      const camMaxY = camera.y + viewHeight / 2

      if (enableCulling) {
        startX = Math.max(0, Math.floor(camMinX / TILE_SIZE) - 1)
        endX = Math.min(mapW, Math.ceil(camMaxX / TILE_SIZE) + 1)
        startY = Math.max(0, Math.floor(camMinY / TILE_SIZE) - 1)
        endY = Math.min(mapH, Math.ceil(camMaxY / TILE_SIZE) + 1)
      }

      const staticLayer = getStaticLayer(map)
      if (staticLayer) {
        ctx.drawImage(staticLayer.canvas, 0, 0)
        for (const t of staticLayer.animatedFloorTiles) {
          if (enableCulling && (t.x < startX || t.x >= endX || t.y < startY || t.y >= endY)) continue
          PixelArtRenderer.drawFloor(ctx, t.type, t.x * TILE_SIZE, t.y * TILE_SIZE, TILE_SIZE, t.x, t.y, map.floors)
        }
        if (staticLayer.foregroundCanvas) ctx.drawImage(staticLayer.foregroundCanvas, 0, 0)
        for (const zone of staticLayer.animatedZones) {
          PixelArtRenderer.drawLiraRoom(ctx, zone, map.zones || [])
        }
        for (const item of staticLayer.animatedFurniture) {
          if (
            enableCulling &&
            (item.x + 4 < startX || item.x - 1 > endX || item.y + 4 < startY || item.y - 1 > endY)
          )
            continue
          PixelArtRenderer.drawFurniture(ctx, item)
        }
      } else {
        ctx.fillStyle = '#f6e7d2'
        ctx.fillRect(
          startX * TILE_SIZE,
          startY * TILE_SIZE,
          (endX - startX) * TILE_SIZE + 2,
          (endY - startY) * TILE_SIZE + 2
        )

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const floor = map.floors?.[y]?.[x] || 'wood_parquet'
            PixelArtRenderer.drawFloor(ctx, floor, x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, x, y, map.floors)
          }
        }

        for (const zone of map.zones || []) {
          if (enableCulling) {
            const zx0 = zone.x * TILE_SIZE
            const zx1 = (zone.x + zone.width) * TILE_SIZE
            const zy0 = zone.y * TILE_SIZE
            const zy1 = (zone.y + zone.height) * TILE_SIZE
            if (zx1 < camMinX || zx0 > camMaxX || zy1 < camMinY || zy0 > camMaxY) continue
          }
          PixelArtRenderer.drawLiraRoom(ctx, zone, map.zones || [])
        }

        for (const item of furnitureDrawOrder(map.furniture || [], useCustomAssetsStore.getState().customAssets)) {
          if (
            enableCulling &&
            (item.x + 4 < startX || item.x - 1 > endX || item.y + 4 < startY || item.y - 1 > endY)
          )
            continue
          PixelArtRenderer.drawFurniture(ctx, item)
        }
      }

      if (isEditorOpen) {
        for (const zone of map.zones || []) {
          if (enableCulling) {
            const zx0 = zone.x * TILE_SIZE
            const zx1 = (zone.x + zone.width) * TILE_SIZE
            const zy0 = zone.y * TILE_SIZE
            const zy1 = (zone.y + zone.height) * TILE_SIZE
            if (zx1 < camMinX || zx0 > camMaxX || zy1 < camMinY || zy0 > camMaxY) continue
          }
          const isCurrent = localPlayer.currentZoneId === zone.id
          PixelArtRenderer.drawPrivateZone(ctx, zone, isCurrent)
        }
      }

      if (destination && !isEditorOpen) {
        ctx.save()
        const destX = destination.x * TILE_SIZE + 16
        const destY = destination.y * TILE_SIZE + 16
        const pulse = (Math.sin(currentTime / 160) + 1) / 2
        const ringRadius = 7 + pulse * 5

        ctx.strokeStyle = `rgba(99, 102, 241, ${0.4 + pulse * 0.45})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(destX, destY, ringRadius, 0, Math.PI * 2)
        ctx.stroke()

        ctx.fillStyle = '#6366f1'
        ctx.beginPath()
        ctx.arc(destX, destY, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      if (isEditorOpen && mapStore.selectedPlacedFurnitureId) {
        const selFurn = (map.furniture || []).find((f) => f.id === mapStore.selectedPlacedFurnitureId)
        if (selFurn) {
          const customAsset = useCustomAssetsStore.getState().getAssetById(selFurn.defId)
          const def = customAsset || FURNITURE_CATALOG.find((f) => f.id === selFurn.defId)
          const { targetW: fw, targetH: fh } = resolveFurnitureDimensions(selFurn, customAsset, def)
          const fx = Math.round(selFurn.x * TILE_SIZE)
          const fy = Math.round(selFurn.y * TILE_SIZE)

          ctx.save()
          const pulse = (Math.sin(currentTime / 180) + 1) / 2
          ctx.strokeStyle = `rgba(99, 102, 241, ${0.8 + pulse * 0.2})`
          ctx.lineWidth = 2.5
          ctx.setLineDash([6, 3])
          ctx.strokeRect(fx - 1, fy - 1, fw + 2, fh + 2)

          ctx.setLineDash([])
          ctx.fillStyle = '#ffffff'
          const handleSz = 5
          ctx.fillRect(fx - handleSz / 2, fy - handleSz / 2, handleSz, handleSz)
          ctx.fillRect(fx + fw - handleSz / 2, fy - handleSz / 2, handleSz, handleSz)
          ctx.fillRect(fx - handleSz / 2, fy + fh - handleSz / 2, handleSz, handleSz)
          ctx.fillRect(fx + fw - handleSz / 2, fy + fh - handleSz / 2, handleSz, handleSz)
          ctx.restore()
        }
      }

      type RenderableEntity =
        | { kind: 'player'; y: number; player: Player; isLocal: boolean }
        | { kind: 'pet'; y: number; pet: PetState; petConfig: PetConfig }

      const remoteList = Object.values(remotePlayers).filter(p => !p.isDjBot && !p.id.startsWith('dj-'))
      const allEntities: RenderableEntity[] = [
        { kind: 'player', y: localPlayer.y, player: localPlayer, isLocal: true },
      ]
      for (let i = 0; i < remoteList.length; i++) {
        const p = remoteList[i]
        if (p.id === localPlayer.id || (p.gameId && p.gameId === localPlayer.id)) continue
        if (enableCulling) {
          const ppx = (p.x + 0.5) * TILE_SIZE
          const ppy = (p.y + 0.5) * TILE_SIZE
          if (ppx < camMinX - 64 || ppx > camMaxX + 64 || ppy < camMinY - 64 || ppy > camMaxY + 64)
            continue
        }
        allEntities.push({ kind: 'player', y: p.y, player: p, isLocal: false })
      }

      const petManager = PetManager.getInstance()
      for (let i = -1; i < remoteList.length; i++) {
        const p = i === -1 ? localPlayer : remoteList[i]
        if (i !== -1 && (p.id === localPlayer.id || (p.gameId && p.gameId === localPlayer.id))) continue
        if (p.avatar?.pet && p.avatar.pet.type !== 'none') {
          const pet = petManager.getPet(p.id)
          if (pet) {
            if (enableCulling && i !== -1) {
              const ppx = (pet.x + 0.5) * TILE_SIZE
              const ppy = (pet.y + 0.5) * TILE_SIZE
              if (ppx < camMinX - 64 || ppx > camMaxX + 64 || ppy < camMinY - 64 || ppy > camMaxY + 64)
                continue
            }
            allEntities.push({
              kind: 'pet',
              y: pet.y,
              pet,
              petConfig: p.avatar.pet,
            })
          }
        }
      }

      if (allEntities.length > 1) allEntities.sort((a, b) => a.y - b.y)

      const showNameTags = useSettingsStore.getState().showNameTags ?? true
      const avatarEffects = AvatarEffectsManager.getInstance()

      avatarEffects.renderGround(ctx, currentTime)

      for (const entity of allEntities) {
        if (entity.kind === 'player') {
          renderBedParticipant(ctx, entity.player.id, () => AvatarRenderer.drawPlayer(ctx, entity.player, entity.isLocal, currentTime, TILE_SIZE, showNameTags))
        } else {
          PetRenderer.drawPet(ctx, entity.pet, entity.petConfig, currentTime, showNameTags)
        }
      }

      avatarEffects.renderOverlay(ctx, currentTime)

      for (const r of reactions) {
        const age = currentTime - r.createdAt
        if (age < 3000) {
          const floatY = r.y * TILE_SIZE - (age / 1000) * 20
          ctx.font = '20px serif'
          ctx.fillText(r.emoji, r.x * TILE_SIZE + 6, floatY)
        }
      }

      if (isEditorOpen && activeTool === 'draw_zone' && zoneDragStart && zoneDragCurrent) {
        const minX = Math.min(zoneDragStart.x, zoneDragCurrent.x)
        const maxX = Math.max(zoneDragStart.x, zoneDragCurrent.x)
        const minY = Math.min(zoneDragStart.y, zoneDragCurrent.y)
        const maxY = Math.max(zoneDragStart.y, zoneDragCurrent.y)

        const w = (maxX - minX + 1) * TILE_SIZE
        const h = (maxY - minY + 1) * TILE_SIZE
        const px = minX * TILE_SIZE
        const py = minY * TILE_SIZE

        const isOverlapping = map.zones.some((z) => {
          const zMaxX = z.x + z.width - 1
          const zMaxY = z.y + z.height - 1
          const overlapX = Math.min(maxX, zMaxX) - Math.max(minX, z.x)
          const overlapY = Math.min(maxY, zMaxY) - Math.max(minY, z.y)
          return overlapX >= 1 && overlapY >= 1
        })

        ctx.save()
        ctx.fillStyle = isOverlapping
          ? 'rgba(239, 68, 68, 0.35)'
          : zoneDraft.color
          ? `${zoneDraft.color}35`
          : 'rgba(76, 110, 245, 0.25)'
        ctx.fillRect(px, py, w, h)

        ctx.strokeStyle = isOverlapping ? '#ef4444' : zoneDraft.color || '#4c6ef5'
        ctx.lineWidth = 3
        ctx.setLineDash([8, 4])
        ctx.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3)

        ctx.setLineDash([])
        const badgeText = isOverlapping
          ? `🚫 SOBREPOSIÇÃO NÃO PERMITIDA (${maxX - minX + 1}x${maxY - minY + 1})`
          : `${zoneDraft.name} (${maxX - minX + 1}x${maxY - minY + 1} tiles)`
        ctx.font = 'bold 11px sans-serif'
        const textWidth = ctx.measureText(badgeText).width

        ctx.fillStyle = isOverlapping ? '#dc2626' : zoneDraft.color || '#4c6ef5'
        ctx.beginPath()
        ctx.roundRect(px + 4, py - 20, textWidth + 14, 18, 5)
        ctx.fill()

        ctx.fillStyle = '#ffffff'
        ctx.fillText(badgeText, px + 11, py - 6)
        ctx.restore()
      }
      else if (isEditorOpen && hoverTile) {
        ctx.save()
        const tx = hoverTile.x
        const ty = hoverTile.y

        if (activeTool === 'place_furniture') {
          const placementDir = mapStore.placementDirection || 'down'
          const customAsset = useCustomAssetsStore.getState().getAssetById(mapStore.selectedFurnitureDefId)
          const furnDef = customAsset || FURNITURE_CATALOG.find((f) => f.id === mapStore.selectedFurnitureDefId)
          const { targetW, targetH } = resolveFurnitureDimensions(
            { defId: mapStore.selectedFurnitureDefId, direction: placementDir },
            customAsset,
            furnDef
          )
          const px = Math.round(tx * TILE_SIZE)
          const py = Math.round(ty * TILE_SIZE)

          ctx.fillStyle = furnDef?.iconColor ? `${furnDef.iconColor}33` : 'rgba(76, 110, 245, 0.25)'
          ctx.fillRect(px, py, targetW, targetH)
          ctx.strokeStyle = furnDef?.iconColor || '#4c6ef5'
          ctx.lineWidth = 1.5
          ctx.strokeRect(px + 0.5, py + 0.5, targetW - 1, targetH - 1)

          const rotMap: Record<Direction, 0 | 90 | 180 | 270> = {
            down: 0,
            left: 90,
            up: 180,
            right: 270,
          }
          const dummyFurn: PlacedFurniture = {
            id: '__ghost_preview__',
            defId: mapStore.selectedFurnitureDefId,
            x: tx,
            y: ty,
            direction: placementDir,
            rotation: rotMap[placementDir],
          }

          ctx.save()
          ctx.globalAlpha = 0.65
          FurnitureRenderer.drawFurniture(ctx, dummyFurn)
          ctx.restore()
        } else if (activeTool === 'paint_floor') {
          const selectedFloor = mapStore.selectedFloor
          const customAsset = useCustomAssetsStore.getState().getAssetById(selectedFloor)
          const floorW = Math.max(1, Math.round(customAsset?.width || 1))
          const floorH = Math.max(1, Math.round(customAsset?.height || 1))

          if (floorW > 1 || floorH > 1) {
            const footprintW = floorW * TILE_SIZE
            const footprintH = floorH * TILE_SIZE

            if (customAsset && customAsset.frames && customAsset.frames.length > 0) {
              const img = getCustomAssetImage(customAsset.frames[0])
              if (img && img.complete && img.naturalWidth > 0) {
                ctx.save()
                ctx.globalAlpha = 0.65
                ctx.drawImage(img, tx * TILE_SIZE, ty * TILE_SIZE, footprintW, footprintH)
                ctx.restore()
              }
            }

            ctx.fillStyle = 'rgba(32, 201, 151, 0.2)'
            ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, footprintW, footprintH)
            ctx.strokeStyle = '#20c997'
            ctx.lineWidth = 2
            ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, footprintW - 1, footprintH - 1)

            ctx.strokeStyle = 'rgba(32, 201, 151, 0.45)'
            ctx.lineWidth = 1
            for (let gx = 1; gx < floorW; gx++) {
              ctx.beginPath()
              ctx.moveTo((tx + gx) * TILE_SIZE, ty * TILE_SIZE)
              ctx.lineTo((tx + gx) * TILE_SIZE, (ty + floorH) * TILE_SIZE)
              ctx.stroke()
            }
            for (let gy = 1; gy < floorH; gy++) {
              ctx.beginPath()
              ctx.moveTo(tx * TILE_SIZE, (ty + gy) * TILE_SIZE)
              ctx.lineTo((tx + floorW) * TILE_SIZE, (ty + gy) * TILE_SIZE)
              ctx.stroke()
            }

            ctx.save()
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
            ctx.strokeStyle = '#20c997'
            ctx.lineWidth = 1
            const badgeText = `${floorW}×${floorH}`
            ctx.font = 'bold 10px sans-serif'
            const textWidth = ctx.measureText(badgeText).width
            const badgeW = textWidth + 8
            const badgeH = 16
            const badgeX = tx * TILE_SIZE + 4
            const badgeY = ty * TILE_SIZE + 4
            ctx.fillRect(badgeX, badgeY, badgeW, badgeH)
            ctx.strokeRect(badgeX, badgeY, badgeW, badgeH)
            ctx.fillStyle = '#20c997'
            ctx.textBaseline = 'middle'
            ctx.fillText(badgeText, badgeX + 4, badgeY + badgeH / 2)
            ctx.restore()
          } else {
            const zones = (mapStore as any).mapData?.zones as
              | { id: string; x: number; y: number; width: number; height: number }[]
              | undefined
            let insideZone: { x: number; y: number; width: number; height: number } | null = null
            if (isShiftPressed && zones) {
              let best: { x: number; y: number; width: number; height: number } | null = null
              let bestArea = Number.POSITIVE_INFINITY
              for (const z of zones) {
                if (tx < z.x || tx >= z.x + z.width) continue
                if (ty < z.y || ty >= z.y + z.height) continue
                const area = z.width * z.height
                if (area < bestArea) {
                  best = z
                  bestArea = area
                }
              }
              insideZone = best
            }
            if (insideZone) {
              ctx.fillStyle = 'rgba(32, 201, 151, 0.18)'
              ctx.fillRect(
                insideZone.x * TILE_SIZE,
                insideZone.y * TILE_SIZE,
                insideZone.width * TILE_SIZE,
                insideZone.height * TILE_SIZE
              )
              ctx.strokeStyle = '#20c997'
              ctx.lineWidth = 2
              ctx.strokeRect(
                insideZone.x * TILE_SIZE + 0.5,
                insideZone.y * TILE_SIZE + 0.5,
                insideZone.width * TILE_SIZE - 1,
                insideZone.height * TILE_SIZE - 1
              )
            } else {
              if (customAsset && customAsset.frames && customAsset.frames.length > 0) {
                const img = getCustomAssetImage(customAsset.frames[0])
                if (img && img.complete && img.naturalWidth > 0) {
                  ctx.save()
                  ctx.globalAlpha = 0.65
                  ctx.drawImage(img, tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
                  ctx.restore()
                }
              }
              ctx.fillStyle = 'rgba(32, 201, 151, 0.2)'
              ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
              ctx.strokeStyle = '#20c997'
              ctx.lineWidth = 2
              ctx.strokeRect(
                tx * TILE_SIZE + 0.5,
                ty * TILE_SIZE + 0.5,
                TILE_SIZE - 1,
                TILE_SIZE - 1
              )
            }
          }
        } else if (activeTool === 'paint_wall') {
          ctx.fillStyle = 'rgba(232, 212, 162, 0.4)'
          ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
          ctx.strokeStyle = '#fab005'
          ctx.lineWidth = 2
          ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
        } else if (activeTool === 'eraser') {
          const eraserTarget = (mapStore as any).eraserTarget || 'furniture'

          if (eraserTarget === 'furniture') {
            const customAssets = useCustomAssetsStore.getState().customAssets
            const hoveredFurn = map.furniture?.find((f) => {
              const custom = customAssets.find((a) => a.id === f.defId)
              const def = custom || FURNITURE_CATALOG.find((cat) => cat.id === f.defId)
              const { tileW: w, tileH: h } = resolveFurnitureDimensions(f, custom, def)
              return tx >= f.x - 0.05 && tx < f.x + w + 0.05 && ty >= f.y - 0.05 && ty < f.y + h + 0.05
            })

            if (hoveredFurn) {
              const custom = customAssets.find((a) => a.id === hoveredFurn.defId)
              const def = custom || FURNITURE_CATALOG.find((cat) => cat.id === hoveredFurn.defId)
              const { tileW: w, tileH: h } = resolveFurnitureDimensions(hoveredFurn, custom, def)
              ctx.fillStyle = 'rgba(239, 68, 68, 0.3)'
              ctx.fillRect(hoveredFurn.x * TILE_SIZE, hoveredFurn.y * TILE_SIZE, w * TILE_SIZE, h * TILE_SIZE)
              ctx.strokeStyle = '#ef4444'
              ctx.lineWidth = 2
              ctx.strokeRect(hoveredFurn.x * TILE_SIZE + 0.5, hoveredFurn.y * TILE_SIZE + 0.5, w * TILE_SIZE - 1, h * TILE_SIZE - 1)
            } else {
              ctx.fillStyle = 'rgba(239, 68, 68, 0.2)'
              ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
              ctx.strokeStyle = '#ef4444'
              ctx.lineWidth = 2
              ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
            }
          } else if (eraserTarget === 'zone') {
            const zones = map.zones || []
            let hoveredZone: PrivateZone | null = null
            for (const z of zones) {
              if (tx >= z.x && tx < z.x + z.width && ty >= z.y && ty < z.y + z.height) {
                hoveredZone = z
                break
              }
            }

            if (hoveredZone) {
              ctx.fillStyle = 'rgba(239, 68, 68, 0.22)'
              ctx.fillRect(hoveredZone.x * TILE_SIZE, hoveredZone.y * TILE_SIZE, hoveredZone.width * TILE_SIZE, hoveredZone.height * TILE_SIZE)
              ctx.strokeStyle = '#ef4444'
              ctx.lineWidth = 2
              ctx.strokeRect(hoveredZone.x * TILE_SIZE + 0.5, hoveredZone.y * TILE_SIZE + 0.5, hoveredZone.width * TILE_SIZE - 1, hoveredZone.height * TILE_SIZE - 1)
            } else {
              ctx.fillStyle = 'rgba(239, 68, 68, 0.2)'
              ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
              ctx.strokeStyle = '#ef4444'
              ctx.lineWidth = 2
              ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
            }
          } else {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.22)'
            ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
            ctx.strokeStyle = '#ef4444'
            ctx.lineWidth = 2
            ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
          }
        } else {
          ctx.strokeStyle = '#20c997'
          ctx.lineWidth = 2
          ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, TILE_SIZE - 1, TILE_SIZE - 1)
        }
        ctx.restore()
      }
    } catch (e) {
      console.error('Error in CanvasEngine render:', e)
    } finally {
      ctx.restore()
    }

    if (useSettingsStore.getState().showFpsCounter) {
      ctx.save()
      const fpsText = `${fps} FPS`
      ctx.font = 'bold 12px monospace'
      const textMetrics = ctx.measureText(fpsText)
      const badgeW = textMetrics.width + 18
      const badgeH = 24
      const bx = canvas.width - badgeW - 14
      const by = 14

      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
      ctx.beginPath()
      ctx.roundRect(bx, by, badgeW, badgeH, 6)
      ctx.fill()
      ctx.strokeStyle = fps >= 50 ? '#22c55e' : fps >= 25 ? '#eab308' : '#ef4444'
      ctx.lineWidth = 1.5
      ctx.stroke()

      ctx.fillStyle = fps >= 50 ? '#4ade80' : fps >= 25 ? '#fde047' : '#f87171'
      ctx.fillText(fpsText, bx + 9, by + 16)
      ctx.restore()
    }
  }
}
