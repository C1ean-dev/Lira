import React, { useMemo } from 'react'
import { Lock, Loader2, CheckCircle2, XCircle, Hand } from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { PeerManager } from '../p2p/PeerManager'
import { RoomKnockRequest } from '../types/game'

export const DoorKnockPrompt: React.FC = () => {
  const localPlayer = useGameStore((s) => s.localPlayer)
  const zones = useMapStore((s) => s.mapData.zones || [])
  const isPeerAuthorizedForZone = useMapStore((s) => s.isPeerAuthorizedForZone)
  const myKnockStatus = useGameStore((s) => s.myKnockStatus)
  const setMyKnockStatus = useGameStore((s) => s.setMyKnockStatus)

  // Find if player is standing right outside a locked room
  const lockedZone = useMemo(() => {
    const px = localPlayer.x
    const py = localPlayer.y

    for (const zone of zones) {
      if (!zone.isLocked) continue

      // If already inside, skip
      if (localPlayer.currentZoneId === zone.id) continue

      const isAuth = isPeerAuthorizedForZone(zone.id, localPlayer.id, localPlayer.name)
      const currentStatus = myKnockStatus[zone.id] || 'idle'

      // If already authorized permanently (and not currently in 'approved' status awaiting entry), skip
      if (isAuth && currentStatus !== 'approved') continue

      const doorW = Math.min(zone.width * 0.38, 2.0)
      const doorStartX = zone.x + (zone.width - doorW) / 2
      const doorEndX = doorStartX + doorW
      const maxY = zone.y + zone.height

      // Check proximity in front of south entrance door
      const inFrontOfDoor =
        px >= doorStartX - 0.8 &&
        px <= doorEndX + 0.8 &&
        py >= maxY - 0.5 &&
        py <= maxY + 2.2

      // Check perimeter proximity (within 1.5 tiles outside the room walls)
      const nearPerimeter =
        px >= zone.x - 1.5 &&
        px <= zone.x + zone.width + 1.5 &&
        py >= zone.y - 1.5 &&
        py <= zone.y + zone.height + 1.8

      if (inFrontOfDoor || nearPerimeter) {
        return zone
      }
    }
    return null
  }, [
    localPlayer.x,
    localPlayer.y,
    localPlayer.currentZoneId,
    localPlayer.id,
    localPlayer.name,
    zones,
    isPeerAuthorizedForZone,
    myKnockStatus,
  ])

  // Security: If player is NOT authorized for lockedZone, they CANNOT have 'approved' status
  const isAuth = lockedZone
    ? isPeerAuthorizedForZone(lockedZone.id, localPlayer.id, localPlayer.name)
    : false
  const rawStatus = lockedZone ? myKnockStatus[lockedZone.id] || 'idle' : 'idle'
  const status = !isAuth && rawStatus === 'approved' ? 'idle' : rawStatus

  // Automatically reset stale 'approved' status if authorization was revoked by an admin
  React.useEffect(() => {
    if (lockedZone && !isAuth && myKnockStatus[lockedZone.id] === 'approved') {
      setMyKnockStatus(lockedZone.id, 'idle')
    }
  }, [lockedZone?.id, isAuth, myKnockStatus, setMyKnockStatus])

  if (!lockedZone) return null

  const handleKnock = () => {
    const req: RoomKnockRequest = {
      id: `knock-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      zoneId: lockedZone.id,
      zoneName: lockedZone.name,
      requesterId: localPlayer.id,
      requesterName: localPlayer.name,
      requesterAvatar: localPlayer.avatar,
      timestamp: Date.now(),
    }

    setMyKnockStatus(lockedZone.id, 'knocking')
    PeerManager.getInstance().sendRoomKnockRequest(req)
  }

  const handleReset = () => {
    setMyKnockStatus(lockedZone.id, 'idle')
  }

  const handleEnterApproved = () => {
    // Security check: Must be authorized to enter the room
    if (!isPeerAuthorizedForZone(lockedZone.id, localPlayer.id, localPlayer.name)) {
      setMyKnockStatus(lockedZone.id, 'idle')
      return
    }

    const targetX = Math.floor(lockedZone.x + lockedZone.width / 2)
    const targetY = Math.floor(lockedZone.y + lockedZone.height / 2)
    useGameStore.getState().setLocalPlayer({
      x: targetX,
      y: targetY,
      currentZoneId: lockedZone.id,
    })
    PeerManager.getInstance().sendPlayerUpdate({
      x: targetX,
      y: targetY,
      currentZoneId: lockedZone.id,
    })
    setMyKnockStatus(lockedZone.id, 'idle')
  }

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[75] flex flex-col items-center select-none pointer-events-auto animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div className="bg-[#12151d]/95 backdrop-blur-xl border border-amber-500/40 rounded-2xl px-5 py-3.5 shadow-2xl shadow-black/70 flex items-center gap-4 max-w-md">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
          <Lock className="w-5 h-5" />
        </div>

        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white truncate">
              {lockedZone.name}
            </span>
            <span className="text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
              Trancada
            </span>
          </div>

          <p className="text-xs text-slate-300 line-clamp-1">
            {status === 'idle' && 'Esta sala está trancada. Bata na porta para solicitar entrada.'}
            {status === 'knocking' && 'Batendo na porta... Aguardando autorização.'}
            {status === 'approved' && 'Entrada permitida! Você já pode entrar.'}
            {status === 'denied' && 'Entrada não autorizada pelos participantes.'}
          </p>
        </div>

        {/* Action Button */}
        <div className="shrink-0">
          {status === 'idle' && (
            <button
              onClick={handleKnock}
              className="py-2 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-600/30 active:scale-95"
            >
              <Hand className="w-4 h-4" />
              <span>Bater na Porta</span>
            </button>
          )}

          {status === 'knocking' && (
            <div className="flex items-center gap-2">
              <div className="py-2 px-3 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-medium flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Aguardando...</span>
              </div>
              <button
                onClick={handleReset}
                className="text-xs text-slate-400 hover:text-slate-200 underline px-1"
              >
                Cancelar
              </button>
            </div>
          )}

          {status === 'approved' && (
            <div className="flex items-center gap-2">
              <div className="py-2 px-3 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-400 text-xs font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>Liberado!</span>
              </div>
              <button
                onClick={handleEnterApproved}
                className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 transition-all shadow-lg shadow-emerald-600/30 active:scale-95"
              >
                <span>Entrar</span>
              </button>
            </div>
          )}

          {status === 'denied' && (
            <button
              onClick={handleReset}
              className="py-2 px-3 rounded-xl bg-rose-600/20 border border-rose-500/40 text-rose-300 hover:bg-rose-600/30 text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <XCircle className="w-4 h-4 text-rose-400" />
              <span>Tentar de novo</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
