import React, { useEffect, useRef } from 'react'
import { Bell, Check, X, Lock } from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { PeerManager } from '../p2p/PeerManager'
import { RoomKnockRequest } from '../types/game'
import { sendNotification } from '../services/notificationService'
import { PlayerAvatar } from './common/PlayerAvatar'

export const DoorKnockNotification: React.FC = () => {
  const pendingKnocks = useGameStore((s) => s.pendingKnocks)
  const currentZoneId = useGameStore((s) => s.localPlayer.currentZoneId)
  const localPlayerName = useGameStore((s) => s.localPlayer.name)
  const removeKnockRequest = useGameStore((s) => s.removeKnockRequest)
  const authorizePeerInZone = useMapStore((s) => s.authorizePeerInZone)

  const lastSeenKnockId = useRef<string | null>(null)

  const activeKnocks = pendingKnocks.filter(
    (k) => k.zoneId === currentZoneId
  )

  useEffect(() => {
    if (activeKnocks.length > 0) {
      const newest = activeKnocks[activeKnocks.length - 1]
      if (newest.id !== lastSeenKnockId.current) {
        lastSeenKnockId.current = newest.id
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
      localPlayerName,
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
      localPlayerName
    )
    removeKnockRequest(knock.id)
  }

  return (
    <div className="fixed top-20 right-6 z-[80] flex flex-col gap-2.5 max-w-sm w-full pointer-events-auto select-none font-mono">
      {activeKnocks.map((knock) => (
        <div
          key={knock.id}
          className="bg-lira-panel border border-dashed border-lira-rule rounded-xl p-4 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lira-amber opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-lira-amber"></span>
              </span>
              <span className="text-xs font-display font-bold text-lira-amber flex items-center gap-1.5 uppercase tracking-wide">
                <span>🚪</span> Bateram na porta!
              </span>
            </div>
            <button
              onClick={() => handleDeny(knock)}
              className="text-lira-muted hover:text-lira-ink p-1 rounded-lg hover:bg-lira-surface transition-colors"
              title="Ignorar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-3 bg-lira-surface p-2.5 rounded-lg border border-lira-quiet">
            <PlayerAvatar
              name={knock.requesterName}
              profilePicture={knock.requesterProfilePicture}
              avatar={knock.requesterAvatar}
              size="lg"
            />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-display font-bold text-lira-ink truncate">
                {knock.requesterName}
              </span>
              <span className="text-xs text-lira-muted truncate flex items-center gap-1">
                pedindo para entrar em <span className="text-lira-accent font-medium">{knock.zoneName}</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDeny(knock)}
              className="flex-1 py-2 px-3 rounded-lg bg-lira-ground hover:bg-lira-error/15 text-lira-ink hover:text-lira-error text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-lira-rule hover:border-lira-error/50"
            >
              <X className="w-3.5 h-3.5 text-lira-error" />
              <span>Recusar</span>
            </button>
            <button
              onClick={() => handleApprove(knock)}
              className="flex-1 py-2 px-3 rounded-lg bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
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
