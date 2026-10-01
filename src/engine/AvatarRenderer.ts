import { Player, Direction } from '../types/game'
import { TILE_SIZE } from './Constants'
import { getCustomAssetImage, useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { NameTagRenderer } from './avatar/nameTagRenderer'
import { AvatarAtlasManager, SubTexture } from './avatar/AvatarAtlasManager'
export { NameTagRenderer } from './avatar/nameTagRenderer'
export { AvatarAtlasManager } from './avatar/AvatarAtlasManager'

export class AvatarRenderer {
  /**
   * Memoized atlas resolution: (category|presetId|dir|walkFrame) → SubTexture|null.
   * drawAtlasPart builds 6 candidate names per layer per player per frame;
   * this cache reduces it to one Map lookup on repeat frames. Invalidated
   * when AvatarAtlasManager.clearCache() is called (atlas set changes).
   */
  private static atlasResolveCache = new Map<string, SubTexture | null>()

  // Atlas registry version at last resolve — auto-invalidates the memo.
  private static lastAtlasVersion: number = -1

  private static resolveAtlasSub(
    category: string,
    presetId: string,
    searchDir: Direction,
    walkFrame: number
  ): SubTexture | null {
    // If atlases were cleared/replaced, drop stale resolutions.
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
    // Bound cache growth (11 layers × 4 dirs × 4 frames × presets).
    if (AvatarRenderer.atlasResolveCache.size > 4000) {
      AvatarRenderer.atlasResolveCache.clear()
    }
    AvatarRenderer.atlasResolveCache.set(cacheKey, resolved)
    return resolved
  }

  /** Test/debug hook — clears the memoized atlas resolutions. */
  static clearAtlasResolveCache() {
    AvatarRenderer.atlasResolveCache.clear()
  }
  /**
   * Draw a layer component from AvatarAtlasManager if present.
   * Returns true if rendered, false if not present (triggering hybrid procedural fallback).
   */
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

    // Resolve direction name and horizontal flip requirement
    let searchDir = dir
    let flipX = false
    if (dir === 'left') {
      searchDir = 'right'
      flipX = true
    }

    // Lookup candidate names in priority order (memoized — see resolveAtlasSub):
    // 1. <category>_<presetId>_<dir>_<walkFrame> (frame-specific)
    // 2. <category>_<presetId>_<dir>_0 (static dir)
    // 3. <category>_<presetId>_<dir> (dir name only)
    // 4. <category>_<presetId>_<walkFrame>
    // 5. <category>_<presetId>_0
    // 6. <category>_<presetId>
    const sub = AvatarRenderer.resolveAtlasSub(category, presetId, searchDir, walkFrame)

    if (!sub) return false

    const img = AvatarAtlasManager.getImage(category)
    if (!img) return false

    // If img has complete property, verify it's loaded
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

  /**
   * Draw Authentic Gather.town Pixel Art 2D Avatar with Hybrid Fallback
   */
  static drawPlayer(
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

    // Walk Bobbing & 4-Frame Step Cycle
    let bodyBob = 0
    let walkFrame = 0
    const isMoving = !!player.isMoving

    if (isMoving) {
      walkFrame = Math.floor((animationTick / 120) % 4)
      if (walkFrame === 1 || walkFrame === 3) {
        bodyBob = -1 // Passing position - body peaks 1px up
      } else {
        bodyBob = 0 // Stride contact positions
      }
    }

    const centerX = px + size / 2
    const baseY = py + size - 7 + bodyBob

    // Custom Hand-Drawn Avatar Skin Override
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
        ctx.restore()
        return
      }
    }

    // Normalize Colors with Backward Compatibility
    const skinTone = avatar.skinTone || avatar.skinColor || '#ffd1a4'
    const eyeColor = avatar.eyeColor || '#111111'

    // Hoisted per-drawPlayer lookup tables: the string→asset resolution below
    // used to linear-scan the whole custom asset list per layer (11× per player
    // per frame). Build once here; layers reuse O(1) Map lookups.
    const customAssetsList = useCustomAssetsStore.getState().customAssets
    let customById: Map<string, (typeof customAssetsList)[number]> | null = null
    const getCustomById = () => {
      if (!customById) {
        customById = new Map(customAssetsList.map((a) => [a.id, a]))
      }
      return customById
    }

    // Helper to render hand-drawn custom component layers with 4-directional support and walk cycle loop
    const drawCustomComponent = (component?: string | Partial<Record<Direction, string | string[]>>) => {
      if (!component) return
      let resolvedComponent = component

      // If component is a string (id or dataUrl), attempt to resolve directionalFrames from store
      if (typeof component === 'string') {
        // Fast path: id lookup O(1). Slow dataURL scan only for legacy raw URLs.
        const byId = getCustomById().get(component)
        if (byId?.directionalFrames) {
          resolvedComponent = byId.directionalFrames
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
        // Backward compatibility for single frame assets:
        // Never render a front-only frame when player is facing away (up)
        if (dir === 'up') return
        dataUrl = resolvedComponent
        if (dir === 'left') shouldFlip = true
      } else {
        // Helper to pick the appropriate frame for a direction
        const pickDirectionFrame = (rawFrames?: string | string[]): string | undefined => {
          if (!rawFrames) return undefined
          if (typeof rawFrames === 'string') return rawFrames
          if (!Array.isArray(rawFrames) || rawFrames.length === 0) return undefined
          // When not moving, always return frame 0 (idle/resting frame)
          if (!isMoving) return rawFrames[0]
          // When moving, loop through frames in walk cycle!
          return rawFrames[walkFrame % rawFrames.length]
        }

        // Multi-directional frames (single frame or walk loop array)
        dataUrl = pickDirectionFrame(resolvedComponent[dir])

        // Automatic side-profile mirroring fallback if one side wasn't drawn
        if (!dataUrl) {
          if (dir === 'left' && resolvedComponent.right) {
            dataUrl = pickDirectionFrame(resolvedComponent.right)
            shouldFlip = true
          } else if (dir === 'right' && resolvedComponent.left) {
            dataUrl = pickDirectionFrame(resolvedComponent.left)
            shouldFlip = true
          }
        }
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
        ctx.restore()
      }
    }

    // ==========================================
    // FULL CHARACTER (Personagem - Retro default)
    // ==========================================
    const DEFAULT_RETRO_ID = 'avatar_other_sliced_1788355059618_ozg3'
    const otherComp =
      avatar.customComponents?.other ||
      (avatar.otherType && avatar.otherType !== 'default' && avatar.otherType !== 'none'
        ? avatar.otherType
        : undefined) ||
      avatar.customAvatarId ||
      DEFAULT_RETRO_ID

    const renderedAtlas =
      typeof otherComp === 'string'
        ? AvatarRenderer.drawAtlasPart(ctx, px, py, bodyBob, size, dir, 'other', otherComp, walkFrame)
        : false

    if (!renderedAtlas) {
      drawCustomComponent(otherComp)
    }

    // ==========================================
    // NAME TAG BADGE (Floating above head)
    // ==========================================
    if (showNameTag) {
      NameTagRenderer.drawNameTag(ctx, player, isLocal, centerX, py - 13)
    }

    ctx.restore()
    return
  }
}

