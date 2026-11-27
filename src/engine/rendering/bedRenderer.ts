import { useBedStore } from '../../store/useBedStore'
import { getBedScene } from '../../services/bedInteraction'

export interface BedParticipantTransform {
  hidden: boolean
  alpha: number
  offsetY: number
}

export function getBedParticipantTransform(playerId: string): BedParticipantTransform {
  for (const session of Object.values(useBedStore.getState().sessions)) {
    const scene = getBedScene(session.furnitureId)
    if (!scene?.participantIds.includes(playerId)) continue
    if (scene.coverProgress >= 1) {
      return { hidden: true, alpha: 0, offsetY: 8 }
    }
    return {
      hidden: false,
      alpha: 1 - scene.coverProgress,
      offsetY: scene.coverProgress * 8,
    }
  }
  return { hidden: false, alpha: 1, offsetY: 0 }
}

export function renderBedParticipant(ctx: CanvasRenderingContext2D, playerId: string, draw: () => void) {
  const transform = getBedParticipantTransform(playerId)
  if (transform.hidden) return
  if (transform.alpha === 1 && transform.offsetY === 0) {
    draw()
    return
  }
  ctx.save()
  ctx.globalAlpha *= transform.alpha
  ctx.translate(0, transform.offsetY)
  draw()
  ctx.restore()
}
