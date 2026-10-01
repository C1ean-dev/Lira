import React, { useEffect, useRef } from 'react'
import { Download, Dices } from 'lucide-react'
import { AvatarConfig, Player, PresenceStatus } from '../../types/game'
import { AvatarRenderer } from '../../engine/AvatarRenderer'
import { PetRenderer } from '../../engine/pet/PetRenderer'
import { PetState } from '../../engine/pet/PetManager'

interface Props {
  isOpen: boolean
  avatar: AvatarConfig
  name: string
  status?: PresenceStatus
  localPlayer: Player
  onRandomize: () => void
  showNameTags?: boolean
}

export const AvatarPreviewCanvas: React.FC<Props> = ({
  isOpen,
  avatar,
  name,
  status,
  localPlayer,
  onRandomize,
  showNameTags = true,
}) => {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Live Canvas Preview Animation with Room Background
  useEffect(() => {
    if (!isOpen || !previewCanvasRef.current) return
    const canvas = previewCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.imageSmoothingEnabled = false
    let frameId: number

    const render = (tick: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // 1. Draw Aesthetic Gather Pastel Room Background (Floor, Wall, Baseboard)
      const w = canvas.width
      const h = canvas.height

      // Top Wall
      ctx.fillStyle = '#e9ecef'
      ctx.fillRect(0, 0, w, h * 0.45)

      // Window / Wall trim
      ctx.fillStyle = '#dee2e6'
      ctx.fillRect(w * 0.65, 12, w * 0.3, h * 0.35)
      ctx.strokeStyle = '#ced4da'
      ctx.lineWidth = 3
      ctx.strokeRect(w * 0.65, 12, w * 0.3, h * 0.35)
      ctx.strokeRect(w * 0.1, 12, w * 0.45, h * 0.35)

      // Baseboard Trim
      ctx.fillStyle = '#adb5bd'
      ctx.fillRect(0, h * 0.45 - 3, w, 3)

      // Bottom Floor (Pastel Greenish Mint Floor)
      ctx.fillStyle = '#d3f9d8'
      ctx.fillRect(0, h * 0.45, w, h * 0.55)

      // Subtle Floor Grid Lines
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)'
      ctx.lineWidth = 1
      for (let x = 0; x < w; x += 28) {
        ctx.beginPath()
        ctx.moveTo(x, h * 0.45)
        ctx.lineTo(x, h)
        ctx.stroke()
      }

      // 2. Render Scaled Character in Room Center with smooth Idle / Walk loop
      ctx.save()
      ctx.translate(w / 2 - 56, h * 0.48)
      ctx.scale(3.5, 3.5)

      const tempPlayer = {
        ...localPlayer,
        name: name.trim() || localPlayer.name,
        status: status || localPlayer.status || 'available',
        avatar,
        direction: 'down' as const,
        isMoving: true,
        x: 0,
        y: 0,
      }

      AvatarRenderer.drawPlayer(ctx, tempPlayer, true, tick, 32, showNameTags)

      // Draw companion pet beside avatar if equipped
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

  // Export / Download PNG of Avatar
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
      avatar,
      direction: 'down' as const,
      isMoving: false,
      x: 0.5,
      y: 0.5,
    }

    AvatarRenderer.drawPlayer(ctx, tempPlayer, true, 0, 32, false)

    const link = document.createElement('a')
    link.download = `${localPlayer.name || 'avatar'}-gather-pixel.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  return (
    <div className="w-80 bg-[#1e1f22] border-l border-[#2b2d31] relative flex items-center justify-center p-4 shrink-0 overflow-hidden">
      {/* Live 2D Canvas Stage */}
      <div className="w-full h-full rounded-2xl overflow-hidden shadow-2xl relative border border-[#2b2d31]">
        <canvas ref={previewCanvasRef} width={280} height={460} className="w-full h-full pixelated" />

        {/* Floating Top-Right Action Buttons */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          <button
            onClick={handleDownloadPNG}
            className="p-2 rounded-xl bg-[#18191c]/90 hover:bg-[#18191c] text-slate-300 hover:text-white border border-[#2b2d31] backdrop-blur-md shadow-lg transition-all active:scale-95"
            title="Baixar Avatar em PNG"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>

        {/* Floating Bottom-Right Randomize (Dice) Button */}
        <button
          onClick={onRandomize}
          className="absolute bottom-3 right-3 p-3 rounded-2xl bg-[#18191c]/90 hover:bg-[#3b82f6] text-slate-300 hover:text-white border border-[#2b2d31] backdrop-blur-md shadow-xl transition-all hover:rotate-12 active:scale-95"
          title="Gerar Combinação Aleatória (Dados)"
        >
          <Dices className="w-5 h-5 text-indigo-400 group-hover:text-white" />
        </button>
      </div>
    </div>
  )
}
