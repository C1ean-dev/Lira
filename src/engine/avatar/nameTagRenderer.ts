import { Player, STATUS_META } from '../../types/game'
import { useGameStore } from '../../store/useGameStore'
import { getStatusIconImage } from './statusIcons'

const textWidthCache = new Map<string, number>()

function measureLabelWidth(
  ctx: CanvasRenderingContext2D,
  label: string,
  font: string
): number {
  const cached = textWidthCache.get(label)
  if (cached !== undefined) return cached
  ctx.font = font
  const w = ctx.measureText(label).width
  if (textWidthCache.size > 500) textWidthCache.clear()
  textWidthCache.set(label, w)
  return w
}

export class NameTagRenderer {
  static drawNameTag(
    ctx: CanvasRenderingContext2D,
    player: Player,
    isLocal: boolean,
    centerX: number,
    tagY: number
  ) {
    const callState =
      (player.id && useGameStore.getState().callStates[player.id]) || player.callState || 'idle'
    const isConnecting = callState === 'connecting'

    const baseLabel = player.name || 'Player'
    const label = isConnecting ? `${baseLabel} •••` : baseLabel

    const font = 'bold 7.5px Inter, sans-serif'
    const textW = measureLabelWidth(ctx, label, font)
    ctx.font = font
    const pillW = textW + 18
    const pillH = 13
    const pillX = centerX - pillW / 2
    const pillY = tagY - pillH + 2

    ctx.fillStyle = isLocal ? 'rgba(15, 23, 42, 0.92)' : 'rgba(27, 32, 44, 0.90)'
    ctx.beginPath()
    ctx.roundRect(pillX, pillY, pillW, pillH, 6.5)
    ctx.fill()

    ctx.strokeStyle = isLocal
      ? '#38bdf8'
      : isConnecting
        ? '#f59e0b'
        : '#334155'
    ctx.lineWidth = 1.0
    ctx.stroke()

    const iconX = pillX + 7
    const iconY = pillY + pillH / 2
    const iconRadius = 4.5
    const statusIcon = isConnecting ? null : getStatusIconImage(player.status || 'available')

    if (statusIcon) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(iconX, iconY, iconRadius, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(statusIcon, iconX - iconRadius, iconY - iconRadius, iconRadius * 2, iconRadius * 2)
      ctx.restore()
    } else {
      let statusColor: string
      if (isConnecting) {
        const t = (Date.now() % 900) / 900
        const pulse = 0.45 + Math.abs(Math.sin(t * Math.PI)) * 0.55
        ctx.globalAlpha = pulse
        statusColor = '#f59e0b'
      } else {
        statusColor = STATUS_META[player.status || 'available']?.hexColor || '#22c55e'
      }
      ctx.fillStyle = statusColor
      ctx.beginPath()
      ctx.arc(iconX, iconY, 2.2, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }

    ctx.fillStyle = isConnecting ? '#fde68a' : '#ffffff'
    ctx.fillText(label, pillX + 13.5, pillY + 9.2)

    if (player.status === 'away' || player.statusEmoji === '💤') {
      const now = Date.now()
      const zzzChars = ['z', 'Z', 'z']
      ctx.save()
      zzzChars.forEach((char, i) => {
        const progress = ((now / 1400) + i * 0.33) % 1
        const alpha = Math.sin(progress * Math.PI)
        const yOffset = -progress * 16 - 2
        const xOffset = Math.sin(progress * Math.PI * 2) * 2.5 + (i * 3.5) + (pillW / 2 - 4)
        const size = 6 + i * 1.5

        ctx.font = `bold ${size}px "Inter", sans-serif`
        ctx.fillStyle = `rgba(199, 210, 254, ${Math.max(0, alpha * 0.95)})`
        ctx.shadowColor = 'rgba(99, 102, 241, 0.7)'
        ctx.shadowBlur = 3
        ctx.fillText(char, pillX + xOffset, pillY + yOffset)
      })
      ctx.restore()
    }
  }
}
