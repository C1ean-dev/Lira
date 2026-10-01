import React, { useState } from 'react'
import { Shield, Users, Minimize2, X } from 'lucide-react'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { PeerManager } from '../p2p/PeerManager'
import { MediaManager } from '../media/MediaManager'
import { ScreenShareModal } from './ScreenShareModal'
import { GridParticipantTile, ParticipantData } from './grid/GridParticipantTile'
import { FullScreenLiveOverlay } from './grid/FullScreenLiveOverlay'
import { CallControlsBar } from './grid/CallControlsBar'
import { ParticipantContextMenu } from './grid/ParticipantContextMenu'

/**
 * Outer gate: subscribes ONLY to isGridCallOpen so 60Hz position updates
 * don't re-render the conference grid while it's closed (the common case).
 */
export const FullScreenGrid: React.FC = () => {
  const isGridCallOpen = useMediaStore((s) => s.isGridCallOpen)
  if (!isGridCallOpen) return null
  return <FullScreenGridInner />
}

const FullScreenGridInner: React.FC = () => {
  // Granular media selectors — the VU level ticks at ~10Hz; only
  // localAudioLevel-driven props should update on those ticks.
  const setGridCallOpen = useMediaStore((s) => s.setGridCallOpen)
  const localStream = useMediaStore((s) => s.localStream)
  const localScreenStream = useMediaStore((s) => s.localScreenStream)
  const peerStreams = useMediaStore((s) => s.peerStreams)
  const peerScreenStreams = useMediaStore((s) => s.peerScreenStreams)
  const isMuted = useMediaStore((s) => s.isMuted)
  const isDeafened = useMediaStore((s) => s.isDeafened)
  const isCameraOff = useMediaStore((s) => s.isCameraOff)
  const isScreenSharing = useMediaStore((s) => s.isScreenSharing)
  const localAudioLevel = useMediaStore((s) => s.localAudioLevel)

  const { localPlayer, remotePlayers, callStates } = useGameStore()
  const { mapData } = useMapStore()

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false)
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null)
  const [liveTheaterUser, setLiveTheaterUser] = useState<ParticipantData | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [contextMenuState, setContextMenuState] = useState<{
    user: ParticipantData
    x: number
    y: number
  } | null>(null)

  const adminNotice = useMediaStore((s) => s.adminNotice)
  const setAdminNotice = useMediaStore((s) => s.setAdminNotice)

  // Auto-dismiss admin notice after 6 seconds
  React.useEffect(() => {
    if (adminNotice) {
      const timer = setTimeout(() => {
        setAdminNotice(null)
      }, 6000)
      return () => clearTimeout(timer)
    }
  }, [adminNotice, setAdminNotice])

  const handleParticipantContextMenu = (user: ParticipantData, e: React.MouseEvent) => {
    setContextMenuState({ user, x: e.clientX, y: e.clientY })
  }

  const currentZone = mapData.zones.find((z) => z.id === localPlayer.currentZoneId)
  const zoneTitle = currentZone?.name || 'Revisão & Call de Time'

  // Memoized so a VU-meter tick (10Hz) that doesn't change speaking state
  // keeps every tile's `user` prop identity stable (no cascade re-render).
  const isLocalSpeaking = localAudioLevel > 0.15 && !isMuted
  const allInMeeting: ParticipantData[] = React.useMemo(() => {
    const peersInSameZone = Object.values(remotePlayers).filter(
      (p) => p.currentZoneId === localPlayer.currentZoneId
    )
    return [
      {
        id: localPlayer.id,
        gameId: localPlayer.gameId || localPlayer.id,
        name: localPlayer.name,
        stream: localStream,
        screenStream: localScreenStream,
        isMuted,
        isMutedByAdmin: localPlayer.isMutedByAdmin,
        isDeafened: isDeafened,
        isCameraOff,
        isLocal: true,
        isScreenSharing: localPlayer.isScreenSharing,
        isSpeaking: isLocalSpeaking,
        shirtColor: localPlayer.avatar.shirtColor,
        statusEmoji: localPlayer.statusEmoji,
      },
      ...peersInSameZone.map((p) => ({
        id: p.id,
        gameId: p.gameId || p.id,
        name: p.name,
        stream: peerStreams[p.id] || null,
        screenStream: peerScreenStreams[p.id] || (p.isScreenSharing ? peerStreams[p.id] : null),
        isMuted: p.isMuted,
        isMutedByAdmin: p.isMutedByAdmin,
        isDeafened: p.isDeafened,
        isCameraOff: p.isCameraOff,
        isLocal: false,
        isScreenSharing: p.isScreenSharing,
        isSpeaking: false,
        shirtColor: p.avatar.shirtColor,
        statusEmoji: p.statusEmoji,
        callState: callStates[p.id] || p.callState || 'idle',
        onRetryCall: () => PeerManager.getInstance().retryZoneCall(p.id),
      })),
    ]
  }, [
    remotePlayers,
    localPlayer,
    localStream,
    localScreenStream,
    peerStreams,
    peerScreenStreams,
    isMuted,
    isDeafened,
    isCameraOff,
    isLocalSpeaking,
    callStates,
  ])

  // If someone is screen sharing and no one is explicitly focused, default focus to the active screen share
  const activePresenter = allInMeeting.find((u) => u.screenStream || u.isScreenSharing)
  const focusedUser = focusedUserId
    ? allInMeeting.find((u) => u.id === focusedUserId)
    : activePresenter || (allInMeeting.length > 0 ? allInMeeting[0] : null)

  const handleToggleScreenShare = async () => {
    setIsScreenModalOpen(true)
  }

  const otherParticipants = allInMeeting.filter((u) => u.id !== focusedUser?.id)

  return (
    <>
      <div className="fixed inset-0 z-50 bg-[#0c0e14] flex flex-col justify-between p-3 select-none animate-in fade-in duration-200">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#12151d]/90 backdrop-blur-md rounded-2xl border border-[#2a3142] shrink-0 mb-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <h1 className="text-sm font-bold text-slate-100">{zoneTitle}</h1>
            </div>
            <span className="text-xs bg-[#1b202c] border border-[#2a3142] text-slate-400 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-emerald-400" />
              Espaço Criptografado & Isolado
            </span>
          </div>

          {/* Admin Moderation Notice Alert */}
          {adminNotice && (
            <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded-xl text-xs font-semibold animate-in fade-in slide-in-from-top-2 duration-150">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>{adminNotice.message}</span>
              <button
                onClick={() => setAdminNotice(null)}
                className="p-0.5 hover:bg-amber-500/30 rounded text-amber-300"
                title="Fechar aviso"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* Toggle Sidebar button */}
            {otherParticipants.length > 0 && (
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  isSidebarOpen
                    ? 'bg-indigo-600 text-white border-indigo-500'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`}
                title={isSidebarOpen ? 'Ocultar barra de participantes' : 'Exibir barra de participantes'}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Membros ({allInMeeting.length})</span>
              </button>
            )}

            <button
              onClick={() => setGridCallOpen(false)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
            >
              <Minimize2 className="w-4 h-4" />
              Voltar ao Mapa 2D
            </button>
          </div>
        </div>

        {/* Main Video Presentation Area with Maximize Live Size + Compact Right Sidebar */}
        <div className="flex-1 w-full h-[calc(100vh-140px)] flex gap-3 items-stretch overflow-hidden">
          {/* 1. Large Main Live / Video Stage (Fills Maximum Width & Height) */}
          <div className="flex-1 h-full min-w-0 bg-[#0c0e14] rounded-3xl overflow-hidden flex items-center justify-center">
            {focusedUser ? (
              <GridParticipantTile
                user={focusedUser}
                isFocused={true}
                isSidebar={false}
                onOpenLiveFullscreen={(u) => setLiveTheaterUser(u)}
                onContextMenu={handleParticipantContextMenu}
              />
            ) : (
              <div className="text-slate-400 text-sm">Nenhum participante conectado</div>
            )}
          </div>

          {/* 2. Compact Right-side Participants Rail */}
          {isSidebarOpen && otherParticipants.length > 0 && (
            <div className="w-44 lg:w-48 h-full bg-[#12151d]/70 backdrop-blur-md rounded-3xl border border-[#2a3142] p-2 flex flex-col gap-2 overflow-y-auto shrink-0 animate-in slide-in-from-right-4 duration-200">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1 py-0.5 flex items-center justify-between">
                <span>Participantes ({otherParticipants.length})</span>
              </div>

              {otherParticipants.map((otherUser) => (
                <GridParticipantTile
                  key={otherUser.id}
                  user={otherUser}
                  isFocused={false}
                  isSidebar={true}
                  onFocus={() => setFocusedUserId(otherUser.id)}
                  onOpenLiveFullscreen={(u) => setLiveTheaterUser(u)}
                  onContextMenu={handleParticipantContextMenu}
                />
              ))}
            </div>
          )}
        </div>

        {/* Bottom Controls Bar (Gather V2 Dock) */}
        <CallControlsBar
          onToggleScreenShare={handleToggleScreenShare}
          onLeaveCall={() => setGridCallOpen(false)}
        />
      </div>

      {/* Pure Fullscreen Live Stream Player */}
      {liveTheaterUser && (
        <FullScreenLiveOverlay
          user={liveTheaterUser}
          onClose={() => setLiveTheaterUser(null)}
        />
      )}

      {/* Screen Share Window Picker Modal */}
      <ScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
      />

      {/* Right-click Context Menu for Participants */}
      {contextMenuState && (
        <ParticipantContextMenu
          user={contextMenuState.user}
          x={contextMenuState.x}
          y={contextMenuState.y}
          onClose={() => setContextMenuState(null)}
        />
      )}
    </>
  )
}
