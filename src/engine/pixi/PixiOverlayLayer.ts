import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { STATUS_META, type Direction, type Player } from '../../types/game'
import type { PlacedFurniture, PrivateZone } from '../../types/map'
import { FURNITURE_CATALOG, TILE_SIZE } from '../Constants'
import { getStatusIconImage } from '../avatar/statusIcons'
import { formatHouseOccupantsInline } from '../houseInterior'
import { isPlayerInCorridor, PROXIMITY_EXIT_RADIUS } from '../proximityCall'
import { PetManager } from '../pet/PetManager'
import { resolveFurnitureDimensions, resolveFurnitureFrames } from '../rendering/furnitureRenderer'
import { resolveSpritePlacement } from '../rendering/spritePlacement'
import { drawDashedRect, parseHexColor, PixiTextureCache } from './PixiTextureCache'

export interface OverlayRenderState {
  hoverTile: { x: number; y: number } | null
  zoneDragStart: { x: number; y: number } | null
  zoneDragCurrent: { x: number; y: number } | null
  fps: number
  destination?: { x: number; y: number } | null
  isShiftPressed?: boolean
}

interface NameTagNode {
  container: Container
  pillGfx: Graphics
  iconSprite: Sprite
  labelText: Text
  zzzTexts: Text[]
  lastLabel: string
}

interface PillBadgeNode {
  container: Container
  gfx: Graphics
  text: Text
}

interface HouseOccupantListNode {
  container: Container
  gfx: Graphics
  text: Text
  lastLabel: string
}

const ROT_MAP: Record<Direction, 0 | 90 | 180 | 270> = { down: 0, left: 90, up: 180, right: 270 }

/**
 * Pure PixiJS v8 unlit UI overlay layer (rendered ABOVE 2D lighting):
 * - Editor private zones & uppercase labels
 * - Click destination pulse, selected furniture outline, editor hover / ghost sprite
 * - Player & Pet name tags, closed house zone pills, floating emoji reactions, FPS badge
 */
export class PixiOverlayLayer {
  public readonly worldOverlay = new Container()
  public readonly hudLayer = new Container()

  private readonly zonesLayer = new Container()
  private readonly zonesGfx = new Graphics()
  private readonly gizmosGfx = new Graphics()
  private readonly ghostSprite = new Sprite(Texture.EMPTY)
  private readonly nameTagsLayer = new Container()
  private readonly closedBadgesLayer = new Container()
  private readonly reactionsLayer = new Container()
  private readonly fpsGfx = new Graphics()
  private readonly fpsText = new Text({
    text: '60 FPS',
    style: { fontFamily: 'monospace', fontWeight: 'bold', fontSize: 12, fill: 0x4ade80 },
    resolution: 2,
  })

  private readonly zoneLabels = new Map<string, Text>()
  private readonly nameTagNodes = new Map<string, NameTagNode>()
  private readonly closedBadgeNodes = new Map<string, PillBadgeNode>()
  private readonly houseOccupantNodes = new Map<string, HouseOccupantListNode>()
  private readonly reactionTexts = new Map<string, Text>()
  private readonly draftBadgeGfx = new Graphics()
  private readonly draftBadgeText = new Text({
    text: '',
    style: { fontFamily: 'sans-serif', fontWeight: 'bold', fontSize: 11, fill: 0xffffff },
    resolution: 2,
  })

  constructor(private readonly textures: PixiTextureCache) {
    this.ghostSprite.visible = false
    this.draftBadgeText.visible = false
    this.zonesLayer.addChild(this.zonesGfx)
    this.worldOverlay.addChild(
      this.zonesLayer,
      this.ghostSprite,
      this.gizmosGfx,
      this.draftBadgeGfx,
      this.draftBadgeText,
      this.nameTagsLayer,
      this.closedBadgesLayer,
      this.reactionsLayer
    )
    this.hudLayer.addChild(this.fpsGfx, this.fpsText)
  }

  public update(
    screenW: number,
    screenH: number,
    zoom: number,
    worldOffsetX: number,
    worldOffsetY: number,
    viewBounds: { camMinX: number; camMaxX: number; camMinY: number; camMaxY: number; enableCulling: boolean },
    state: OverlayRenderState,
    nowMs: number
  ): void {
    this.worldOverlay.scale.set(zoom)
    this.worldOverlay.position.set(worldOffsetX, worldOffsetY)

    const mapStore = useMapStore.getState()
    const rootMap = mapStore.mapData
    const map = mapStore.getActiveMapData()
    const activeHouseId = mapStore.activeHouseId
    const isEditorOpen = mapStore.isEditorOpen
    const activeTool = mapStore.activeTool
    const zoneDraft = mapStore.zoneDraft
    const { localPlayer, remotePlayers, reactions, callStates, proximityPeerIds } = useGameStore.getState()
    const settings = useSettingsStore.getState()
    const showNameTags = settings.showNameTags ?? true
    const customAssets = useCustomAssetsStore.getState().customAssets
    const customById = new Map(customAssets.map((a) => [a.id, a]))
    const localHouseId = localPlayer.currentHouseId ?? null

    const placedHouses = !activeHouseId
      ? (rootMap.furniture || [])
          .map((furn) => ({ furn, asset: customById.get(furn.defId) }))
          .filter((entry): entry is { furn: PlacedFurniture; asset: NonNullable<typeof entry.asset> } =>
            Boolean(entry.asset?.houseShell)
          )
      : []

    // 1. Editor Private Zones
    this.zonesGfx.clear()
    const seenZones = new Set<string>()
    if (isEditorOpen) {
      for (const zone of map.zones || []) {
        const px = Math.floor(zone.x * TILE_SIZE)
        const py = Math.floor(zone.y * TILE_SIZE)
        const w = zone.width * TILE_SIZE
        const h = zone.height * TILE_SIZE
        if (viewBounds.enableCulling) {
          if (px + w < viewBounds.camMinX || px > viewBounds.camMaxX || py + h < viewBounds.camMinY || py > viewBounds.camMaxY) {
            continue
          }
        }
        seenZones.add(zone.id)
        const isCurr = localPlayer.currentZoneId === zone.id
        const zCol = parseHexColor(zone.color, 0x4c6ef5)
        this.zonesGfx.rect(px, py, w, h).fill({ color: zCol, alpha: isCurr ? 0.16 : 0.065 })
        drawDashedRect(this.zonesGfx, px + 1, py + 1, w - 2, h - 2, zCol, 1, isCurr ? 2.5 : 1.5, 6, 4)

        let labelNode = this.zoneLabels.get(zone.id)
        const label = zone.name.toUpperCase()
        if (!labelNode) {
          labelNode = new Text({
            text: label,
            style: { fontFamily: 'sans-serif', fontWeight: 'bold', fontSize: 9, fill: 0xffffff },
            resolution: 2,
          })
          this.zoneLabels.set(zone.id, labelNode)
          this.zonesLayer.addChild(labelNode)
        } else if (labelNode.text !== label) {
          labelNode.text = label
        }
        labelNode.visible = true
        labelNode.position.set(px + 10, py + 7)
        this.zonesGfx.roundRect(px + 4, py + 4, labelNode.width + 12, 16, 4).fill(zCol)
      }
    }
    for (const [id, lbl] of this.zoneLabels) {
      if (!seenZones.has(id)) lbl.visible = false
    }

    // 2. Gizmos: destination, selected furniture, hover/ghost preview, zone draft
    this.gizmosGfx.clear()
    this.ghostSprite.visible = false
    this.draftBadgeGfx.clear()
    this.draftBadgeText.visible = false

    if (state.destination && !isEditorOpen) {
      const destX = state.destination.x * TILE_SIZE + 16
      const destY = state.destination.y * TILE_SIZE + 16
      const pulse = (Math.sin(nowMs / 160) + 1) / 2
      this.gizmosGfx
        .circle(destX, destY, 7 + pulse * 5)
        .stroke({ width: 2, color: 0x6366f1, alpha: 0.4 + pulse * 0.45 })
      this.gizmosGfx.circle(destX, destY, 3).fill(0x6366f1)
    }

    // Proximity voice ring & peer link lines in Corredor Geral
    if (!isEditorOpen && !activeHouseId && isPlayerInCorridor(localPlayer) && proximityPeerIds.length > 0) {
      const lx = (localPlayer.x + 0.5) * TILE_SIZE
      const ly = (localPlayer.y + 0.5) * TILE_SIZE
      const pulse = (Math.sin(nowMs / 320) + 1) / 2
      this.gizmosGfx
        .circle(lx, ly, PROXIMITY_EXIT_RADIUS * TILE_SIZE)
        .fill({ color: 0x34d399, alpha: 0.045 })
        .stroke({ width: 1.5, color: 0x34d399, alpha: 0.25 + pulse * 0.12 })
      for (const peerId of proximityPeerIds) {
        const peer = remotePlayers[peerId]
        if (!peer) continue
        this.gizmosGfx
          .moveTo(lx, ly)
          .lineTo((peer.x + 0.5) * TILE_SIZE, (peer.y + 0.5) * TILE_SIZE)
          .stroke({ width: 1.5, color: 0x34d399, alpha: 0.28 })
      }
    }

    // Interior exit threshold mat when inside a house
    if (activeHouseId) {
      const portalPulse = 0.25 + ((Math.sin(nowMs / 350) + 1) / 2) * 0.28
      const activeInterior = mapStore.getActiveHouseInterior()
      if (activeInterior) {
        const ex = activeInterior.exitDoor.x * TILE_SIZE + 2
        const ey = activeInterior.exitDoor.y * TILE_SIZE + 4
        const ew = activeInterior.exitDoor.width * TILE_SIZE - 4
        const eh = TILE_SIZE - 6
        const accent = parseHexColor(activeInterior.accentColor, 0xf59e0b)
        this.gizmosGfx
          .roundRect(ex, ey, ew, eh, 5)
          .fill({ color: accent, alpha: portalPulse * 0.65 })
          .stroke({ width: 1.5, color: accent, alpha: 0.9 })
      }
    }

    if (isEditorOpen && mapStore.selectedPlacedFurnitureId) {
      const selFurn = (map.furniture || []).find((f) => f.id === mapStore.selectedPlacedFurnitureId)
      if (selFurn) {
        const customAsset = customById.get(selFurn.defId)
        const def = customAsset || FURNITURE_CATALOG.find((f) => f.id === selFurn.defId)
        const { targetW: fw, targetH: fh } = resolveFurnitureDimensions(selFurn, customAsset, def)
        const fx = Math.round(selFurn.x * TILE_SIZE)
        const fy = Math.round(selFurn.y * TILE_SIZE)
        const pulse = (Math.sin(nowMs / 180) + 1) / 2
        drawDashedRect(this.gizmosGfx, fx - 1, fy - 1, fw + 2, fh + 2, 0x6366f1, 0.8 + pulse * 0.2, 2.5, 6, 3)
        const hs = 5
        this.gizmosGfx.rect(fx - hs / 2, fy - hs / 2, hs, hs).fill(0xffffff)
        this.gizmosGfx.rect(fx + fw - hs / 2, fy - hs / 2, hs, hs).fill(0xffffff)
        this.gizmosGfx.rect(fx - hs / 2, fy + fh - hs / 2, hs, hs).fill(0xffffff)
        this.gizmosGfx.rect(fx + fw - hs / 2, fy + fh - hs / 2, hs, hs).fill(0xffffff)
      }
    }

    if (isEditorOpen && activeTool === 'draw_zone' && state.zoneDragStart && state.zoneDragCurrent) {
      this.drawZoneDraft(map.zones || [], state.zoneDragStart, state.zoneDragCurrent, zoneDraft)
    } else if (isEditorOpen && state.hoverTile) {
      this.drawHoverOverlay(mapStore, customById, state.hoverTile, state.isShiftPressed)
    }

    // 3. Name Tags (players + pets in the same subspace)
    const seenTags = new Set<string>()
    const remoteList = Object.values(remotePlayers).filter((p) => !p.isDjBot && !p.id.startsWith('dj-'))
    const isInSameSubspace = (p: Player) => (p.currentHouseId ?? null) === localHouseId
    if (showNameTags) {
      const playersToShow: { player: Player; isLocal: boolean }[] = [{ player: localPlayer, isLocal: true }]
      for (const p of remoteList) {
        if (p.id === localPlayer.id || (p.gameId && p.gameId === localPlayer.id)) continue
        if (!isInSameSubspace(p)) continue
        playersToShow.push({ player: p, isLocal: false })
      }
      for (const entry of playersToShow) {
        const key = `p:${entry.player.id}`
        seenTags.add(key)
        this.syncPlayerNameTag(key, entry.player, entry.isLocal, callStates, nowMs)
      }

      const petManager = PetManager.getInstance()
      for (let i = -1; i < remoteList.length; i++) {
        const owner = i === -1 ? localPlayer : remoteList[i]
        if (i !== -1 && (owner.id === localPlayer.id || (owner.gameId && owner.gameId === localPlayer.id))) continue
        if (i !== -1 && !isInSameSubspace(owner)) continue
        if (owner.avatar?.pet && owner.avatar.pet.type !== 'none') {
          const pet = petManager.getPet(owner.id)
          if (pet) {
            const key = `pet:${owner.id}`
            seenTags.add(key)
            this.syncPetNameTag(key, pet.x * TILE_SIZE, pet.y * TILE_SIZE, owner.avatar.pet.name)
          }
        }
      }
    }
    for (const [key, node] of this.nameTagNodes) {
      if (!seenTags.has(key)) {
        node.container.visible = false
      }
    }

    // 4. House Badges, Exterior Occupant Lists & Interior Exit Badge
    const allPlayers = [localPlayer, ...remoteList]
    const seenBadges = new Set<string>()
    const seenOccupantLists = new Set<string>()
    if (!activeHouseId) {
      for (const { furn, asset } of placedHouses) {
        const interior = rootMap.houseInteriors?.[furn.id]
        const houseName = furn.houseName || interior?.name || asset.name || 'Casa'
        const badgeKey = `house:${furn.id}`
        seenBadges.add(badgeKey)
        const occupants = allPlayers.filter((p) => p.currentHouseId === furn.id)
        const count = occupants.length
        const tag = count > 0 ? `🏠 ${houseName} (${count})` : `🏠 ${houseName}`
        const cx = (furn.x + asset.width * 0.5) * TILE_SIZE
        const ty = furn.y * TILE_SIZE - 10
        const accentHex = interior?.accentColor || furn.tintColor || asset.houseShell?.defaultZoneColor
        let badge = this.closedBadgeNodes.get(badgeKey)
        if (!badge) {
          const c = new Container()
          const g = new Graphics()
          const t = new Text({
            text: tag,
            style: { fontFamily: 'Inter, sans-serif', fontWeight: 'bold', fontSize: 9, fill: 0xf8fafc },
            resolution: 3,
          })
          t.anchor.set(0.5, 0.5)
          c.addChild(g, t)
          badge = { container: c, gfx: g, text: t }
          this.closedBadgeNodes.set(badgeKey, badge)
          this.closedBadgesLayer.addChild(c)
        }
        if (badge.text.text !== tag) badge.text.text = tag
        badge.container.visible = true
        badge.container.position.set(cx, occupants.length > 0 ? ty - 22.5 : ty - 6.5)
        const tw = badge.text.width + 14
        badge.gfx.clear()
        badge.gfx
          .roundRect(-tw / 2, -7.5, tw, 15, 7)
          .fill({ color: 0x0f172a, alpha: 0.86 })
          .stroke({ width: 1, color: parseHexColor(accentHex, 0xf59e0b) })

        if (occupants.length > 0) {
          seenOccupantLists.add(furn.id)
          const label = formatHouseOccupantsInline(occupants)
          let occPill = this.houseOccupantNodes.get(furn.id)
          if (!occPill) {
            const container = new Container()
            const gfx = new Graphics()
            const text = new Text({
              text: label,
              style: { fontFamily: 'Inter, sans-serif', fontWeight: '600', fontSize: 8, fill: 0xe2e8f0 },
              resolution: 3,
            })
            text.anchor.set(0.5, 0.5)
            container.addChild(gfx, text)
            occPill = { container, gfx, text, lastLabel: '' }
            this.houseOccupantNodes.set(furn.id, occPill)
            this.closedBadgesLayer.addChild(container)
          }

          if (occPill.lastLabel !== label) {
            occPill.lastLabel = label
            occPill.text.text = label
            const pw = occPill.text.width + 12
            occPill.gfx.clear()
            occPill.gfx
              .roundRect(-pw / 2, -6.5, pw, 13, 6)
              .fill({ color: 0x0f172a, alpha: 0.86 })
              .stroke({ width: 1, color: 0x334155 })
          }

          occPill.container.visible = true
          occPill.container.position.set(cx, ty - 6.5)
        }
      }
    } else {
      const activeInterior = mapStore.getActiveHouseInterior()
      if (activeInterior) {
        const badgeKey = `exit:${activeInterior.houseId}`
        seenBadges.add(badgeKey)
        const tag = '🚪 Saída'
        const cx = (activeInterior.exitDoor.x + activeInterior.exitDoor.width * 0.5) * TILE_SIZE
        const ty = activeInterior.exitDoor.y * TILE_SIZE - 8
        let badge = this.closedBadgeNodes.get(badgeKey)
        if (!badge) {
          const c = new Container()
          const g = new Graphics()
          const t = new Text({
            text: tag,
            style: { fontFamily: 'Inter, sans-serif', fontWeight: 'bold', fontSize: 9, fill: 0xfef3c7 },
            resolution: 3,
          })
          t.anchor.set(0.5, 0.5)
          c.addChild(g, t)
          badge = { container: c, gfx: g, text: t }
          this.closedBadgeNodes.set(badgeKey, badge)
          this.closedBadgesLayer.addChild(c)
        }
        if (badge.text.text !== tag) badge.text.text = tag
        badge.container.visible = true
        badge.container.position.set(cx, ty - 6.5)
        const tw = badge.text.width + 14
        badge.gfx.clear()
        badge.gfx
          .roundRect(-tw / 2, -7.5, tw, 15, 7)
          .fill({ color: 0x1c1917, alpha: 0.9 })
          .stroke({ width: 1, color: parseHexColor(activeInterior.accentColor, 0xf59e0b) })
      }
    }
    for (const [id, badge] of this.closedBadgeNodes) {
      if (!seenBadges.has(id)) badge.container.visible = false
    }
    for (const [id, card] of this.houseOccupantNodes) {
      if (!seenOccupantLists.has(id)) card.container.visible = false
    }

    // 5. Emoji Reactions (filtered by current subspace)
    const playerById = new Map<string, Player>()
    playerById.set(localPlayer.id, localPlayer)
    for (const p of remoteList) {
      playerById.set(p.id, p)
      if (p.gameId) playerById.set(p.gameId, p)
    }
    const seenReactions = new Set<string>()
    for (const r of reactions) {
      const reactor = playerById.get(r.playerId)
      if (reactor && (reactor.currentHouseId ?? null) !== localHouseId) continue
      const age = nowMs - r.createdAt
      if (age < 3000) {
        const key = `${r.id}:${r.createdAt}`
        seenReactions.add(key)
        let rt = this.reactionTexts.get(key)
        if (!rt) {
          rt = new Text({
            text: r.emoji,
            style: { fontFamily: 'serif', fontSize: 20 },
            resolution: 2,
          })
          this.reactionTexts.set(key, rt)
          this.reactionsLayer.addChild(rt)
        }
        rt.visible = true
        rt.position.set(r.x * TILE_SIZE + 6, r.y * TILE_SIZE - (age / 1000) * 20)
      }
    }
    for (const [key, rt] of this.reactionTexts) {
      if (!seenReactions.has(key)) {
        this.reactionsLayer.removeChild(rt)
        rt.destroy()
        this.reactionTexts.delete(key)
      }
    }

    // 6. FPS Badge (HUD screen-space)
    if (settings.showFpsCounter && screenW > 0 && screenH > 0) {
      this.fpsGfx.visible = true
      this.fpsText.visible = true
      const fpsStr = `${state.fps} FPS`
      if (this.fpsText.text !== fpsStr) this.fpsText.text = fpsStr
      const color = state.fps >= 50 ? 0x4ade80 : state.fps >= 25 ? 0xfde047 : 0xf87171
      const border = state.fps >= 50 ? 0x22c55e : state.fps >= 25 ? 0xeab308 : 0xef4444
      this.fpsText.style.fill = color
      const badgeW = this.fpsText.width + 18
      const badgeH = 24
      const bx = screenW - badgeW - 14
      const by = 14
      this.fpsGfx.clear()
      this.fpsGfx
        .roundRect(bx, by, badgeW, badgeH, 6)
        .fill({ color: 0x0f172a, alpha: 0.88 })
        .stroke({ width: 1.5, color: border })
      this.fpsText.position.set(bx + 9, by + 5)
    } else {
      this.fpsGfx.visible = false
      this.fpsText.visible = false
    }
  }

  private drawZoneDraft(
    zones: PrivateZone[],
    start: { x: number; y: number },
    curr: { x: number; y: number },
    zoneDraft: { name: string; color: string }
  ): void {
    const minX = Math.min(start.x, curr.x)
    const maxX = Math.max(start.x, curr.x)
    const minY = Math.min(start.y, curr.y)
    const maxY = Math.max(start.y, curr.y)
    const w = (maxX - minX + 1) * TILE_SIZE
    const h = (maxY - minY + 1) * TILE_SIZE
    const px = minX * TILE_SIZE
    const py = minY * TILE_SIZE

    const overlapping = zones.some((z) => {
      const ox = Math.min(maxX, z.x + z.width - 1) - Math.max(minX, z.x)
      const oy = Math.min(maxY, z.y + z.height - 1) - Math.max(minY, z.y)
      return ox >= 1 && oy >= 1
    })

    const col = overlapping ? 0xef4444 : parseHexColor(zoneDraft.color, 0x4c6ef5)
    this.gizmosGfx.rect(px, py, w, h).fill({ color: col, alpha: overlapping ? 0.35 : 0.2 })
    drawDashedRect(this.gizmosGfx, px + 1.5, py + 1.5, w - 3, h - 3, col, 1, 3, 8, 4)

    const label = overlapping
      ? `SOBREPOSIÇÃO NÃO PERMITIDA (${maxX - minX + 1}x${maxY - minY + 1})`
      : `${zoneDraft.name} (${maxX - minX + 1}x${maxY - minY + 1} tiles)`
    this.draftBadgeText.text = label
    this.draftBadgeText.visible = true
    this.draftBadgeText.position.set(px + 11, py - 18)
    this.draftBadgeGfx
      .roundRect(px + 4, py - 20, this.draftBadgeText.width + 14, 18, 5)
      .fill(overlapping ? 0xdc2626 : col)
  }

  private drawHoverOverlay(
    mapStore: ReturnType<typeof useMapStore.getState>,
    customById: Map<string, ReturnType<typeof useCustomAssetsStore.getState>['customAssets'][number]>,
    hoverTile: { x: number; y: number },
    isShiftPressed?: boolean
  ): void {
    const activeTool = mapStore.activeTool
    const map = mapStore.getActiveMapData()
    const tx = hoverTile.x
    const ty = hoverTile.y

    if (activeTool === 'place_furniture') {
      const dir = mapStore.placementDirection || 'down'
      const customAsset = customById.get(mapStore.selectedFurnitureDefId)
      const furnDef = customAsset || FURNITURE_CATALOG.find((f) => f.id === mapStore.selectedFurnitureDefId)
      const { targetW, targetH } = resolveFurnitureDimensions(
        { defId: mapStore.selectedFurnitureDefId, direction: dir },
        customAsset,
        furnDef
      )
      const px = Math.round(tx * TILE_SIZE)
      const py = Math.round(ty * TILE_SIZE)
      const col = parseHexColor(furnDef?.iconColor, 0x4c6ef5)
      if (!customAsset?.houseShell) {
        this.gizmosGfx
          .rect(px, py, targetW, targetH)
          .fill({ color: col, alpha: 0.2 })
          .stroke({ width: 1.5, color: col })
      }

      if (customAsset) {
        const dummy: PlacedFurniture = {
          id: '__ghost__',
          defId: mapStore.selectedFurnitureDefId,
          x: tx,
          y: ty,
          direction: dir,
          rotation: ROT_MAP[dir],
        }
        const { frames, mirrorH } = resolveFurnitureFrames(dummy, customAsset)
        const tex = this.textures.getUrlTexture(frames[0])
        if (tex) {
          this.ghostSprite.texture = tex
          this.ghostSprite.visible = true
          this.ghostSprite.alpha = 0.65
          const aspectH = targetW * (tex.height / Math.max(1, tex.width))
          const useHouseBottomAnchor =
            Boolean(customAsset.houseShell) &&
            ((customAsset.houseShell?.overhangPx ?? 0) > 0 || aspectH > targetH + 1)
          const { offsetX, offsetY, drawWidth, drawHeight } = useHouseBottomAnchor
            ? {
                offsetX: 0,
                offsetY: targetH - aspectH,
                drawWidth: targetW,
                drawHeight: aspectH,
              }
            : resolveSpritePlacement(tex.width, tex.height, targetW, targetH)
          const sx = drawWidth / Math.max(1, tex.width)
          const sy = drawHeight / Math.max(1, tex.height)
          if (mirrorH) {
            this.ghostSprite.scale.set(-sx, sy)
            this.ghostSprite.position.set(px + targetW - offsetX, py + offsetY)
          } else {
            this.ghostSprite.scale.set(sx, sy)
            this.ghostSprite.position.set(px + offsetX, py + offsetY)
          }
        }
      }
      return
    }

    if (activeTool === 'paint_floor') {
      const customAsset = customById.get(mapStore.selectedFloor)
      const fw = Math.max(1, Math.round(customAsset?.width || 1))
      const fh = Math.max(1, Math.round(customAsset?.height || 1))
      if (fw > 1 || fh > 1) {
        const pw = fw * TILE_SIZE
        const ph = fh * TILE_SIZE
        const tex = customAsset?.frames?.[0] ? this.textures.getUrlTexture(customAsset.frames[0]) : null
        if (tex) {
          this.ghostSprite.texture = tex
          this.ghostSprite.visible = true
          this.ghostSprite.alpha = 0.65
          this.ghostSprite.position.set(tx * TILE_SIZE, ty * TILE_SIZE)
          this.ghostSprite.width = pw
          this.ghostSprite.height = ph
        }
        this.gizmosGfx
          .rect(tx * TILE_SIZE, ty * TILE_SIZE, pw, ph)
          .fill({ color: 0x20c997, alpha: 0.2 })
          .stroke({ width: 2, color: 0x20c997 })
        return
      }
      if (isShiftPressed && map.zones) {
        let best: PrivateZone | null = null
        let bestArea = Infinity
        for (const z of map.zones) {
          if (tx >= z.x && tx < z.x + z.width && ty >= z.y && ty < z.y + z.height && z.width * z.height < bestArea) {
            best = z
            bestArea = z.width * z.height
          }
        }
        if (best) {
          this.gizmosGfx
            .rect(best.x * TILE_SIZE, best.y * TILE_SIZE, best.width * TILE_SIZE, best.height * TILE_SIZE)
            .fill({ color: 0x20c997, alpha: 0.18 })
            .stroke({ width: 2, color: 0x20c997 })
          return
        }
      }
      this.gizmosGfx
        .rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        .fill({ color: 0x20c997, alpha: 0.2 })
        .stroke({ width: 2, color: 0x20c997 })
      return
    }

    if (activeTool === 'paint_wall') {
      this.gizmosGfx
        .rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        .fill({ color: 0xe8d4a2, alpha: 0.4 })
        .stroke({ width: 2, color: 0xfab005 })
      return
    }

    if (activeTool === 'eraser') {
      this.gizmosGfx
        .rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE)
        .fill({ color: 0xef4444, alpha: 0.22 })
        .stroke({ width: 2, color: 0xef4444 })
      return
    }

    this.gizmosGfx.rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE).stroke({ width: 2, color: 0x20c997 })
  }

  private getOrCreateNameTag(key: string): NameTagNode {
    let node = this.nameTagNodes.get(key)
    if (!node) {
      const container = new Container()
      const pillGfx = new Graphics()
      const iconSprite = new Sprite(Texture.EMPTY)
      const labelText = new Text({
        text: '',
        style: { fontFamily: 'Inter, sans-serif', fontWeight: 'bold', fontSize: 7.5, fill: 0xffffff },
        resolution: 3,
      })
      const zzzTexts = ['z', 'Z', 'z'].map((ch, idx) => {
        const zt = new Text({
          text: ch,
          style: { fontFamily: 'Inter, sans-serif', fontWeight: 'bold', fontSize: 6 + idx * 1.5, fill: 0xc7d2fe },
          resolution: 3,
        })
        zt.visible = false
        return zt
      })
      container.addChild(pillGfx, iconSprite, labelText, ...zzzTexts)
      node = { container, pillGfx, iconSprite, labelText, zzzTexts, lastLabel: '' }
      this.nameTagNodes.set(key, node)
      this.nameTagsLayer.addChild(container)
    }
    return node
  }

  private syncPlayerNameTag(
    key: string,
    player: Player,
    isLocal: boolean,
    callStates: Record<string, string>,
    nowMs: number
  ): void {
    const node = this.getOrCreateNameTag(key)
    const callState = (player.id && callStates[player.id]) || player.callState || 'idle'
    const isConnecting = callState === 'connecting'
    const label = isConnecting ? `${player.name || 'Player'} •••` : player.name || 'Player'

    if (node.lastLabel !== label) {
      node.labelText.text = label
      node.lastLabel = label
    }
    node.labelText.style.fill = isConnecting ? 0xfde68a : 0xffffff

    const pillW = node.labelText.width + 18
    const pillH = 13
    const centerX = player.x * TILE_SIZE + TILE_SIZE / 2
    const tagY = player.y * TILE_SIZE - 13
    const pillX = centerX - pillW / 2
    const pillY = tagY - pillH + 2

    node.container.visible = true
    node.container.position.set(pillX, pillY)

    const borderColor = isLocal ? 0x38bdf8 : isConnecting ? 0xf59e0b : 0x334155
    node.pillGfx.clear()
    node.pillGfx
      .roundRect(0, 0, pillW, pillH, 6.5)
      .fill({ color: isLocal ? 0x0f172a : 0x1b202c, alpha: isLocal ? 0.92 : 0.9 })
      .stroke({ width: 1, color: borderColor })

    const iconX = 7
    const iconY = pillH / 2
    const statusIconImg = isConnecting ? null : getStatusIconImage(player.status || 'available')
    const iconTex = statusIconImg
      ? this.textures.getImageTexture(`status:${player.status || 'available'}`, statusIconImg)
      : null

    if (iconTex) {
      node.iconSprite.visible = true
      node.iconSprite.texture = iconTex
      node.iconSprite.width = 9
      node.iconSprite.height = 9
      node.iconSprite.position.set(iconX - 4.5, iconY - 4.5)
    } else {
      node.iconSprite.visible = false
      const dotColor = isConnecting
        ? 0xf59e0b
        : parseHexColor(STATUS_META[player.status || 'available']?.hexColor, 0x22c55e)
      const pulse = isConnecting ? 0.45 + Math.abs(Math.sin(((nowMs % 900) / 900) * Math.PI)) * 0.55 : 1
      node.pillGfx.circle(iconX, iconY, 2.2).fill({ color: dotColor, alpha: pulse })
    }

    node.labelText.position.set(13.5, 2)

    const showZzz = player.status === 'away' || player.statusEmoji === '💤'
    for (let i = 0; i < node.zzzTexts.length; i++) {
      const zt = node.zzzTexts[i]
      if (!showZzz) {
        zt.visible = false
        continue
      }
      const progress = (nowMs / 1400 + i * 0.33) % 1
      const alpha = Math.max(0, Math.sin(progress * Math.PI) * 0.95)
      const yOffset = -progress * 16 - 8
      const xOffset = Math.sin(progress * Math.PI * 2) * 2.5 + i * 3.5 + (pillW / 2 - 4)
      zt.visible = true
      zt.alpha = alpha
      zt.position.set(xOffset, yOffset)
    }
  }

  private syncPetNameTag(key: string, px: number, py: number, petName: string | undefined): void {
    const label = petName || 'Pet'
    const node = this.getOrCreateNameTag(key)
    node.iconSprite.visible = false
    for (const zt of node.zzzTexts) zt.visible = false

    if (node.lastLabel !== label) {
      node.labelText.text = label
      node.lastLabel = label
    }
    node.labelText.style.fill = 0xe2e8f0

    const pillW = node.labelText.width + 12
    const pillH = 12
    const pillX = px + 16 - pillW / 2
    const pillY = py - 8

    node.container.visible = true
    node.container.position.set(pillX, pillY)
    node.pillGfx.clear()
    node.pillGfx
      .roundRect(0, 0, pillW, pillH, 5)
      .fill({ color: 0x0f172a, alpha: 0.85 })
      .stroke({ width: 1, color: 0x64748b })
    node.labelText.position.set(6, 1.5)
  }

  public destroy(): void {
    this.worldOverlay.destroy({ children: true })
    this.hudLayer.destroy({ children: true })
    this.nameTagNodes.clear()
    this.closedBadgeNodes.clear()
    this.houseOccupantNodes.clear()
    this.zoneLabels.clear()
    this.reactionTexts.clear()
  }
}
