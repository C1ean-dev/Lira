import { Direction, PetConfig, PetType } from '../../types/game'
import { TILE_SIZE } from '../Constants'
import { PetState } from './PetManager'
import { getCustomAssetImage, useCustomAssetsStore } from '../../store/useCustomAssetsStore'

const MEOWTH_SPRITE_URL =
  '/assets/pet/5660688_738696_lazy91_meowth-sprite-sheet.fff89e386a74ef7fd067b8f49695f124.png'

const MEOWTH_FRAMES: Record<Direction, { x: number; y: number; w: number; h: number }[]> = {
  down: [
    { x: 0, y: 32, w: 80, h: 80 },
    { x: 0, y: 112, w: 80, h: 80 },
    { x: 80, y: 32, w: 80, h: 80 },
    { x: 80, y: 112, w: 80, h: 80 },
  ],
  up: [
    { x: 160, y: 32, w: 80, h: 80 },
    { x: 160, y: 112, w: 80, h: 80 },
  ],
  left: [{ x: 240, y: 112, w: 80, h: 80 }],
  right: [{ x: 240, y: 32, w: 80, h: 80 }],
}

let meowthImg: HTMLImageElement | null = null
const getMeowthImage = (): HTMLImageElement => {
  if (!meowthImg && typeof Image !== 'undefined') {
    meowthImg = new Image()
    meowthImg.src = MEOWTH_SPRITE_URL
  }
  return meowthImg!
}

export class PetRenderer {
  public static drawPet(
    ctx: CanvasRenderingContext2D,
    pet: PetState,
    petConfig: PetConfig,
    currentTime: number,
    showNameTag: boolean = true
  ) {
    if (!petConfig || petConfig.type === 'none') return

    const px = pet.x * TILE_SIZE
    const py = pet.y * TILE_SIZE

    ctx.save()

    let sprite: { top: number; sleeping?: boolean } | undefined
    if (petConfig.type === 'custom' || petConfig.directionalFrames || petConfig.customAssetId) {
      sprite = this.drawCustomPet(ctx, px, py, pet, petConfig, currentTime)
    } else if (petConfig.type === 'meowth') {
      sprite = this.drawMeowth(ctx, px, py, pet, currentTime)
    }

    if (showNameTag) {
      this.drawNameTag(ctx, px, sprite?.top ?? py - 2, petConfig, currentTime)
    }
    if (sprite?.sleeping) {
      this.drawSleepIndicator(ctx, px + 16, sprite.top - (showNameTag ? 21 : 4))
    }

    ctx.restore()
  }

  private static drawMeowth(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    pet: PetState,
    currentTime: number
  ) {
    const img = getMeowthImage()
    if (!img || !img.complete || img.naturalWidth === 0) {
      return
    }

    const dirFrames = MEOWTH_FRAMES[pet.direction] || MEOWTH_FRAMES.down
    const frameIdx = pet.isMoving ? pet.walkFrame % dirFrames.length : 0
    const frame = dirFrames[frameIdx] || dirFrames[0]

    const bob = pet.isMoving ? Math.sin(currentTime / 100) * 1.5 : 0
    const petSize = 26
    const drawX = px + 16 - petSize / 2
    const drawY = py + 26 - petSize + bob

    ctx.drawImage(img, frame.x, frame.y, frame.w, frame.h, drawX, drawY, petSize, petSize)
    return { top: drawY }
  }

  private static drawCustomPet(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    pet: PetState,
    config: PetConfig,
    currentTime: number
  ) {
    const asset = config.customAssetId
      ? useCustomAssetsStore.getState().customAssets.find(a => a.id === config.customAssetId)
      : undefined
    let directionalFrames = asset?.directionalFrames ?? config.directionalFrames
    if (!directionalFrames && config.customAssetId) {
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

    if (!directionalFrames) return

    const dir = pet.direction || 'down'
    const idleFrames = asset?.idleFrames ?? config.idleFrames
    const rawFrames = (!pet.isMoving ? idleFrames?.[dir] : undefined) ?? directionalFrames[dir] ?? directionalFrames.down
    let frameUrl: string | undefined
    let resting = false
    let sleeping = false
    const animations = asset?.petAnimations ?? config.petAnimations
    if (!pet.isMoving && animations) {
      const sleep = animations.sleep
      const yawn = animations.yawn
      if (pet.idleTime >= 300 && sleep?.frames.length) {
        const interval = Math.max(1, sleep.frameRateMs ?? 700)
        const tick = Math.floor((pet.idleTime - 300) * 1000 / interval)
        const loopStart = Math.min(sleep.frames.length - 1, Math.max(0, sleep.loopStartFrame ?? 0))
        const index = tick < loopStart ? tick : loopStart + (tick - loopStart) % (sleep.frames.length - loopStart)
        frameUrl = sleep.frames[index]
        resting = true
        sleeping = true
      } else if (pet.idleTime >= 120 && pet.idleTime < 300 && yawn?.frames.length) {
        const interval = Math.max(1, yawn.frameRateMs ?? 180)
        const index = Math.floor((pet.idleTime % 120) * 1000 / interval)
        if (index < yawn.frames.length) {
          frameUrl = yawn.frames[index]
          resting = true
        }
      }
    }

    if (!frameUrl && typeof rawFrames === 'string') {
      frameUrl = rawFrames
    } else if (!frameUrl && Array.isArray(rawFrames) && rawFrames.length > 0) {
      if (pet.isMoving) {
        const frameIdx = pet.walkFrame % rawFrames.length
        frameUrl = rawFrames[frameIdx] || rawFrames[0]
      } else {
        frameUrl = rawFrames[0]
      }
    }

    if (!frameUrl) return

    const img = getCustomAssetImage(frameUrl)
    if (!img || !img.complete || img.naturalWidth === 0) return

    const bob = pet.isMoving && !resting ? Math.sin(currentTime / 100) * 1.5 : 0
    const petSize = 28
    const drawX = px + 16 - petSize / 2
    const drawY = py + 26 - petSize + bob

    ctx.drawImage(img, drawX, drawY, petSize, petSize)
    return { top: drawY, sleeping }
  }

  private static drawSleepIndicator(ctx: CanvasRenderingContext2D, centerX: number, baseline: number) {
    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.lineWidth = 2
    ctx.strokeStyle = '#182235'
    ctx.fillStyle = '#dbeafe'
    for (let index = 0; index < 3; index++) {
      ctx.font = `bold ${7 + index}px monospace`
      const x = centerX + 3 + index * 6
      const y = baseline - index * 4
      ctx.strokeText('Z', x, y)
      ctx.fillText('Z', x, y)
    }
    ctx.restore()
  }

  private static drawNameTag(
    ctx: CanvasRenderingContext2D,
    px: number,
    spriteTop: number,
    petConfig: PetConfig,
    currentTime: number
  ) {
    const petName = petConfig.name?.trim() || this.getDefaultPetName(petConfig.type)
    if (!petName) return

    ctx.save()
    const tagText = `🐾 ${petName}`
    ctx.font = 'bold 9px sans-serif'
    const textW = ctx.measureText(tagText).width
    const tagW = textW + 10
    const tagH = 13
    const tagX = px + 16 - tagW / 2
    const tagY = spriteTop - tagH - 4

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
    ctx.beginPath()
    ctx.roundRect(tagX, tagY, tagW, tagH, 6)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = '#ffffff'
    ctx.fillText(tagText, tagX + 5, tagY + 9.5)

    const heartCycle = (currentTime % 4000) / 4000
    if (heartCycle < 0.25) {
      const heartY = tagY - 3 - heartCycle * 14
      const alpha = 1 - heartCycle / 0.25
      ctx.fillStyle = `rgba(244, 63, 94, ${alpha})`
      ctx.font = '10px serif'
      ctx.fillText('❤️', tagX + tagW / 2 - 4, heartY)
    }

    ctx.restore()
  }

  public static getDefaultPetName(type: string): string {
    switch (type) {
      case 'meowth':
        return 'Meowth'
      default:
        return 'Pet'
    }
  }

  public static bakeBuiltinPetFrames(_petType?: PetType, _color?: string): Record<Direction, string> {
    return {
      down: '',
      up: '',
      left: '',
      right: '',
    }
  }
}
