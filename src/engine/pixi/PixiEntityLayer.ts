import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import type { CustomAsset } from '../../types/customAsset'
import type { Direction, PetConfig, Player } from '../../types/game'
import { activitySequence } from '../../utils/avatarActivityAnimations'
import { AvatarRenderer, DEFAULT_RETRO_ID, isDirectImageSource } from '../AvatarRenderer'
import { AvatarAtlasManager } from '../avatar/AvatarAtlasManager'
import { AvatarEffectsManager } from '../avatarEffects'
import { StepsTrailEffect } from '../avatarEffects/effects/stepsTrailEffect'
import { SHAPE_MATRICES } from '../avatarEffects/pixelSprites'
import { TILE_SIZE } from '../Constants'
import type { PetState } from '../pet/PetManager'
import { PetManager } from '../pet/PetManager'
import {
  CUSTOM_PET_SIZE,
  MAX_PET_BOB,
  MEOWTH_FRAMES,
  MEOWTH_SPRITE_URL,
  PET_BASELINE,
} from '../pet/PetRenderer'
import { getBedParticipantTransform } from '../rendering/bedRenderer'
import { parseHexColor, PixiTextureCache } from './PixiTextureCache'

interface PlayerNode {
  container: Container
  sprite: Sprite
  activityText: Text | null
  lastCue: string
}

interface PetNode {
  container: Container
  sprite: Sprite
}

interface CustomResolveResult {
  texture: Texture
  mirrorH: boolean
  activeActivity: boolean
}

function resolveAtlasTexture(
  textures: PixiTextureCache,
  category: string,
  presetId: string,
  dir: Direction,
  walkFrame: number,
  onLoaded: () => void
): { texture: Texture; mirrorH: boolean } | null {
  if (!presetId || presetId === 'none') return null
  let searchDir = dir
  let flipX = false
  if (dir === 'left') {
    searchDir = 'right'
    flipX = true
  }
  const sub = AvatarRenderer.resolveAtlasSub(category, presetId, searchDir, walkFrame)
  if (!sub) return null
  const img = AvatarAtlasManager.getImage(category)
  if (!img) return null
  const tex = textures.getSubTexture(
    `atlas:${category}:${sub.name}`,
    img,
    sub.x,
    sub.y,
    sub.width,
    sub.height,
    onLoaded
  )
  if (!tex) return null
  return { texture: tex, mirrorH: flipX }
}

/**
 * Pure PixiJS v8 Y-sorted entity renderer for Avatars, Pets, and Step Trails.
 */
export class PixiEntityLayer {
  public readonly groundEffectsLayer = new Container()
  public readonly entityLayer = new Container()

  private readonly stepsGfx = new Graphics()
  private readonly playerNodes = new Map<string, PlayerNode>()
  private readonly petNodes = new Map<string, PetNode>()
  private dirty = false

  constructor(private readonly textures: PixiTextureCache) {
    this.groundEffectsLayer.addChild(this.stepsGfx)
  }

  public markDirty = (): void => {
    this.dirty = true
  }

  private resolveCustomAvatarTexture(
    component: string | Partial<Record<Direction, string | string[]>> | undefined,
    dir: Direction,
    isMoving: boolean,
    walkFrame: number,
    activity: Player['activityAnimation'] | undefined,
    activityElapsed: number,
    customAssets: CustomAsset[],
    customById: Map<string, CustomAsset>
  ): CustomResolveResult | null {
    if (!component) return null
    let resolved: string | Partial<Record<Direction, string | string[]>> = component
    let activeFrames = false
    let activityFrame = 0

    if (typeof component === 'string') {
      const byId = customById.get(component)
      const animFrames = activitySequence(activity ? byId?.activityAnimations?.[activity] : undefined)
      if (animFrames.length > 0) {
        resolved = { down: animFrames }
        activeFrames = true
        activityFrame = Math.floor(activityElapsed / Math.max(1, byId?.frameRateMs || 160))
      } else if (byId?.directionalFrames) {
        resolved = byId.directionalFrames
      } else if (byId?.frames.length) {
        resolved = {
          down: byId.frames[0],
          up: byId.frames[1] || byId.frames[0],
          left: byId.frames[2] || byId.frames[0],
          right: byId.frames[3] || byId.frames[0],
        }
      } else if (!byId) {
        const match = customAssets.find(
          (a) =>
            a.frames?.[0] === component ||
            (typeof a.directionalFrames?.down === 'string'
              ? a.directionalFrames.down === component
              : a.directionalFrames?.down?.[0] === component)
        )
        if (match?.directionalFrames) {
          resolved = match.directionalFrames
        } else if (!match && !isDirectImageSource(component)) {
          return null
        }
      } else {
        return null
      }
    }

    let url: string | undefined
    let mirrorH = false

    if (typeof resolved === 'string') {
      if (dir === 'up') return null
      url = resolved
      if (dir === 'left') mirrorH = true
    } else {
      const pickDirFrame = (raw?: string | string[]): string | undefined => {
        if (!raw) return undefined
        if (typeof raw === 'string') return raw
        if (!Array.isArray(raw) || raw.length === 0) return undefined
        if (activeFrames) return raw[activityFrame % raw.length]
        if (!isMoving) return raw[0]
        return raw[walkFrame % raw.length]
      }

      url = pickDirFrame(resolved[activeFrames ? 'down' : dir])
      if (!url) {
        if (dir === 'left') {
          url = pickDirFrame(resolved.right)
          mirrorH = Boolean(url)
        } else if (dir === 'right') {
          url = pickDirFrame(resolved.left)
          mirrorH = Boolean(url)
        }
      }
      if (!url && activeFrames) {
        url = pickDirFrame(resolved.down) || Object.values(resolved).map(pickDirFrame).find(Boolean)
      }
    }

    if (!url) return null
    const tex = this.textures.getUrlTexture(url, this.markDirty)
    if (!tex) return null
    return { texture: tex, mirrorH, activeActivity: activeFrames }
  }

  private renderStepsTrail(nowMs: number): void {
    this.stepsGfx.clear()
    const effects = AvatarEffectsManager.getInstance()
    if (!effects.isEnabled()) return
    const steps = effects.getEffect('avatar:steps') as StepsTrailEffect | undefined
    if (!steps || !steps.enabled) return

    const particles = steps.getParticles()
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
          this.stepsGfx.rect(ox + c * pixelSize, oy + r * pixelSize, pixelSize, pixelSize).fill({ color: col, alpha })
        }
      }
    }
  }

  public update(
    localPlayer: Player,
    remotePlayers: Record<string, Player>,
    closedZoneIds: ReadonlySet<string>,
    bounds: { camMinX: number; camMaxX: number; camMinY: number; camMaxY: number; enableCulling: boolean },
    nowMs: number
  ): void {
    this.dirty = false
    this.renderStepsTrail(nowMs)

    const customAssets = useCustomAssetsStore.getState().customAssets
    const customById = new Map<string, CustomAsset>()
    for (const a of customAssets) customById.set(a.id, a)

    const remoteList = Object.values(remotePlayers).filter((p) => !p.isDjBot && !p.id.startsWith('dj-'))
    const isHiddenBehindRoof = (p: Player) =>
      Boolean(p.currentZoneId && closedZoneIds.has(p.currentZoneId))

    const entities: (
      | { kind: 'player'; y: number; key: string; player: Player; isLocal: boolean }
      | { kind: 'pet'; y: number; key: string; pet: PetState; config: PetConfig }
    )[] = [{ kind: 'player', y: localPlayer.y, key: `p:${localPlayer.id}`, player: localPlayer, isLocal: true }]

    for (const p of remoteList) {
      if (p.id === localPlayer.id || (p.gameId && p.gameId === localPlayer.id)) continue
      if (isHiddenBehindRoof(p)) continue
      if (bounds.enableCulling) {
        const ppx = (p.x + 0.5) * TILE_SIZE
        const ppy = (p.y + 0.5) * TILE_SIZE
        if (ppx < bounds.camMinX - 64 || ppx > bounds.camMaxX + 64 || ppy < bounds.camMinY - 64 || ppy > bounds.camMaxY + 64) {
          continue
        }
      }
      entities.push({ kind: 'player', y: p.y, key: `p:${p.id}`, player: p, isLocal: false })
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
          entities.push({ kind: 'pet', y: pet.y, key: `pet:${p.id}`, pet, config: p.avatar.pet })
        }
      }
    }

    if (entities.length > 1) entities.sort((a, b) => a.y - b.y)

    const seenPlayers = new Set<string>()
    const seenPets = new Set<string>()
    const orderedContainers: Container[] = []

    for (const item of entities) {
      if (item.kind === 'player') {
        seenPlayers.add(item.player.id)
        const node = this.syncPlayerNode(item.player, nowMs, customAssets, customById)
        if (node) orderedContainers.push(node.container)
      } else {
        seenPets.add(item.key)
        const node = this.syncPetNode(item.key, item.pet, item.config, nowMs, customAssets)
        if (node) orderedContainers.push(node.container)
      }
    }

    for (const [id, node] of this.playerNodes) {
      if (!seenPlayers.has(id)) {
        this.entityLayer.removeChild(node.container)
        node.container.destroy({ children: true })
        this.playerNodes.delete(id)
      }
    }
    for (const [id, node] of this.petNodes) {
      if (!seenPets.has(id)) {
        this.entityLayer.removeChild(node.container)
        node.container.destroy({ children: true })
        this.petNodes.delete(id)
      }
    }

    for (let idx = 0; idx < orderedContainers.length; idx++) {
      const c = orderedContainers[idx]
      if (this.entityLayer.children[idx] !== c) {
        this.entityLayer.setChildIndex(c, Math.min(idx, this.entityLayer.children.length - 1))
      }
    }
  }

  private syncPlayerNode(
    player: Player,
    nowMs: number,
    customAssets: CustomAsset[],
    customById: Map<string, CustomAsset>
  ): PlayerNode | null {
    let node = this.playerNodes.get(player.id)
    if (!node) {
      const container = new Container()
      const sprite = new Sprite(Texture.EMPTY)
      container.addChild(sprite)
      node = { container, sprite, activityText: null, lastCue: '' }
      this.playerNodes.set(player.id, node)
      this.entityLayer.addChild(container)
    }

    const bed = getBedParticipantTransform(player.id)
    if (bed.hidden) {
      node.container.visible = false
      return node
    }

    node.container.visible = true
    node.container.alpha = bed.alpha

    const px = player.x * TILE_SIZE
    const py = player.y * TILE_SIZE
    const dir = player.direction || 'down'
    const isMoving = Boolean(player.isMoving)
    const walkFrame = isMoving ? Math.floor((nowMs / 120) % 4) : 0
    const bodyBob = isMoving && (walkFrame === 1 || walkFrame === 3) ? -1 : 0
    const avatar = player.avatar || {}
    const activity = !isMoving && player.activityAnimation && player.activityAnimation !== 'none'
      ? player.activityAnimation
      : undefined
    const activityElapsed = Math.max(0, Date.now() - (player.activityAnimationStartedAt || Date.now()))

    node.container.position.set(px, py + bed.offsetY)

    let resolvedTex: Texture | null = null
    let mirrorH = false
    let aspectHeight = TILE_SIZE
    let renderedActivity = false

    if (avatar.customSkinUrl) {
      const skinTex = this.textures.getUrlTexture(avatar.customSkinUrl, this.markDirty)
      if (skinTex) {
        resolvedTex = skinTex
        mirrorH = dir === 'left'
        aspectHeight = TILE_SIZE
      }
    }

    if (!resolvedTex) {
      const otherComp =
        avatar.customComponents?.other ||
        (avatar.otherType && avatar.otherType !== 'default' && avatar.otherType !== 'none'
          ? avatar.otherType
          : undefined) ||
        avatar.customAvatarId ||
        DEFAULT_RETRO_ID

      const hasActivityFrames =
        Boolean(activity && typeof otherComp === 'string' &&
          activitySequence(customById.get(otherComp)?.activityAnimations?.[activity]).length > 0)

      if (typeof otherComp === 'string' && !hasActivityFrames) {
        const atlas = resolveAtlasTexture(this.textures, 'other', otherComp, dir, walkFrame, this.markDirty)
        if (atlas) {
          resolvedTex = atlas.texture
          mirrorH = atlas.mirrorH
          aspectHeight = TILE_SIZE
        }
      }

      if (!resolvedTex) {
        const customRes = this.resolveCustomAvatarTexture(
          otherComp,
          dir,
          isMoving,
          walkFrame,
          activity,
          activityElapsed,
          customAssets,
          customById
        )
        if (customRes) {
          resolvedTex = customRes.texture
          mirrorH = customRes.mirrorH
          renderedActivity = customRes.activeActivity
          aspectHeight = TILE_SIZE * (customRes.texture.height / Math.max(1, customRes.texture.width))
        } else if (otherComp !== DEFAULT_RETRO_ID) {
          const defAtlas = resolveAtlasTexture(this.textures, 'other', DEFAULT_RETRO_ID, dir, walkFrame, this.markDirty)
          if (defAtlas) {
            resolvedTex = defAtlas.texture
            mirrorH = defAtlas.mirrorH
          } else {
            const defCustom = this.resolveCustomAvatarTexture(
              DEFAULT_RETRO_ID,
              dir,
              isMoving,
              walkFrame,
              activity,
              activityElapsed,
              customAssets,
              customById
            )
            if (defCustom) {
              resolvedTex = defCustom.texture
              mirrorH = defCustom.mirrorH
              aspectHeight = TILE_SIZE * (defCustom.texture.height / Math.max(1, defCustom.texture.width))
            }
          }
        }
      }
    }

    if (resolvedTex) {
      node.sprite.visible = true
      node.sprite.texture = resolvedTex
      const sx = TILE_SIZE / Math.max(1, resolvedTex.width)
      const sy = aspectHeight / Math.max(1, resolvedTex.height)
      const drawY = TILE_SIZE - aspectHeight + bodyBob
      if (mirrorH) {
        node.sprite.scale.set(-sx, sy)
        node.sprite.position.set(TILE_SIZE, drawY)
      } else {
        node.sprite.scale.set(sx, sy)
        node.sprite.position.set(0, drawY)
      }
    } else {
      node.sprite.visible = false
    }

    if (activity && !renderedActivity) {
      const cue = activity === 'sleep' ? 'Zzz' : '…'
      if (!node.activityText) {
        node.activityText = new Text({
          text: cue,
          style: { fontFamily: 'sans-serif', fontWeight: 'bold', fontSize: 10, fill: 0xc4b5fd },
          resolution: 3,
        })
        node.activityText.anchor.set(0.5, 0)
        node.container.addChild(node.activityText)
      }
      if (node.lastCue !== cue) {
        node.activityText.text = cue
        node.lastCue = cue
      }
      node.activityText.visible = true
      node.activityText.position.set(TILE_SIZE, -14 - Math.sin(nowMs / 400) * 2)
    } else if (node.activityText) {
      node.activityText.visible = false
    }

    return node
  }

  private syncPetNode(
    key: string,
    pet: PetState,
    config: PetConfig,
    nowMs: number,
    customAssets: CustomAsset[]
  ): PetNode | null {
    let node = this.petNodes.get(key)
    if (!node) {
      const container = new Container()
      const sprite = new Sprite(Texture.EMPTY)
      container.addChild(sprite)
      node = { container, sprite }
      this.petNodes.set(key, node)
      this.entityLayer.addChild(container)
    }

    const px = pet.x * TILE_SIZE
    const py = pet.y * TILE_SIZE
    const bob = pet.isMoving ? Math.sin(nowMs / 100) * MAX_PET_BOB : Math.sin(nowMs / 400) * 0.8

    let tex: Texture | null = null
    let petSize = CUSTOM_PET_SIZE

    if (config.type === 'custom' || config.directionalFrames || config.customAssetId) {
      let directionalFrames = config.directionalFrames
      if (!directionalFrames && config.customAssetId) {
        const asset = customAssets.find((a) => a.id === config.customAssetId)
        if (asset?.directionalFrames) {
          directionalFrames = asset.directionalFrames
        } else if (asset?.frames?.length) {
          directionalFrames = {
            down: asset.frames[0],
            up: asset.frames[1] || asset.frames[0],
            left: asset.frames[2] || asset.frames[0],
            right: asset.frames[3] || asset.frames[0],
          }
        }
      }
      if (directionalFrames) {
        const dir = pet.direction || 'down'
        const raw = directionalFrames[dir] || directionalFrames.down
        const url =
          typeof raw === 'string'
            ? raw
            : Array.isArray(raw) && raw.length > 0
            ? raw[pet.isMoving ? pet.walkFrame % raw.length : 0] || raw[0]
            : undefined
        tex = this.textures.getUrlTexture(url, this.markDirty)
      }
    } else if (config.type === 'meowth') {
      petSize = 26
      const dirFrames = MEOWTH_FRAMES[pet.direction] || MEOWTH_FRAMES.down
      const frame = dirFrames[pet.isMoving ? pet.walkFrame % dirFrames.length : 0] || dirFrames[0]
      const baseTex = this.textures.getUrlTexture(MEOWTH_SPRITE_URL, this.markDirty)
      if (baseTex) {
        tex = this.textures.getSubTexture(
          `meowth:${frame.x}:${frame.y}:${frame.w}x${frame.h}`,
          baseTex.source.resource as HTMLImageElement,
          frame.x,
          frame.y,
          frame.w,
          frame.h,
          this.markDirty
        )
      }
    }

    if (tex) {
      node.container.visible = true
      node.sprite.texture = tex
      node.sprite.width = petSize
      node.sprite.height = petSize
      node.container.position.set(px + 16 - petSize / 2, py + PET_BASELINE - petSize + bob)
    } else {
      node.container.visible = false
    }

    return node
  }

  public destroy(): void {
    for (const node of this.playerNodes.values()) node.container.destroy({ children: true })
    this.playerNodes.clear()
    for (const node of this.petNodes.values()) node.container.destroy({ children: true })
    this.petNodes.clear()
    this.groundEffectsLayer.destroy({ children: true })
    this.entityLayer.destroy({ children: true })
  }
}
