import React, { useEffect, useRef } from 'react'
import { Download, Dices } from 'lucide-react'
import { AvatarConfig, PresenceStatus } from '../../types/game'
import type { PlayerDetails } from '../../hooks/usePlayerDetails'
import { AvatarRenderer } from '../../engine/AvatarRenderer'
import { drawAvatarAuraPreview, drawAvatarStepsPreview } from '../../engine/avatarEffects'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import { PetState } from '../../engine/pet/PetManager'

interface Props {
  isOpen: boolean
  avatar: AvatarConfig
  name: string
  status?: PresenceStatus
  localPlayer: PlayerDetails
  onRandomize: () => void
  showNameTags?: boolean
  className?: string
  canvasWidth?: number
  canvasHeight?: number
}

export const AvatarPreviewCanvas: React.FC<Props> = ({
  isOpen,
  avatar,
  name,
  status,
  localPlayer,
  onRandomize,
  showNameTags = true,
  className,
  canvasWidth = 280,
  canvasHeight = 460,
}) => {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!isOpen || !previewCanvasRef.current) return
    const canvas = previewCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false
    let frameId: number

    const render = (tick: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const w = canvas.width
      const h = canvas.height

      ctx.fillStyle = '#e9ecef'
      ctx.fillRect(0, 0, w, h * 0.45)

      ctx.fillStyle = '#dee2e6'
      ctx.fillRect(w * 0.65, 12, w * 0.3, h * 0.35)
      ctx.strokeStyle = '#ced4da'
      ctx.lineWidth = 3
      ctx.strokeRect(w * 0.65, 12, w * 0.3, h * 0.35)
      ctx.strokeRect(w * 0.1, 12, w * 0.45, h * 0.35)

      ctx.fillStyle = '#adb5bd'
      ctx.fillRect(0, h * 0.45 - 3, w, 3)

      ctx.fillStyle = '#d3f9d8'
      ctx.fillRect(0, h * 0.45, w, h * 0.55)

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)'
      ctx.lineWidth = 1
      for (let x = 0; x < w; x += 28) {
        ctx.beginPath()
        ctx.moveTo(x, h * 0.45)
        ctx.lineTo(x, h)
        ctx.stroke()
      }

      ctx.save()
      ctx.translate(w / 2 - 56, h * 0.48)
      ctx.scale(3.5, 3.5)

      const tempPlayer = {
        ...localPlayer,
        lastUpdated: 0,
        name: name.trim() || localPlayer.name,
        status: status || localPlayer.status || 'available',
        avatar,
        direction: 'down' as const,
        isMoving: true,
        x: 0,
        y: 0,
      }

      drawAvatarStepsPreview(ctx, avatar, tick, 32)
      AvatarRenderer.drawPlayer(ctx, tempPlayer, true, tick, 32, showNameTags)
      drawAvatarAuraPreview(ctx, avatar, tick, 32)

      if (avatar.pet && avatar.pet.type !== 'none') {
        const previewPet: PetState = {
          playerId: 'preview',
          x: 0.85,
          y: 0.15,
          direction: 'down',
          isMoving: true,
          walkFrame: Math.floor(tick / 140) % 4,
          walkTick: tick / 140,
          history: [],
          idleTime: 0,
        }
        PetRenderer.drawPet(ctx, previewPet, avatar.pet, tick, showNameTags)
      }

      ctx.restore()

      frameId = requestAnimationFrame(render)
    }

    frameId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frameId)
  }, [isOpen, avatar, name, status, localPlayer, showNameTags])

  const handleDownloadPNG = () => {
    if (!previewCanvasRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.scale(4, 4)

    const tempPlayer = {
      ...localPlayer,
      lastUpdated: 0,
      avatar,
      direction: 'down' as const,
      isMoving: false,
      x: 0.5,
      y: 0.5,
    }

    AvatarRenderer.drawPlayer(ctx, tempPlayer, true, 0, 32, false)

    const link = document.createElement('a')
    link.download = `${localPlayer.name || 'avatar'}-lira-pixel.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className={className || "w-80 bg-lira-sidebar border-l border-lira-quiet relative flex items-center justify-center p-4 shrink-0 overflow-hidden"}>
      <div className="w-full h-full rounded-[12px] overflow-hidden relative border border-lira-rule">
        <canvas ref={previewCanvasRef} width={canvasWidth} height={canvasHeight} className="w-full h-full pixelated" />

        <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
          <button
            onClick={handleDownloadPNG}
            className="p-1.5 sm:p-2 rounded-[8px] bg-lira-surface hover:bg-lira-ground text-lira-ink hover:text-lira-accent border border-lira-rule hover:border-lira-accent transition-colors"
            title="Baixar Avatar em PNG"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={onRandomize}
          className="group absolute bottom-2.5 right-2.5 p-2 sm:p-2.5 rounded-[8px] bg-lira-surface hover:bg-lira-accent text-lira-accent hover:text-lira-ground border border-lira-rule hover:border-lira-accent transition-colors"
          title="Gerar Combinação Aleatória (Dados)"
        >
          <Dices className="w-4 h-4 sm:w-5 sm:h-5 text-lira-accent group-hover:text-lira-ground" />
        </button>
      </div>
    </div>
  )
}
