import { PrivateZone } from '../../types/map'
import { TILE_SIZE } from '../Constants'

export class ZoneRenderer {
  static drawPrivateZone(ctx: CanvasRenderingContext2D, zone: PrivateZone, isCurrent: boolean = false) {
    const px = Math.floor(zone.x * TILE_SIZE)
    const py = Math.floor(zone.y * TILE_SIZE)
    const w = zone.width * TILE_SIZE
    const h = zone.height * TILE_SIZE

    ctx.save()

    ctx.fillStyle = zone.color
      ? `${zone.color}${isCurrent ? '28' : '10'}`
      : isCurrent
      ? 'rgba(76, 110, 245, 0.20)'
      : 'rgba(76, 110, 245, 0.07)'
    ctx.fillRect(px, py, w, h)

    ctx.strokeStyle = zone.color || '#4c6ef5'
    ctx.lineWidth = isCurrent ? 2.5 : 1.5
    ctx.setLineDash([6, 4])
    ctx.strokeRect(px + 1, py + 1, w - 2, h - 2)

    ctx.setLineDash([])
    const label = zone.name.toUpperCase()
    ctx.font = 'bold 9px sans-serif'
    const textWidth = ctx.measureText(label).width

    ctx.fillStyle = zone.color || '#4c6ef5'
    ctx.beginPath()
    ctx.roundRect(px + 4, py + 4, textWidth + 12, 16, 4)
    ctx.fill()

    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, px + 10, py + 15)

    ctx.restore()
  }
}
