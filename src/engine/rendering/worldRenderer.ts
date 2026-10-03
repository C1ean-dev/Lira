import { TILE_SIZE, FURNITURE_CATALOG } from '../Constants'
import { PixelArtRenderer } from '../PixelArtRenderer'
import { AvatarRenderer } from '../AvatarRenderer'
import { PetRenderer } from '../pet/PetRenderer'
import { PetManager, PetState } from '../pet/PetManager'
import { Player, PetConfig, Direction } from '../../types/game'
import { PlacedFurniture, PrivateZone } from '../../types/map'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useCustomAssetsStore, getCustomAssetImage } from '../../store/useCustomAssetsStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { CameraManager } from '../camera/CameraManager'
import { getStaticLayer } from './staticLayerCache'
import { FurnitureRenderer, resolveFurnitureDimensions } from './furnitureRenderer'

export class WorldRenderer {
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

    // Clear background
    ctx.fillStyle = '#0c0e14'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Ensure camera values are sane
    if (isNaN(camera.zoom) || camera.zoom <= 0) camera.zoom = 1.0
    if (isNaN(camera.x)) camera.x = 34 * TILE_SIZE
    if (isNaN(camera.y)) camera.y = 20 * TILE_SIZE

    ctx.save()
    ctx.imageSmoothingEnabled = false

    try {
      // Center camera on player
      const viewWidth = canvas.width / camera.zoom
      const viewHeight = canvas.height / camera.zoom

      ctx.scale(camera.zoom, camera.zoom)
      ctx.imageSmoothingEnabled = false
      ctx.translate(
        viewWidth / 2 - camera.x,
        viewHeight / 2 - camera.y
      )

      // 1. Static world (floors + walls + static furniture) via offscreen cache:
      // 1 drawImage instead of ~800 tiles × save/restore + per-zone gradients.
      const mapH = map.height || 40
      const mapW = map.width || 68
      const enableCulling = useSettingsStore.getState().enableCulling

      let startX = 0
      let endX = mapW
      let startY = 0
      let endY = mapH

      // Visible world bounds in pixels (computed once, reused for all culling).
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
        // Dynamic overdraw only for animated assets (usually empty).
        for (const t of staticLayer.animatedFloorTiles) {
          if (enableCulling && (t.x < startX || t.x >= endX || t.y < startY || t.y >= endY)) continue
          PixelArtRenderer.drawFloor(ctx, t.type, t.x * TILE_SIZE, t.y * TILE_SIZE, TILE_SIZE, t.x, t.y, map.floors)
        }
        for (const zone of staticLayer.animatedZones) {
          PixelArtRenderer.drawLiraRoom(ctx, zone, map.zones || [])
        }
        for (const item of staticLayer.animatedFurniture) {
          // Cheap tile-margin cull without def lookup (max furniture ~4 tiles).
          if (
            enableCulling &&
            (item.x + 4 < startX || item.x - 1 > endX || item.y + 4 < startY || item.y - 1 > endY)
          )
            continue
          PixelArtRenderer.drawFurniture(ctx, item)
        }
      } else {
        // Fallback (huge maps / no DOM): culled direct render.
        // Base solid underlay to guarantee zero subpixel background bleed across entire visible area
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

        // 2. Draw Lira Room Architecture (culled per zone)
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

        // 4. Draw Placed Furniture (culled)
        for (const item of map.furniture || []) {
          if (
            enableCulling &&
            (item.x + 4 < startX || item.x - 1 > endX || item.y + 4 < startY || item.y - 1 > endY)
          )
            continue
          PixelArtRenderer.drawFurniture(ctx, item)
        }
      }

      // 3. Draw Zone Header Badges & Dashed Overlays (Only in Editor Mode, culled)
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

      // 4b. Draw Click-to-Move Path Destination Indicator
      if (destination && !isEditorOpen) {
        ctx.save()
        const destX = destination.x * TILE_SIZE + 16
        const destY = destination.y * TILE_SIZE + 16
        const pulse = (Math.sin(currentTime / 160) + 1) / 2
        const ringRadius = 7 + pulse * 5

        // Outer glowing pulse ring
        ctx.strokeStyle = `rgba(99, 102, 241, ${0.4 + pulse * 0.45})`
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(destX, destY, ringRadius, 0, Math.PI * 2)
        ctx.stroke()

        // Inner solid core
        ctx.fillStyle = '#6366f1'
        ctx.beginPath()
        ctx.arc(destX, destY, 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }

      // 4c. Draw Selected Furniture Highlight (in Editor Mode)
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

          // Corner handles
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

      // 5. Sort and Draw Players & Companion Pets by Y-depth (culled, single pass)
      type RenderableEntity =
        | { kind: 'player'; y: number; player: Player; isLocal: boolean }
        | { kind: 'pet'; y: number; pet: PetState; petConfig: PetConfig }

      const remoteList = Object.values(remotePlayers)
      const allEntities: RenderableEntity[] = [
        { kind: 'player', y: localPlayer.y, player: localPlayer, isLocal: true },
      ]
      for (let i = 0; i < remoteList.length; i++) {
        const p = remoteList[i]
        // Never draw ourselves as a remote: a stale/self echo entry renders
        // as a frozen clone of the local avatar stuck at an old position.
        if (p.id === localPlayer.id || (p.gameId && p.gameId === localPlayer.id)) continue
        // Cull off-screen players early (64px margin for avatar + nametag).
        if (enableCulling) {
          const ppx = (p.x + 0.5) * TILE_SIZE
          const ppy = (p.y + 0.5) * TILE_SIZE
          if (ppx < camMinX - 64 || ppx > camMaxX + 64 || ppy < camMinY - 64 || ppy > camMaxY + 64)
            continue
        }
        allEntities.push({ kind: 'player', y: p.y, player: p, isLocal: false })
      }

      const petManager = PetManager.getInstance()
      // Reuse remoteList to avoid a second Object.values allocation.
      for (let i = -1; i < remoteList.length; i++) {
        const p = i === -1 ? localPlayer : remoteList[i]
        // Skip pets of filtered self-echo entries (same ghost reason as above).
        if (i !== -1 && (p.id === localPlayer.id || (p.gameId && p.gameId === localPlayer.id))) continue
        // Local player already passed culling implicitly (camera follows them);
        // still cull remote pets.
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

      for (const entity of allEntities) {
        if (entity.kind === 'player') {
          AvatarRenderer.drawPlayer(ctx, entity.player, entity.isLocal, currentTime, TILE_SIZE, showNameTags)
        } else {
          PetRenderer.drawPet(ctx, entity.pet, entity.petConfig, currentTime, showNameTags)
        }
      }

      // 6. Draw Floating Reactions
      for (const r of reactions) {
        const age = currentTime - r.createdAt
        if (age < 3000) {
          const floatY = r.y * TILE_SIZE - (age / 1000) * 20
          ctx.font = '20px serif'
          ctx.fillText(r.emoji, r.x * TILE_SIZE + 6, floatY)
        }
      }

      // 7. Draw Live Drag-to-Draw Zone Preview
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
        // Fill
        ctx.fillStyle = isOverlapping
          ? 'rgba(239, 68, 68, 0.35)'
          : zoneDraft.color
          ? `${zoneDraft.color}35`
          : 'rgba(76, 110, 245, 0.25)'
        ctx.fillRect(px, py, w, h)

        // Dashed border
        ctx.strokeStyle = isOverlapping ? '#ef4444' : zoneDraft.color || '#4c6ef5'
        ctx.lineWidth = 3
        ctx.setLineDash([8, 4])
        ctx.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3)

        // Dimension badge
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
      // Draw Editor Hover Tile Preview with Asset Dimensions
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

          // Semi-transparent ghost furniture preview
          ctx.fillStyle = furnDef?.iconColor ? `${furnDef.iconColor}33` : 'rgba(76, 110, 245, 0.25)'
          ctx.fillRect(px, py, targetW, targetH)
          ctx.strokeStyle = furnDef?.iconColor || '#4c6ef5'
          ctx.lineWidth = 1.5
          ctx.strokeRect(px + 0.5, py + 0.5, targetW - 1, targetH - 1)

          // Draw the ghost sprite preview reflecting selected direction and rotation
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
            // Multi-tile floor preview (e.g. 2x1, 4x4)
            const footprintW = floorW * TILE_SIZE
            const footprintH = floorH * TILE_SIZE

            // Ghost image of floor
            if (customAsset && customAsset.frames && customAsset.frames.length > 0) {
              const img = getCustomAssetImage(customAsset.frames[0])
              if (img && img.complete && img.naturalWidth > 0) {
                ctx.save()
                ctx.globalAlpha = 0.65
                ctx.drawImage(img, tx * TILE_SIZE, ty * TILE_SIZE, footprintW, footprintH)
                ctx.restore()
              }
            }

            // Outer footprint bounding box
            ctx.fillStyle = 'rgba(32, 201, 151, 0.2)'
            ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, footprintW, footprintH)
            ctx.strokeStyle = '#20c997'
            ctx.lineWidth = 2
            ctx.strokeRect(tx * TILE_SIZE + 0.5, ty * TILE_SIZE + 0.5, footprintW - 1, footprintH - 1)

            // Inner grid dividers
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

            // Size badge tag
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
            // 1x1 floor: if Shift is held over a zone, show zone outline for full-room fill; otherwise show 1x1 placement tile
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
              // 1x1 tile placement (inside or outside zone)
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
            // 'floor' or 'wall'
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

    // 8. On-Screen FPS Counter HUD Overlay
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
