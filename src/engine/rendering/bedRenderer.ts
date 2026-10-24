import { useBedStore } from '../../store/useBedStore'
import { getBedScene } from '../../services/bedInteraction'

export function renderBedParticipant(ctx: CanvasRenderingContext2D, playerId: string, draw: () => void) {
  for (const session of Object.values(useBedStore.getState().sessions)) {
    const scene = getBedScene(session.furnitureId)
    if (!scene?.participantIds.includes(playerId)) continue
    if (scene.coverProgress >= 1) return
    ctx.save()
    ctx.globalAlpha *= 1 - scene.coverProgress
    ctx.translate(0, scene.coverProgress * 8)
    draw()
    ctx.restore()
    return
  }
  draw()
}
