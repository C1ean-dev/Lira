import { Player, Direction } from '../types/game'
import { TILE_SIZE } from './Constants'
import { getCustomAssetImage, useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { NameTagRenderer } from './avatar/nameTagRenderer'
import { AvatarAtlasManager, SubTexture } from './avatar/AvatarAtlasManager'
import { activitySequence } from '../utils/avatarActivityAnimations'
export { NameTagRenderer } from './avatar/nameTagRenderer'
export { AvatarAtlasManager } from './avatar/AvatarAtlasManager'

export class AvatarRenderer {
  private static atlasResolveCache = new Map<string, SubTexture | null>()

  private static lastAtlasVersion: number = -1

  private static resolveAtlasSub(
    category: string,
    presetId: string,
    searchDir: Direction,
    walkFrame: number
  ): SubTexture | null {
    const version = AvatarAtlasManager.getVersion()
    if (version !== AvatarRenderer.lastAtlasVersion) {
      AvatarRenderer.lastAtlasVersion = version
      AvatarRenderer.atlasResolveCache.clear()
    }
    const cacheKey = `${category}|${presetId}|${searchDir}|${walkFrame}`
    const hit = AvatarRenderer.atlasResolveCache.get(cacheKey)
    if (hit !== undefined) return hit

    const candidateNames = [
      `${category}_${presetId}_${searchDir}_${walkFrame}`,
      `${category}_${presetId}_${searchDir}_0`,
      `${category}_${presetId}_${searchDir}`,
      `${category}_${presetId}_${walkFrame}`,
      `${category}_${presetId}_0`,
      `${category}_${presetId}`,
    ]

    let sub: SubTexture | undefined
    for (const name of candidateNames) {
      sub = AvatarAtlasManager.getSubTexture(category, name)
      if (sub) break
    }
    const resolved = sub ?? null
    if (AvatarRenderer.atlasResolveCache.size > 4000) {
      AvatarRenderer.atlasResolveCache.clear()
    }
    AvatarRenderer.atlasResolveCache.set(cacheKey, resolved)
    return resolved
  }

  static clearAtlasResolveCache() {
    AvatarRenderer.atlasResolveCache.clear()
  }
  static drawAtlasPart(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    bodyBob: number,
    size: number,
    dir: Direction,
    category: string,
    presetId: string,
    walkFrame: number = 0
  ): boolean {
    if (!presetId || presetId === 'none') return false

    let searchDir = dir
    let flipX = false
    if (dir === 'left') {
      searchDir = 'right'
      flipX = true
    }

    const sub = AvatarRenderer.resolveAtlasSub(category, presetId, searchDir, walkFrame)

    if (!sub) return false

    const img = AvatarAtlasManager.getImage(category)
    if (!img) return false

    if ('complete' in img && !img.complete) return false

    ctx.save()
    if (flipX) {
      ctx.translate(px + size / 2, 0)
      ctx.scale(-1, 1)
      ctx.translate(-(px + size / 2), 0)
    }

    const destX = px + (sub.frameX ? -sub.frameX : 0)
    const destY = py + bodyBob + (sub.frameY ? -sub.frameY : 0)

    ctx.drawImage(
      img,
      sub.x,
      sub.y,
      sub.width,
      sub.height,
      destX,
      destY,
      size,
      size
    )
    ctx.restore()

    return true
  }

  static drawPlayer(
    ctx: CanvasRenderingContext2D,
    player: Player,
    isLocal: boolean,
    animationTick: number,
    size: number = TILE_SIZE,
    showNameTag: boolean = true
  ) {
    if (!player.seatedOn || player.isMoving) {
      AvatarRenderer.drawPlayerSprite(ctx, player, isLocal, animationTick, size, showNameTag)
      return
    }
    // Keep the feet on the seat while lowering the body for existing avatar sprites.
    ctx.save()
    ctx.translate(0, (player.y * size + size) * 0.25)
    ctx.scale(1, 0.75)
    AvatarRenderer.drawPlayerSprite(ctx, player, isLocal, animationTick, size, false)
    ctx.restore()
    if (showNameTag) NameTagRenderer.drawNameTag(ctx, player, isLocal, (player.x + 0.5) * size, player.y * size - 13)
  }

  private static drawPlayerSprite(
    ctx: CanvasRenderingContext2D,
    player: Player,
    isLocal: boolean,
    animationTick: number,
    size: number = TILE_SIZE,
    showNameTag: boolean = true
  ) {
    const px = player.x * size
    const py = player.y * size
    const avatar = player.avatar || {}
    const dir = player.direction || 'down'

    ctx.save()

    let bodyBob = 0
    let walkFrame = 0
    const isMoving = !!player.isMoving
    const activity = !isMoving && player.activityAnimation !== 'none' ? player.activityAnimation : undefined
    const activityElapsed = Math.max(0, Date.now() - (player.activityAnimationStartedAt || Date.now()))
    let renderedActivity = false
    const drawActivityCue = () => {
      if (!activity || renderedActivity) return
      ctx.save()
      ctx.font = 'bold 10px sans-serif'
      ctx.fillStyle = '#c4b5fd'
      ctx.textAlign = 'center'
      ctx.fillText(activity === 'sleep' ? 'Zzz' : '…', px + size, py - 4 - Math.sin(animationTick / 400) * 2)
      ctx.restore()
    }

    if (isMoving) {
      walkFrame = Math.floor((animationTick / 120) % 4)
      if (walkFrame === 1 || walkFrame === 3) {
        bodyBob = -1
      } else {
        bodyBob = 0
      }
    }

    const centerX = px + size / 2
    const baseY = py + size - 7 + bodyBob

    if (avatar.customSkinUrl) {
      const img = getCustomAssetImage(avatar.customSkinUrl)
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save()
        const isDownscaling = img.naturalWidth > size * 1.2 || img.naturalHeight > size * 1.2
        ctx.imageSmoothingEnabled = isDownscaling
        if (isDownscaling) {
          ctx.imageSmoothingQuality = 'high'
        }
        if (dir === 'left') {
          ctx.translate(px + size / 2, 0)
          ctx.scale(-1, 1)
          ctx.translate(-(px + size / 2), 0)
        }
        ctx.drawImage(img, px, py + bodyBob, size, size)
        ctx.restore()

        if (showNameTag) {
          NameTagRenderer.drawNameTag(ctx, player, isLocal, centerX, py - 13)
        }
        drawActivityCue()
        ctx.restore()
        return
      }
    }

    const skinTone = avatar.skinTone || avatar.skinColor || '#ffd1a4'
    const eyeColor = avatar.eyeColor || '#111111'

    const customAssetsList = useCustomAssetsStore.getState().customAssets
    let customById: Map<string, (typeof customAssetsList)[number]> | null = null
    const getCustomById = () => {
      if (!customById) {
        customById = new Map(customAssetsList.map((a) => [a.id, a]))
      }
      return customById
    }

    const drawCustomComponent = (component?: string | Partial<Record<Direction, string | string[]>>) => {
      if (!component) return
      let resolvedComponent = component
      let activeFrames = false
      let activityFrame = 0

      if (typeof component === 'string') {
        const byId = getCustomById().get(component)
        const animationFrames = activitySequence(activity ? byId?.activityAnimations?.[activity] : undefined)
        if (animationFrames.length) {
          resolvedComponent = { down: animationFrames }
          activeFrames = true
          activityFrame = Math.floor(activityElapsed / Math.max(1, byId?.frameRateMs || 160))
        } else if (byId?.directionalFrames) {
          resolvedComponent = byId.directionalFrames
        } else if (byId?.frames.length) {
          resolvedComponent = {
            down: byId.frames[0], up: byId.frames[1] || byId.frames[0],
            left: byId.frames[2] || byId.frames[0], right: byId.frames[3] || byId.frames[0],
          }
        } else if (!byId) {
          const matchingAsset = customAssetsList.find(
            (a) =>
              a.frames?.[0] === component ||
              (typeof a.directionalFrames?.down === 'string'
                ? a.directionalFrames.down === component
                : a.directionalFrames?.down?.[0] === component)
          )
          if (matchingAsset?.directionalFrames) {
            resolvedComponent = matchingAsset.directionalFrames
          }
        }
      }

      let dataUrl: string | undefined
      let shouldFlip = false

      if (typeof resolvedComponent === 'string') {
        if (dir === 'up') return
        dataUrl = resolvedComponent
        if (dir === 'left') shouldFlip = true
      } else {
        const pickDirectionFrame = (rawFrames?: string | string[]): string | undefined => {
          if (!rawFrames) return undefined
          if (typeof rawFrames === 'string') return rawFrames
          if (!Array.isArray(rawFrames) || rawFrames.length === 0) return undefined
          if (activeFrames) return rawFrames[activityFrame % rawFrames.length]
          if (!isMoving) return rawFrames[0]
          return rawFrames[walkFrame % rawFrames.length]
        }

        dataUrl = pickDirectionFrame(resolvedComponent[activeFrames ? 'down' : dir])

        if (!dataUrl) {
          if (dir === 'left') {
            dataUrl = pickDirectionFrame(resolvedComponent.right)
            shouldFlip = !!dataUrl
          } else if (dir === 'right') {
            dataUrl = pickDirectionFrame(resolvedComponent.left)
            shouldFlip = !!dataUrl
          }
        }
        if (!dataUrl && activeFrames) dataUrl = pickDirectionFrame(resolvedComponent.down) || Object.values(resolvedComponent).map(pickDirectionFrame).find(Boolean)
      }

      if (!dataUrl) return
      const img = getCustomAssetImage(dataUrl)
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save()
        if (shouldFlip) {
          ctx.translate(px + size / 2, 0)
          ctx.scale(-1, 1)
          ctx.translate(-(px + size / 2), 0)
        }
        const imgAspect = img.naturalHeight / Math.max(1, img.naturalWidth)
        const drawHeight = size * imgAspect
        const drawY = py + size - drawHeight + bodyBob
        ctx.drawImage(img, px, drawY, size, drawHeight)
        if (activeFrames) renderedActivity = true
        ctx.restore()
      }
    }

    const DEFAULT_RETRO_ID = 'avatar_other_sliced_1788355059618_ozg3'
    const otherComp =
      avatar.customComponents?.other ||
      (avatar.otherType && avatar.otherType !== 'default' && avatar.otherType !== 'none'
        ? avatar.otherType
        : undefined) ||
      avatar.customAvatarId ||
      DEFAULT_RETRO_ID

    const hasActivityFrames = activity && typeof otherComp === 'string' &&
      activitySequence(getCustomById().get(otherComp)?.activityAnimations?.[activity]).length > 0
    const renderedAtlas =
      typeof otherComp === 'string' && !hasActivityFrames
        ? AvatarRenderer.drawAtlasPart(ctx, px, py, bodyBob, size, dir, 'other', otherComp, walkFrame)
        : false

    if (!renderedAtlas) {
      drawCustomComponent(otherComp)
    }

    if (showNameTag) {
      NameTagRenderer.drawNameTag(ctx, player, isLocal, centerX, py - 13)
    }

    drawActivityCue()

    ctx.restore()
    return
  }
}

