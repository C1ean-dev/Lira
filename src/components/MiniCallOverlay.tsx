import React, { useEffect, useRef, useState } from 'react'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Maximize2,
  Minimize2,
  ScreenShare,
  Radio,
  Settings,
  ChevronDown,
  ChevronUp,
  Monitor,
  Sparkles,
  MessageSquare,
  Volume2,
  Volume1,
  VolumeX,
  Gauge,
  Lock,
  Unlock,
  Shield,
  Headphones,
  Sliders,
  StopCircle,
} from 'lucide-react'
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useChatStore } from '../store/useChatStore'
import { MediaManager } from '../media/MediaManager'
import { PeerManager } from '../p2p/PeerManager'
import { ScreenShareModal } from './ScreenShareModal'
import { RoomSettingsModal } from './RoomSettingsModal'
import { attachStreamToVideo } from '../media/attachVideoElement'
import { ParticipantContextMenu } from './grid/ParticipantContextMenu'
import { ParticipantData } from './grid/GridParticipantTile'
import { NetworkSignalIcon } from './NetworkSignalIcon'
import { useUserNetworkQuality } from '../store/useNetworkQualityStore'

interface VideoTileProps {
  id?: string
  stream: MediaStream | null
  name: string
  isMuted?: boolean
  isMutedByAdmin?: boolean
  isDeafened?: boolean
  isCameraOff?: boolean
  isLocal?: boolean
  isScreenSharing?: boolean
  isScreenTrack?: boolean
  color?: string
  callState?: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
  onRetryCall?: () => void
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  suppressAudio?: boolean
}

const VideoTile: React.FC<VideoTileProps> = ({
  id,
  stream,
  name,
  isMuted,
  isMutedByAdmin,
  isDeafened,
  isCameraOff,
  isLocal,
  isScreenSharing,
  isScreenTrack,
  color,
  callState,
  onRetryCall,
  onClick,
  onContextMenu,
  suppressAudio = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Granular selectors — whole-store here re-rendered every tile on each
  // VU-meter tick (~10Hz) and every peer-stream change.
  const outputVolume = useMediaStore((s) => s.outputVolume)
  const selectedAudioOutput = useMediaStore((s) => s.selectedAudioOutput)
  const participantVolumes = useMediaStore((s) => s.participantVolumes)
  const setParticipantVolume = useMediaStore((s) => s.setParticipantVolume)
  const isGlobalDeafened = useMediaStore((s) => s.isDeafened)
  const isSilenced = useMediaStore((s) => (id ? s.isUserSilenced(id, name) : false))
  const rawVolume = (id && participantVolumes[id] !== undefined) ? participantVolumes[id] : 100
  const networkQuality = useUserNetworkQuality(id, isLocal)

  const isEffectivelyMuted = Boolean(isLocal || suppressAudio || isGlobalDeafened || isSilenced || rawVolume === 0)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return

    video.muted = isEffectivelyMuted
    return attachStreamToVideo(video, stream, {
      tile: 'mini',
      peer: name,
      isLocal: !!isLocal,
      muted: isEffectivelyMuted,
    })
  }, [stream, isLocal, isEffectivelyMuted])

  useEffect(() => {
    if (videoRef.current && !isLocal) {
      const effectiveVol = isEffectivelyMuted ? 0 : Math.max(0, Math.min(1, (outputVolume / 100) * (rawVolume / 100)))
      videoRef.current.volume = effectiveVol
      if (typeof (videoRef.current as any).setSinkId === 'function' && selectedAudioOutput) {
        ;(videoRef.current as any)
          .setSinkId(selectedAudioOutput === 'default' ? '' : selectedAudioOutput)
          .catch(() => {})
      }
    }
  }, [rawVolume, outputVolume, selectedAudioOutput, isLocal, isEffectivelyMuted])

  return (
    <div
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e)
      }}
      className={`group relative w-32 h-24 bg-[#12151d] rounded-2xl overflow-hidden border-2 transition-all flex items-center justify-center shrink-0 cursor-pointer hover:scale-105 shadow-lg select-none ${
        isScreenTrack
          ? 'border-rose-500/80 hover:border-rose-400'
          : 'border-[#2a3142] hover:border-indigo-500'
      }`}
      title={isScreenTrack ? 'Transmissão de Tela - Clique para expandir' : 'Clique para expandir em tela cheia'}
    >
      {/* Video Feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal || suppressAudio} // Avoid local echo and duplicate audio while the grid is open
        onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
        onCanPlay={() => videoRef.current?.play().catch(() => {})}
        className={`w-full h-full ${isScreenTrack ? 'object-contain bg-black' : 'object-cover'} ${
          isCameraOff && !isScreenSharing && !isScreenTrack ? 'hidden' : 'block'
        } ${isLocal && !isScreenSharing && !isScreenTrack ? '-scale-x-100' : ''}`}
      />

      {/* Camera Off Avatar Fallback */}
      {isCameraOff && !isScreenSharing && !isScreenTrack && (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-md border border-white/20"
          style={{ backgroundColor: color || '#4c6ef5' }}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      )}

      {/* Top Live Badge */}
      {(isScreenSharing || isScreenTrack) && (
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 bg-rose-600 text-white rounded text-[8px] font-bold shadow animate-pulse">
          <Radio className="w-2.5 h-2.5" />
          <span>{isScreenTrack ? 'TELA AO VIVO' : 'AO VIVO'}</span>
        </div>
      )}

      {/* Call State Badges */}
      {!isLocal && !isScreenTrack && callState === 'reconnecting' && (
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/90 text-white rounded text-[8px] font-bold shadow animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
          <span>RECONECTANDO</span>
        </div>
      )}

      {!isLocal && !isScreenTrack && callState === 'connecting' && (
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-indigo-500/90 text-white rounded text-[8px] font-bold shadow animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
          <span>CONECTANDO</span>
        </div>
      )}

      {!isLocal && !isScreenTrack && callState === 'failed' && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center p-1 text-center">
          <span className="text-[10px] text-rose-400 font-bold mb-1">Chamada caiu</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRetryCall?.()
            }}
            className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] rounded-lg font-bold transition-all cursor-pointer shadow active:scale-95"
          >
            Reconectar
          </button>
        </div>
      )}

      {/* Live viewer volume control (hover, top-right) */}
      {isScreenTrack && !isLocal && (
        <div
          className="absolute top-1.5 right-1.5 group/vol flex items-center bg-black/70 hover:bg-black/90 backdrop-blur-md border border-white/15 rounded-lg px-1 py-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              setParticipantVolume(name, rawVolume === 0 ? 100 : 0)
            }}
            className="text-slate-200 hover:text-white transition-colors p-0.5"
            title={rawVolume === 0 ? 'Desmutar transmissão' : 'Mutar transmissão'}
          >
            {rawVolume === 0 ? (
              <VolumeX className="w-3 h-3 text-rose-400" />
            ) : rawVolume < 50 ? (
              <Volume1 className="w-3 h-3 text-indigo-300" />
            ) : (
              <Volume2 className="w-3 h-3 text-indigo-300" />
            )}
          </button>
          <div className="w-0 group-hover/vol:w-14 focus-within:w-14 transition-all duration-200 overflow-hidden flex items-center pl-0.5">
            <input
              type="range"
              min="0"
              max="200"
              value={rawVolume}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setParticipantVolume(name, Number(e.target.value))}
              className="w-12 h-1 bg-slate-600 rounded appearance-none cursor-pointer accent-indigo-500"
              title={`Volume da live: ${rawVolume}%`}
            />
          </div>
        </div>
      )}

      {/* Name Pill Tag */}
      <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between px-2 py-0.5 bg-black/70 backdrop-blur-md rounded-lg text-[10px] text-white">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate font-medium">
            {isScreenTrack ? `Tela (${name})` : isLocal ? `${name} (Você)` : name}
          </span>
          {!isScreenTrack && (
            <NetworkSignalIcon
              rating={networkQuality.rating}
              pingMs={networkQuality.pingMs}
              lossPct={networkQuality.lossPct}
              showPingText={false}
              size="sm"
            />
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isDeafened && (
            <span title={isLocal ? "Você mutou o som para si" : "Usuário mutou o som para si (ensurdecido)"} className="flex items-center">
              <Headphones className="w-2.5 h-2.5 text-amber-400" />
            </span>
          )}
          {!isLocal && isSilenced && (
            <span title="Silenciado mutuamente" className="flex items-center">
              <VolumeX className="w-2.5 h-2.5 text-amber-400" />
            </span>
          )}
          {!isLocal && !isSilenced && rawVolume === 0 && (
            <span title="Mutado para você" className="flex items-center">
              <VolumeX className="w-2.5 h-2.5 text-rose-400" />
            </span>
          )}
          {isMuted && !isScreenTrack && (
            <span
              title={isMutedByAdmin ? "Mutado pelo Administrador" : "Microfone mutado"}
              className="flex items-center"
            >
              <MicOff className={`w-2.5 h-2.5 shrink-0 ${isMutedByAdmin ? 'text-amber-400' : 'text-rose-400'}`} />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Floating Picture-in-Picture Screen Share Preview Window
 */
interface FloatingScreenPreviewProps {
  stream: MediaStream
  presenterId?: string
  presenterName: string
  isLocal: boolean
  suppressAudio?: boolean
  onExpand: () => void
  onClose: () => void
}

const FloatingScreenPreview: React.FC<FloatingScreenPreviewProps> = ({
  stream,
  presenterId,
  presenterName,
  isLocal,
  suppressAudio = false,
  onExpand,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Granular selectors — same VU-tick reason as VideoTile above.
  const outputVolume = useMediaStore((s) => s.outputVolume)
  const selectedAudioOutput = useMediaStore((s) => s.selectedAudioOutput)
  const participantVolumes = useMediaStore((s) => s.participantVolumes)
  const setParticipantVolume = useMediaStore((s) => s.setParticipantVolume)
  const liveStreamVolume = useMediaStore((s) => s.liveStreamVolume)
  const setLiveStreamVolume = useMediaStore((s) => s.setLiveStreamVolume)

  const rawVolume =
    presenterId && participantVolumes[presenterId] !== undefined
      ? participantVolumes[presenterId]
      : participantVolumes[presenterName] !== undefined
      ? participantVolumes[presenterName]
      : liveStreamVolume !== undefined
      ? liveStreamVolume
      : 100

  const handleVolumeChange = (val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)))
    setLiveStreamVolume(clamped)
    if (presenterId) setParticipantVolume(presenterId, clamped)
    if (presenterName) setParticipantVolume(presenterName, clamped)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return

    // Imperative muted — same Chromium attribute-vs-property gotcha as
    // VideoTile; a local screen preview left unmuted echoes mic+system
    // audio back with DSP latency.
    video.muted = !!isLocal || suppressAudio
    // Shared attach with play-failure recovery. See attachVideoElement.ts.
    return attachStreamToVideo(video, stream, {
      tile: 'mini-pip',
      peer: presenterName,
      isLocal: !!isLocal,
      muted: !!isLocal || suppressAudio,
    })
  }, [stream, isLocal, suppressAudio])

  useEffect(() => {
    if (videoRef.current && !isLocal) {
      const effectiveVol = Math.max(0, Math.min(1, (outputVolume / 100) * (rawVolume / 100)))
      videoRef.current.volume = effectiveVol
      if (typeof (videoRef.current as any).setSinkId === 'function' && selectedAudioOutput) {
        ;(videoRef.current as any)
          .setSinkId(selectedAudioOutput === 'default' ? '' : selectedAudioOutput)
          .catch(() => {})
      }
    }
  }, [rawVolume, outputVolume, selectedAudioOutput, isLocal])

  return (
    <div className="mb-2 w-72 sm:w-80 bg-[#12151d] rounded-2xl overflow-hidden border-2 border-indigo-500/80 shadow-2xl animate-in slide-in-from-bottom-2 duration-200">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1b202c]/90 border-b border-[#2a3142]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
          <span className="text-[11px] font-bold text-slate-200">
            {isLocal ? 'Sua Tela' : `Tela de ${presenterName}`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Volume Control for Viewer */}
          {!isLocal && (
            <div className="group/vol relative flex items-center bg-[#12151d] border border-[#2a3142] rounded-lg px-1.5 py-0.5">
              <button
                onClick={() => {
                  if (rawVolume > 0) {
                    handleVolumeChange(0)
                  } else {
                    handleVolumeChange(100)
                  }
                }}
                className="text-slate-300 hover:text-white transition-colors p-0.5"
                title={rawVolume === 0 ? 'Desmutar Transmissão' : 'Mutar Transmissão'}
              >
                {rawVolume === 0 ? (
                  <VolumeX className="w-3 h-3 text-rose-400" />
                ) : rawVolume < 50 ? (
                  <Volume1 className="w-3 h-3 text-indigo-400" />
                ) : (
                  <Volume2 className="w-3 h-3 text-indigo-400" />
                )}
              </button>
              <div className="w-0 group-hover/vol:w-16 transition-all duration-200 overflow-hidden flex items-center pl-1">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={rawVolume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="w-14 h-1 bg-slate-700 rounded appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
                  title={`Volume: ${rawVolume}%`}
                />
              </div>
            </div>
          )}

          <button
            onClick={onExpand}
            className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            title="Expandir Tela Cheia (Modo Grade)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors"
            title="Recolher Janela Flutuante"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Floating Video Stream */}
      <div
        onClick={onExpand}
        className="relative w-full h-40 bg-black flex items-center justify-center cursor-pointer group"
        title="Clique para expandir em tela cheia"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal || suppressAudio}
          onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
          onCanPlay={() => videoRef.current?.play().catch(() => {})}
          className="w-full h-full object-contain bg-black"
        />

        {/* Hover Overlay with Expand Action */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <span className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-lg flex items-center gap-1.5 backdrop-blur-md">
            <Maximize2 className="w-3.5 h-3.5" />
            Expandir Apresentação
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Outer gate: subscribes ONLY to the two booleans that decide visibility, so
 * 60Hz player-position updates don't re-render this overlay while hidden
 * (the common case — walking around outside any zone).
 */
export const MiniCallOverlay: React.FC = () => {
  const currentZoneId = useGameStore((s) => s.localPlayer.currentZoneId)
  const isGridCallOpen = useMediaStore((s) => s.isGridCallOpen)
  if (!currentZoneId) return null
  return (
    <div
      className={isGridCallOpen ? 'invisible pointer-events-none' : ''}
      aria-hidden={isGridCallOpen}
    >
      <MiniCallOverlayInner suppressAudio={isGridCallOpen} />
    </div>
  )
}

const MiniCallOverlayInner: React.FC<{ suppressAudio?: boolean }> = ({ suppressAudio = false }) => {
  // Granular selectors — the VU level ticks at ~10Hz; subscribe narrowly so
  // the overlay doesn't re-render on unrelated media slices.
  const localStream = useMediaStore((s) => s.localStream)
  const localScreenStream = useMediaStore((s) => s.localScreenStream)
  const peerStreams = useMediaStore((s) => s.peerStreams)
  const isMuted = useMediaStore((s) => s.isMuted)
  const isDeafened = useMediaStore((s) => s.isDeafened)
  const isCameraOff = useMediaStore((s) => s.isCameraOff)
  const isScreenSharing = useMediaStore((s) => s.isScreenSharing)
  const setGridCallOpen = useMediaStore((s) => s.setGridCallOpen)
  const toggleMute = useMediaStore((s) => s.toggleMute)
  const toggleDeafen = useMediaStore((s) => s.toggleDeafen)
  const toggleCamera = useMediaStore((s) => s.toggleCamera)

  const { localPlayer, remotePlayers, callStates } = useGameStore()
  const { mapData, toggleZoneLock } = useMapStore()

  const isChatOpen = useChatStore((state) => state.isChatOpen)
  const activeChannelId = useChatStore((state) => state.activeChannelId)
  const zoneChannel = useChatStore((state) => state.channels.find((c) => c.id === 'current-zone'))
  const unreadZoneCount = zoneChannel?.unreadCount || 0

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false)
  const [isActiveStreamMenuOpen, setIsActiveStreamMenuOpen] = useState(false)
  const [isFloatingPreviewVisible, setIsFloatingPreviewVisible] = useState(true)
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false)
  const [contextMenuState, setContextMenuState] = useState<{ user: ParticipantData; x: number; y: number } | null>(null)

  const streamMenuRef = useRef<HTMLDivElement>(null)

  // Fecha o mini-menu ao clicar fora ou pressionar ESC
  useEffect(() => {
    if (!isActiveStreamMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (streamMenuRef.current && !streamMenuRef.current.contains(e.target as Node)) {
        setIsActiveStreamMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsActiveStreamMenuOpen(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActiveStreamMenuOpen])

  // Only display if user is in a Private Zone (grid-open gate lives in outer).
  if (!localPlayer.currentZoneId) return null

  const currentZone = mapData.zones.find((z) => z.id === localPlayer.currentZoneId)
  const zoneName = currentZone?.name || 'Mesa Privada'
  const isRoomLocked = !!currentZone?.isLocked

  // Filter remote participants who are in the same zone
  const peersInSameZone = Object.values(remotePlayers).filter(
    (p) => p.currentZoneId === localPlayer.currentZoneId
  )

  const isAnyReconnecting = peersInSameZone.some(
    (p) => callStates[p.id] === 'reconnecting'
  )

  // Find if there is an active screen share in this zone (local or remote)
  const remotePresenter = peersInSameZone.find((p) => p.isScreenSharing && peerStreams[p.id])
  const hasActiveScreenShare = isScreenSharing || !!remotePresenter

  const activeScreenStream = isScreenSharing
    ? localScreenStream
    : remotePresenter
    ? peerStreams[remotePresenter.id]
    : null

  const presenterId = isScreenSharing
    ? localPlayer.id
    : remotePresenter
    ? remotePresenter.id
    : ''

  const presenterName = isScreenSharing
    ? localPlayer.name
    : remotePresenter
    ? remotePresenter.name
    : ''

  const isPresenterLocal = isScreenSharing

  const handleOpenRoomChat = () => {
    const chatStore = useChatStore.getState()
    if (chatStore.isChatOpen && chatStore.activeChannelId === 'current-zone') {
      chatStore.setChatOpen(false)
    } else {
      chatStore.setActiveChannel('current-zone')
      chatStore.setChatOpen(true)
    }
  }

  const handleToggleScreenShare = async () => {
    if (isScreenSharing) {
      setIsActiveStreamMenuOpen((prev) => !prev)
    } else {
      setIsScreenModalOpen(true)
    }
  }

  return (
    <>
      <div className="fixed bottom-4 left-4 z-40 flex flex-col items-start select-none">
        {/* 1. Dedicated Floating Screen Share PiP Window (When sharing is active) */}
        {hasActiveScreenShare && activeScreenStream && isFloatingPreviewVisible && (
          <FloatingScreenPreview
            stream={activeScreenStream}
            presenterId={presenterId}
            presenterName={presenterName}
            isLocal={isPresenterLocal}
            suppressAudio={suppressAudio}
            onExpand={() => setGridCallOpen(true)}
            onClose={() => setIsFloatingPreviewVisible(false)}
          />
        )}

        {/* 2. Main Floating Zone Call Card */}
        <div className="bg-[#1b202c]/95 backdrop-blur-xl border border-[#2a3142] rounded-3xl p-3 shadow-2xl animate-in slide-in-from-bottom-4 duration-200">
          {/* Top Status */}
          <div className="flex items-center justify-between gap-4 mb-2 px-1">
            <div
              onClick={handleOpenRoomChat}
              className="flex items-center gap-2 cursor-pointer group"
              title={`Ir para o Chat da Sala (${zoneName})`}
            >
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold text-slate-100 group-hover:text-indigo-400 transition-colors">
                {zoneName}
              </span>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full">
                {peersInSameZone.length + 1} online
              </span>
              {isRoomLocked && (
                <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5 text-amber-400" />
                  Trancada
                </span>
              )}
              {isAnyReconnecting && (
                <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded-full font-bold flex items-center gap-1 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                  Reconectando
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {/* Toggle Floating Screen Share Preview button if active */}
              {hasActiveScreenShare && !isFloatingPreviewVisible && (
                <button
                  onClick={() => setIsFloatingPreviewVisible(true)}
                  className="px-2 py-0.5 rounded-lg bg-rose-600/20 text-rose-400 border border-rose-500/30 hover:bg-rose-600 hover:text-white transition-all text-[10px] font-bold flex items-center gap-1"
                  title="Exibir Tela Flutuante da Apresentação"
                >
                  <Monitor className="w-3 h-3" />
                  <span>Ver Tela</span>
                </button>
              )}

              <button
                onClick={() => setGridCallOpen(true)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
                title="Expandir Chamada (Modo Grade)"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Video Tiles Carousel (Clicking opens Spotlight Grid) */}
          <div className="flex gap-2 items-center overflow-x-auto pb-1 max-w-sm sm:max-w-md">
            {/* Local User Camera */}
            <VideoTile
              id={localPlayer.id}
              stream={localStream}
              name={localPlayer.name}
              isMuted={isMuted}
              isMutedByAdmin={localPlayer.isMutedByAdmin}
              isDeafened={isDeafened}
              isCameraOff={isCameraOff}
              isLocal={true}
              isScreenSharing={false}
              suppressAudio={suppressAudio}
              color={localPlayer.avatar.shirtColor}
              onClick={() => setGridCallOpen(true)}
              onContextMenu={(e) => {
                setContextMenuState({
                  user: {
                    id: localPlayer.id,
                    gameId: localPlayer.gameId || localPlayer.id,
                    name: localPlayer.name,
                    stream: localStream,
                    isLocal: true,
                    isMuted,
                    isMutedByAdmin: localPlayer.isMutedByAdmin,
                    isDeafened,
                    shirtColor: localPlayer.avatar.shirtColor,
                    statusEmoji: localPlayer.statusEmoji,
                  },
                  x: e.clientX,
                  y: e.clientY,
                })
              }}
            />

            {/* Local Screen Share Tile (if sharing) */}
            {isScreenSharing && localScreenStream && (
              <VideoTile
                stream={localScreenStream}
                name={localPlayer.name}
                isLocal={true}
                isScreenSharing={true}
                isScreenTrack={true}
                suppressAudio={suppressAudio}
                onClick={() => setGridCallOpen(true)}
              />
            )}

            {/* Remote Peers in Zone */}
            {peersInSameZone.map((peer) => (
              <VideoTile
                key={peer.id}
                id={peer.id}
                stream={peerStreams[peer.id] || null}
                name={peer.name}
                isMuted={peer.isMuted}
                isMutedByAdmin={peer.isMutedByAdmin}
                isDeafened={peer.isDeafened}
                isCameraOff={peer.isCameraOff}
                isLocal={false}
                isScreenSharing={peer.isScreenSharing}
                isScreenTrack={peer.isScreenSharing}
                suppressAudio={suppressAudio}
                color={peer.avatar.shirtColor}
                callState={callStates[peer.id] || peer.callState || 'idle'}
                onRetryCall={() => PeerManager.getInstance().retryZoneCall(peer.id)}
                onClick={() => setGridCallOpen(true)}
                onContextMenu={(e) => {
                  setContextMenuState({
                    user: {
                      id: peer.id,
                      gameId: peer.gameId || peer.id,
                      name: peer.name,
                      stream: peerStreams[peer.id] || null,
                      isLocal: false,
                      isMuted: peer.isMuted,
                      isMutedByAdmin: peer.isMutedByAdmin,
                      isDeafened: peer.isDeafened,
                      shirtColor: peer.avatar.shirtColor,
                      statusEmoji: peer.statusEmoji,
                    },
                    x: e.clientX,
                    y: e.clientY,
                  })
                }}
              />
            ))}
          </div>

          {/* Quick Controls Bar */}
          <div className="flex items-center justify-center gap-2 mt-2 pt-2 border-t border-[#2a3142]">
            {/* Mic */}
            <button
              onClick={toggleMute}
              className={`p-2 rounded-xl text-xs font-medium transition-colors ${
                localPlayer.isMutedByAdmin
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 hover:bg-amber-500/30'
                  : isMuted
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title={
                localPlayer.isMutedByAdmin
                  ? 'Microfone mutado pelo Administrador (Clique para desmutar)'
                  : isMuted
                  ? 'Desmutar Microfone'
                  : 'Mutar Microfone'
              }
            >
              {isMuted ? (
                <MicOff className={`w-4 h-4 ${localPlayer.isMutedByAdmin ? 'text-amber-400' : ''}`} />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            {/* Mutar som para si (Ensurdecer / Deafen) */}
            <button
              onClick={toggleDeafen}
              className={`p-2 rounded-xl text-xs font-medium transition-colors ${
                isDeafened
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30 shadow-md shadow-rose-500/10'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title={
                isDeafened
                  ? 'Reativar som da chamada para você'
                  : 'Mutar o som para mim (Ensurdecer)'
              }
            >
              <Headphones className="w-4 h-4" />
            </button>

            {/* Camera */}
            <button
              onClick={toggleCamera}
              className={`p-2 rounded-xl text-xs font-medium transition-colors ${
                isCameraOff ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
              title={isCameraOff ? 'Ligar Câmera' : 'Desligar Câmera'}
            >
              {isCameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
            </button>

            {/* Screen Share (Flashing and glowing when active) with small list menu */}
            <div className="relative">
              <button
                onClick={handleToggleScreenShare}
                className={`p-2 rounded-xl text-xs font-medium transition-all ${
                  isScreenSharing
                    ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/40 animate-pulse'
                    : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                }`}
                title={isScreenSharing ? 'Opções da Transmissão (Ao Vivo)' : 'Compartilhar Tela'}
              >
                <ScreenShare className="w-4 h-4" />
              </button>

              {/* Menu compacto em lista de opções da transmissão */}
              {isScreenSharing && isActiveStreamMenuOpen && (
                <div
                  ref={streamMenuRef}
                  className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-48 bg-[#12151d]/95 backdrop-blur-xl border border-[#2a3142] rounded-2xl shadow-2xl p-1.5 z-50 select-none animate-in fade-in zoom-in-95 duration-150"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2.5 py-1 text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-[#2a3142]/60 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                    Ao Vivo
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsActiveStreamMenuOpen(false)
                      setIsScreenModalOpen(true)
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800/80 transition-colors text-left"
                  >
                    <Sliders className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                    <span>Trocar configurações</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsActiveStreamMenuOpen(false)
                      MediaManager.getInstance().stopScreenShare()
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-200 hover:bg-rose-950/40 transition-colors text-left"
                  >
                    <StopCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>Encerrar transmissão</span>
                  </button>
                </div>
              )}
            </div>

            {/* Chat da Sala */}
            <button
              onClick={handleOpenRoomChat}
              className={`p-2 rounded-xl text-xs font-medium transition-all relative ${
                isChatOpen && activeChannelId === 'current-zone'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/40'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white'
              }`}
              title={`Ir para o Chat da Sala (${zoneName})`}
            >
              <MessageSquare className="w-4 h-4" />
              {unreadZoneCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-400 ring-2 ring-[#1b202c] animate-pulse flex items-center justify-center text-[8px] font-bold text-slate-950">
                  {unreadZoneCount > 9 ? '9+' : unreadZoneCount}
                </span>
              )}
            </button>

            {/* Lock / Unlock Room */}
            <button
              onClick={() => {
                if (!localPlayer.currentZoneId) return
                const next = toggleZoneLock(localPlayer.currentZoneId)
                PeerManager.getInstance().sendRoomLockToggle(localPlayer.currentZoneId, next)
              }}
              className={`p-2 rounded-xl text-xs font-medium transition-all ${
                isRoomLocked
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 shadow-md shadow-amber-500/20'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
              title={
                isRoomLocked
                  ? 'Sala Trancada (Clique para destrancar)'
                  : 'Trancar Sala (Exigir bater na porta)'
              }
            >
              {isRoomLocked ? <Lock className="w-4 h-4 text-amber-400" /> : <Unlock className="w-4 h-4" />}
            </button>

            {/* Room Permissions & Allowed Users (Escudo para gerenciar permissões da sala) */}
            <button
              onClick={() => setIsRoomSettingsOpen(true)}
              className="p-2 rounded-xl text-xs font-medium bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-indigo-300 transition-colors"
              title="Gerenciar Usuários com Permissão de Entrada"
            >
              <Shield className="w-4 h-4" />
            </button>

            {/* Settings (Configurações de Áudio e Voz) */}
            <button
              onClick={() => useMediaStore.getState().setSettingsModalOpen(true)}
              className="p-2 rounded-xl text-xs font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white transition-colors"
              title="Configurações de Áudio e Voz"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Screen Share Window Picker Modal */}
      <ScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
      />

      {/* Room Permissions & Settings Modal */}
      {currentZone && isRoomSettingsOpen && (
        <RoomSettingsModal
          zone={currentZone}
          isOpen={isRoomSettingsOpen}
          onClose={() => setIsRoomSettingsOpen(false)}
          initialTab="permissions"
        />
      )}

      {/* Participant Right-Click Context Menu */}
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
