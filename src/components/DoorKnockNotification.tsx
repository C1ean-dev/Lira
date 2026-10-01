import React, { useEffect, useRef } from 'react'
import { Bell, Check, X, Lock } from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { PeerManager } from '../p2p/PeerManager'
import { RoomKnockRequest } from '../types/game'
import { sendNotification } from '../services/notificationService'

function playKnockSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()

    const playTap = (time: number, freq: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, time)
      osc.frequency.exponentialRampToValueAtTime(70, time + 0.08)
      gain.gain.setValueAtTime(0.25, time)
      gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(time)
      osc.stop(time + 0.09)
    }

    const now = ctx.currentTime
    playTap(now, 190)
    playTap(now + 0.13, 160)

    setTimeout(() => {
      ctx.close().catch(() => {})
    }, 300)
  } catch (e) {
    // Ignore audio context autoplay restrictions
  }
}

export const DoorKnockNotification: React.FC = () => {
  const pendingKnocks = useGameStore((s) => s.pendingKnocks)
  const localPlayer = useGameStore((s) => s.localPlayer)
  const removeKnockRequest = useGameStore((s) => s.removeKnockRequest)
  const authorizePeerInZone = useMapStore((s) => s.authorizePeerInZone)

  const lastSeenKnockId = useRef<string | null>(null)

  // Filter knocks for the zone the local player is currently in
  const activeKnocks = pendingKnocks.filter(
    (k) => k.zoneId === localPlayer.currentZoneId
  )

  useEffect(() => {
    if (activeKnocks.length > 0) {
      const newest = activeKnocks[activeKnocks.length - 1]
      if (newest.id !== lastSeenKnockId.current) {
        lastSeenKnockId.current = newest.id
        playKnockSound()
        sendNotification({
          title: 'Batida na Porta - Lira',
          body: `${newest.requesterName} está pedindo para entrar em "${newest.zoneName}".`,
          soundType: 'knock',
          tag: `knock-${newest.id}`,
          actions: [{ type: 'button', text: 'Permitir' }],
          onAction: (idx) => {
            if (idx === 0) {
              handleApprove(newest)
            }
          },
        })
      }
    }
  }, [activeKnocks])

  if (activeKnocks.length === 0) return null

  const handleApprove = (knock: RoomKnockRequest) => {
    PeerManager.getInstance().sendRoomKnockResponse(
      knock.zoneId,
      knock.requesterId,
      true,
      localPlayer.name,
      knock.requesterName
    )
    authorizePeerInZone(knock.zoneId, knock.requesterId, knock.requesterName)
    removeKnockRequest(knock.id)
  }

  const handleDeny = (knock: RoomKnockRequest) => {
    PeerManager.getInstance().sendRoomKnockResponse(
      knock.zoneId,
      knock.requesterId,
      false,
      localPlayer.name
    )
    removeKnockRequest(knock.id)
  }

  return (
    <div className="fixed top-20 right-6 z-[80] flex flex-col gap-2.5 max-w-sm w-full pointer-events-auto select-none animate-in fade-in slide-in-from-top-4 duration-200">
      {activeKnocks.map((knock) => (
        <div
          key={knock.id}
          className="bg-[#12151d]/95 backdrop-blur-xl border border-indigo-500/40 rounded-2xl p-4 shadow-2xl shadow-indigo-950/50 flex flex-col gap-3"
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
              </span>
              <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5 uppercase tracking-wide">
                <span>🚪</span> Bateram na porta!
              </span>
            </div>
            <button
              onClick={() => handleDeny(knock)}
              className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
              title="Ignorar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* User Info */}
          <div className="flex items-center gap-3 bg-[#1b202c]/80 p-2.5 rounded-xl border border-[#2a3142]">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-base shadow-inner shrink-0"
              style={{
                backgroundColor:
                  knock.requesterAvatar?.shirtColor || '#4f46e5',
              }}
            >
              {knock.requesterName.charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-bold text-white truncate">
                {knock.requesterName}
              </span>
              <span className="text-xs text-slate-400 truncate flex items-center gap-1">
                pedindo para entrar em <span className="text-indigo-300 font-medium">{knock.zoneName}</span>
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDeny(knock)}
              className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-slate-700"
            >
              <X className="w-3.5 h-3.5 text-rose-400" />
              <span>Recusar</span>
            </button>
            <button
              onClick={() => handleApprove(knock)}
              className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-lg shadow-emerald-600/30"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Permitir</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
