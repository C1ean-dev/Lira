import { CollaborationButtons } from './collaboration/CollaborationButtons'
import React, { useState } from 'react'
import { Users, Minimize2, X, Radio, FileText } from 'lucide-react'
import { useSecurityStore, aggregatePeersSecurity } from '../store/useSecurityStore'
import { SecurityBadge } from './security/SecurityBadge'
import { useSpaceTranscription } from '../hooks/useSpaceTranscription'
import { CallTranscriptPanel } from './grid/CallTranscriptPanel'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { SpotifyIcon } from './common/SpotifyIcon'
import { PetApiSettings } from './pets/PetApiSettings'
import { useLiveWatchStore } from '../store/useLiveWatchStore'
import { PeerManager } from '../p2p/PeerManager'
import { MediaManager } from '../media/MediaManager'
import { ScreenShareModal } from './ScreenShareModal'
import { GridParticipantTile, ParticipantData } from './grid/GridParticipantTile'
import { FullScreenLiveOverlay } from './grid/FullScreenLiveOverlay'
import { CallControlsBar } from './grid/CallControlsBar'
import { ParticipantContextMenu } from './grid/ParticipantContextMenu'

export const FullScreenGrid: React.FC = () => {
  const isGridCallOpen = useMediaStore((s) => s.isGridCallOpen)
  if (!isGridCallOpen) return null
  return <FullScreenGridInner />
}

const FullScreenGridInner: React.FC = () => {
  const setGridCallOpen = useMediaStore((s) => s.setGridCallOpen)
  const localStream = useMediaStore((s) => s.localStream)
  const localScreenStream = useMediaStore((s) => s.localScreenStream)
  const peerStreams = useMediaStore((s) => s.peerStreams)
  const peerVoiceStreams = useMediaStore((s) => s.peerVoiceStreams)
  const peerScreenStreams = useMediaStore((s) => s.peerScreenStreams)
  const isMuted = useMediaStore((s) => s.isMuted)
  const isDeafened = useMediaStore((s) => s.isDeafened)
  const isCameraOff = useMediaStore((s) => s.isCameraOff)
  const isScreenSharing = useMediaStore((s) => s.isScreenSharing)
  const localAudioLevel = useMediaStore((s) => s.localAudioLevel)

  const { localPlayer, remotePlayers, callStates, friendProfiles, roomId, isOwner, proximityPeerIds } = useGameStore()
  const { mapData } = useMapStore()
  const watchingLives = useLiveWatchStore((s) => s.watching)
  const jamsByZone = useSpotifyJamStore((s) => s.jamsByZone)
  const setSpotifyJamModalOpen = useSpotifyJamStore((s) => s.setModalOpen)
  const activeZoneJam = localPlayer.currentZoneId ? jamsByZone[localPlayer.currentZoneId] : null
  const isJamActive = !!activeZoneJam?.isActive

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false)
  const [focusedUserId, setFocusedUserId] = useState<string | null>(null)
  const [liveTheaterUser, setLiveTheaterUser] = useState<ParticipantData | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false)
  const [contextMenuState, setContextMenuState] = useState<{
    user: ParticipantData
    x: number
    y: number
  } | null>(null)

  const adminNotice = useMediaStore((s) => s.adminNotice)
  const setAdminNotice = useMediaStore((s) => s.setAdminNotice)
  const securityPeers = useSecurityStore((s) => s.peers)
  const openSecurityInspection = useSecurityStore((s) => s.openInspection)

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

  const isProximityCall = !localPlayer.currentZoneId && proximityPeerIds.length > 0
  const currentZone = localPlayer.currentZoneId ? mapData.zones.find((z) => z.id === localPlayer.currentZoneId) : undefined
  const activeHouseName = localPlayer.currentHouseId ? mapData.houseInteriors?.[localPlayer.currentHouseId]?.name : undefined
  const zoneTitle = isProximityCall ? 'Proximidade · Corredor Geral' : currentZone?.name || activeHouseName || 'Revisão & Call de Time'

  const isLocalSpeaking = localAudioLevel > 0.15 && !isMuted
  const allInMeeting: ParticipantData[] = React.useMemo(() => {
    const proximitySet = new Set(proximityPeerIds)
    const peersInSameZone = Object.values(remotePlayers).filter(
      (p) =>
        !p.isDjBot &&
        !p.id.startsWith('dj-') &&
        (localPlayer.currentZoneId ? p.currentZoneId === localPlayer.currentZoneId : proximitySet.has(p.id))
    )
    return [
      {
        id: localPlayer.id,
        gameId: localPlayer.gameId || localPlayer.id,
        name: localPlayer.name,
        profilePicture: localPlayer.profilePicture,
        avatar: localPlayer.avatar,
        profile: localPlayer.profile,
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
      ...peersInSameZone.map((p) => {
        const fp = friendProfiles[p.id] || (p.gameId ? friendProfiles[p.gameId] : undefined)
        const resolvedPic = p.profilePicture || fp?.profilePicture
        const resolvedAvatar = p.avatar || fp?.avatar
        const resolvedProfile = p.profile || fp?.profile

        return {
          id: p.id,
          gameId: p.gameId || p.id,
          name: p.name,
          profilePicture: resolvedPic,
          avatar: resolvedAvatar,
          profile: resolvedProfile,
          stream: p.isScreenSharing ? peerVoiceStreams[p.id] || null : peerStreams[p.id] || null,
          screenStream: peerScreenStreams[p.id] || (p.isScreenSharing ? peerStreams[p.id] : null),
          isMuted: p.isMuted,
          isMutedByAdmin: p.isMutedByAdmin,
          isDeafened: p.isDeafened,
          isCameraOff: p.isCameraOff ?? true,
          isLocal: false,
          isScreenSharing: p.isScreenSharing,
          isSpeaking: false,
          isDjBot: Boolean(p.isDjBot || p.id.startsWith('dj-') || p.name.includes('DJ')),
          shirtColor: resolvedAvatar?.shirtColor || '#3b82f6',
          statusEmoji: p.statusEmoji,
          callState: callStates[p.id] || p.callState || 'idle',
          onRetryCall: () => PeerManager.getInstance().retryZoneCall(p.id),
          liveOptIn: p.liveOptIn,
          liveWatching: !!watchingLives[p.id],
        }
      }),
    ]
  }, [
    remotePlayers,
    localPlayer,
    friendProfiles,
    localStream,
    localScreenStream,
    peerStreams,
    peerVoiceStreams,
    peerScreenStreams,
    isMuted,
    isDeafened,
    isCameraOff,
    isLocalSpeaking,
    callStates,
    watchingLives,
  ])

  const activePresenter =
    allInMeeting.find((u) => (u.screenStream || u.isScreenSharing) && u.liveWatching) ||
    allInMeeting.find((u) => u.screenStream || u.isScreenSharing)
  const transcription = useSpaceTranscription()
  const focusedUser = focusedUserId
    ? allInMeeting.find((u) => u.id === focusedUserId)
    : activePresenter || (allInMeeting.length > 0 ? allInMeeting[0] : null)

  const handleToggleScreenShare = async () => {
    setIsScreenModalOpen(true)
  }

  const isLiveFocused = Boolean(focusedUser?.screenStream || focusedUser?.isScreenSharing)
  const otherParticipants = isLiveFocused
    ? allInMeeting
    : allInMeeting.filter((u) => u.id !== focusedUser?.id)

  const theaterUser = liveTheaterUser
    ? allInMeeting.find((u) => u.id === liveTheaterUser.id && u.isScreenSharing)
    : null

  const callSecurity = aggregatePeersSecurity(
    securityPeers,
    allInMeeting
      .filter((p) => !p.isLocal && !p.isDjBot)
      .map((p) => ({ id: p.id, gameId: p.gameId, name: p.name }))
  )

  React.useEffect(() => {
    if (liveTheaterUser && !theaterUser) setLiveTheaterUser(null)
  }, [liveTheaterUser, theaterUser])

  return (
    <>
      <div role="region" aria-label="Chamada da sala" className="fixed top-0 right-0 bottom-0 left-[var(--rail-width)] z-50 bg-lira-ground flex flex-col justify-between p-3 select-none font-mono">
        <div className="flex items-center justify-between px-4 py-2 bg-lira-panel rounded-[12px] border border-dashed border-lira-rule shrink-0 mb-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-lira-online animate-pulse" />
              <h1 className="font-display text-base font-bold text-lira-accent">{zoneTitle}</h1>
            </div>
            <SecurityBadge
              status={callSecurity.status}
              mediaEncrypted={callSecurity.mediaEncryptedCount > 0}
              labelOverride={
                callSecurity.status === 'verified'
                  ? 'E2EE Verificado'
                  : callSecurity.status === 'encrypted'
                  ? callSecurity.mediaEncryptedCount > 0
                    ? 'E2EE Mídia Ativa'
                    : 'E2EE Ativo'
                  : callSecurity.status === 'idle'
                  ? 'E2EE Pronto'
                  : undefined
              }
              onClick={() =>
                openSecurityInspection(
                  callSecurity.primaryPeer ?? {
                    peerId: localPlayer.id,
                    displayName: zoneTitle,
                  }
                )
              }
            />
          </div>

          {adminNotice && (
            <div className="flex items-center gap-2 px-3 py-1 bg-lira-amber/15 border border-lira-amber/40 text-lira-amber rounded-[8px] text-xs font-mono font-semibold">
              <span className="w-2 h-2 rounded-full bg-lira-amber animate-ping" />
              <span>{adminNotice.message}</span>
              <button
                onClick={() => setAdminNotice(null)}
                className="p-0.5 hover:bg-lira-amber/25 rounded-[4px] text-lira-amber"
                title="Fechar aviso"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {otherParticipants.length > 0 && (
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-mono font-semibold border transition-colors ${
                  isSidebarOpen
                    ? 'bg-lira-accent text-lira-ground border-lira-accent'
                    : 'bg-lira-surface text-lira-ink border-lira-rule hover:border-lira-accent hover:text-lira-accent'
                }`}
                title={isSidebarOpen ? 'Ocultar barra de participantes' : 'Exibir barra de participantes'}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Membros ({allInMeeting.length})</span>
              </button>
            )}

            {localPlayer.currentZoneId && (
              <button
                onClick={() => setSpotifyJamModalOpen(true, localPlayer.currentZoneId)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-mono font-semibold border transition-colors ${
                  isJamActive
                    ? 'bg-lira-online/15 text-lira-online border-lira-online/40 hover:bg-lira-online/25'
                    : 'bg-lira-surface text-lira-ink border-lira-rule hover:border-lira-online hover:text-lira-online'
                }`}
                title={
                  isJamActive
                    ? `Spotify Jam ativo: ${activeZoneJam?.zoneName || zoneTitle}`
                    : 'Spotify Jam nesta sala'
                }
              >
                <SpotifyIcon size={14} className={`w-3.5 h-3.5 ${isJamActive ? 'text-lira-online animate-pulse' : 'text-lira-muted'}`} />
                <span>Jam</span>
                {isJamActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-lira-online animate-ping" />
                )}
              </button>
            )}

            {localPlayer.currentZoneId && roomId && isOwner && <PetApiSettings roomId={roomId} />}
            <button type="button"
              onClick={() => setIsTranscriptOpen(open => !open)}
              disabled={!transcription}
              aria-expanded={isTranscriptOpen}
              aria-controls="call-transcript"
              title="Transcrição da chamada por participante"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-mono font-semibold border transition-colors ${isTranscriptOpen ? 'bg-lira-accent text-lira-ground border-lira-accent' : 'bg-lira-surface text-lira-ink border-lira-rule hover:border-lira-accent hover:text-lira-accent'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Transcrição</span>
              {transcription?.status === 'recording' && <span aria-label="Transcrição ativa" className="w-1.5 h-1.5 rounded-full bg-lira-online animate-pulse" />}
            </button>

            <CollaborationButtons />
            <button
              onClick={() => setGridCallOpen(false)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-[8px] bg-lira-surface border border-lira-rule hover:border-lira-accent hover:text-lira-accent text-xs font-mono font-semibold text-lira-ink transition-colors"
            >
              <Minimize2 className="w-4 h-4" />
              Voltar ao Mapa 2D
            </button>
          </div>
        </div>

        <div className="flex-1 w-full h-[calc(100vh-140px)] flex gap-3 items-stretch overflow-hidden">
          <div className="flex-1 h-full min-w-0 bg-lira-ground rounded-[12px] overflow-hidden flex items-center justify-center">
            {focusedUser ? (
              <GridParticipantTile
                user={focusedUser}
                isFocused={true}
                isSidebar={false}
                onOpenLiveFullscreen={(u) => setLiveTheaterUser(u)}
                onOpenScreenShareSettings={() => setIsScreenModalOpen(true)}
                onContextMenu={handleParticipantContextMenu}
              />
            ) : (
              <div className="text-lira-muted text-sm font-mono">Nenhum participante conectado</div>
            )}
          </div>

          {isSidebarOpen && otherParticipants.length > 0 && (
            <div className="w-44 lg:w-48 h-full bg-lira-panel rounded-[12px] border border-lira-quiet p-2 flex flex-col gap-2 overflow-y-auto shrink-0">
              <div className="text-[10px] font-mono font-bold text-lira-muted uppercase tracking-wider px-1 py-0.5 flex items-center justify-between border-b border-dashed border-lira-rule/60">
                <span>Participantes ({otherParticipants.length})</span>
              </div>

              {otherParticipants.map((otherUser) => (
                <GridParticipantTile
                  key={otherUser.id}
                  user={otherUser}
                  isFocused={false}
                  isSidebar={true}
                  mediaKind="participant"
                  onFocus={() => setFocusedUserId(otherUser.id)}
                  onOpenLiveFullscreen={(u) => setLiveTheaterUser(u)}
                  onContextMenu={handleParticipantContextMenu}
                />
              ))}
            </div>
          )}
          {isTranscriptOpen && transcription && <CallTranscriptPanel {...transcription} onStart={transcription.start} onStop={transcription.stop} onClose={() => setIsTranscriptOpen(false)} />}
        </div>

        <CallControlsBar
          onToggleScreenShare={handleToggleScreenShare}
          onLeaveCall={() => setGridCallOpen(false)}
        />
      </div>

      {theaterUser && (
        <FullScreenLiveOverlay
          user={theaterUser}
          onClose={() => setLiveTheaterUser(null)}
        />
      )}

      <ScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
      />

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
