import React, { useEffect, useMemo, useRef, useState } from 'react'
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
  Shield,
  Headphones,
  Sliders,
  StopCircle,
  Cpu,
  Check,
  Power,
  AudioLines,
  EyeOff,
  GripHorizontal,
  Play,
} from 'lucide-react'

const NOISE_ENGINES = [
  {
    id: 'deepfilter' as const,
    name: 'DeepFilterNet',
    badge: 'IA',
    desc: 'O melhor, porém mais lento, com fallback para RNNoise',
    icon: Sparkles,
  },
  {
    id: 'rnnoise' as const,
    name: 'RNNoise Neural',
    badge: 'IA',
    desc: 'Rápido e eficiente',
    icon: Cpu,
  },
  {
    id: 'classic' as const,
    name: 'DSP Clássico',
    badge: 'Leve',
    desc: 'Corte agressivo, menor uso de CPU',
    icon: Sliders,
  },
]
import { useMediaStore } from '../store/useMediaStore'
import { useGameStore } from '../store/useGameStore'
import { useLocalPlayerDetails, useZonePeerDetails } from '../hooks/usePlayerDetails'
import { useMapStore } from '../store/useMapStore'
import { useChatStore } from '../store/useChatStore'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { MediaManager } from '../media/MediaManager'
import { PeerManager } from '../p2p/PeerManager'
import { ScreenShareModal } from './ScreenShareModal'
import { RoomSettingsModal } from './RoomSettingsModal'
import { attachStreamToVideo } from '../media/attachVideoElement'
import { ParticipantContextMenu } from './grid/ParticipantContextMenu'
import { ParticipantData } from './grid/GridParticipantTile'
import { NetworkSignalIcon } from './NetworkSignalIcon'
import { useUserNetworkQuality } from '../store/useNetworkQualityStore'
import { AvatarConfig } from '../types/game'
import { PlayerAvatar } from './common/PlayerAvatar'
import { RemoteAudio } from './common/RemoteAudio'
import { CallPanelBody } from './common/CallPanelBody'
import { SpotifyIcon } from './common/SpotifyIcon'
import { AvatarAnimationsButton } from './AvatarAnimationsButton'
import { PetApiSettings } from './pets/PetApiSettings'
import { LiveWatchPrompt } from './LiveWatchPrompt'
import { useLiveGate } from '../hooks/useLiveGate'
import { useLiveViewBox } from '../hooks/useLiveViewBox'
import { useLiveFrameFit } from '../hooks/useLiveFrameFit'
import { noiseSuppressionDisplay, resolveNoiseProcessorPreference } from '../media/noiseSuppressionStatus'
import { NoiseSuppressionNotice } from './common/NoiseSuppressionNotice'
import { useLiveWatchStore } from '../store/useLiveWatchStore'
import { useSecurityStore, aggregatePeersSecurity } from '../store/useSecurityStore'
import { SecurityBadge } from './security/SecurityBadge'

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
  profilePicture?: string
  avatar?: AvatarConfig
  color?: string
  callState?: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
  onRetryCall?: () => void
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  suppressAudio?: boolean
  liveOptIn?: boolean
  liveWatching?: boolean
  liveInvite?: 'available' | 'watching' | 'local'
  isLiveSelected?: boolean
  onWatchLive?: () => void
  onFocusLive?: () => void
}

export const VideoTile: React.FC<VideoTileProps> = ({
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
  profilePicture,
  avatar,
  color,
  callState,
  onRetryCall,
  onClick,
  onContextMenu,
  suppressAudio = false,
  liveOptIn = false,
  liveWatching = false,
  liveInvite,
  isLiveSelected = false,
  onWatchLive,
  onFocusLive,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const liveGate = useLiveGate(id, Boolean(!isLocal && isScreenTrack && liveOptIn), liveWatching)
  const outputVolume = useMediaStore((s) => s.outputVolume)
  const selectedAudioOutput = useMediaStore((s) => s.selectedAudioOutput)
  const participantVolumes = useMediaStore((s) => s.participantVolumes)
  const setParticipantVolume = useMediaStore((s) => s.setParticipantVolume)
  const liveStreamVolume = useMediaStore((s) => s.liveStreamVolume)
  const setLiveStreamVolume = useMediaStore((s) => s.setLiveStreamVolume)
  const isGlobalDeafened = useMediaStore((s) => s.isDeafened)
  const isSilenced = useMediaStore((s) => (id ? s.isUserSilenced(id, name) : false))
  const rawVolume = isScreenTrack
    ? (liveStreamVolume !== undefined ? liveStreamVolume : 100)
    : (id && participantVolumes[id] !== undefined ? participantVolumes[id] : 100)
  const networkQuality = useUserNetworkQuality(id, isLocal)

  const isEffectivelyMuted = Boolean(isLocal || suppressAudio || isGlobalDeafened || isSilenced || rawVolume === 0)

  const hasLiveVideoTrack = useMemo(() => {
    if (!stream) return false
    const videoTracks = stream.getVideoTracks()
    return videoTracks.some((t) => t.readyState === 'live' && t.enabled && !(t as any).__isDummy)
  }, [stream])

  const isCameraEffectivelyOff = isCameraOff ?? !hasLiveVideoTrack
  const shouldShowVideo =
    !liveGate.needsClick && ((isScreenSharing || isScreenTrack) || (!isCameraEffectivelyOff && hasLiveVideoTrack))

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return

    video.muted = true
    return attachStreamToVideo(video, stream, {
      tile: 'mini',
      peer: name,
      isLocal: !!isLocal,
      muted: true,
    })
  }, [stream, isLocal, liveGate.needsClick])

  useLiveViewBox(id, videoRef, 'contain', liveGate.watching && !suppressAudio)
  const frameStyle = useLiveFrameFit(frameRef, videoRef, stream, !!isScreenTrack && !liveGate.needsClick, { inset: 4, bounds: { width: 128, height: 96 } })

  return (
    <div
      ref={frameRef}
      style={frameStyle}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(e)
      }}
      className={`group relative w-32 h-24 bg-lira-surface rounded-[8px] overflow-hidden border transition-colors flex items-center justify-center shrink-0 cursor-pointer select-none font-mono ${
        isScreenTrack || liveInvite
          ? isLiveSelected
            ? 'border-lira-error ring-1 ring-lira-error/40'
            : 'border-lira-error hover:border-lira-error'
          : 'border-lira-quiet hover:border-lira-accent'
      }`}
      title={
        liveInvite === 'available'
          ? `${name} abriu uma live - Clique em Assistir para ver`
          : isScreenTrack
          ? 'Transmissão de Tela - Clique para expandir'
          : 'Clique para expandir em tela cheia'
      }
    >
      {!liveGate.needsClick && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
          onCanPlay={() => videoRef.current?.play().catch(() => {})}
          onLoadedData={liveGate.onFrame}
          onPlaying={liveGate.onFrame}
          className={`w-full h-full ${isScreenTrack ? 'object-contain bg-lira-ground' : 'object-cover'} ${
            shouldShowVideo ? 'block' : 'hidden'
          } ${isLocal && !isScreenSharing && !isScreenTrack ? '-scale-x-100' : ''}`}
        />
      )}

      {!isLocal && stream && (
        <RemoteAudio
          stream={stream}
          tile="mini-audio"
          peer={name}
          muted={isEffectivelyMuted}
          volume={(outputVolume / 100) * (rawVolume / 100)}
          sinkId={selectedAudioOutput}
        />
      )}

      {!shouldShowVideo && (
        <PlayerAvatar
          name={name}
          profilePicture={profilePicture}
          avatar={avatar}
          size="xl"
          className="w-14 h-14 rounded-[6px] border border-lira-quiet"
        />
      )}

      {liveInvite === 'available' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pb-4 bg-lira-ground/80 pointer-events-none font-mono">
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-lira-error">
            <Radio className="w-2.5 h-2.5 text-lira-error animate-pulse" />
            <span>Abriu live</span>
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onWatchLive?.()
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="pointer-events-auto flex items-center gap-1 px-2.5 py-1 rounded-[6px] bg-lira-error hover:bg-lira-error/90 text-lira-ground text-[10px] font-bold transition-colors active:scale-95 cursor-pointer"
            title={`Assistir à live de ${name}`}
          >
            <Play className="w-2.5 h-2.5 fill-current" />
            <span>Assistir</span>
          </button>
        </div>
      )}

      {(liveGate.needsClick || liveGate.connecting) && (
        <LiveWatchPrompt size="tile" name={name} connecting={liveGate.connecting} onWatch={liveGate.watch} />
      )}

      {(liveInvite === 'watching' || liveInvite === 'local') && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onFocusLive?.()
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className={`absolute top-1.5 left-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[8px] font-mono font-bold transition-colors cursor-pointer ${
            isLiveSelected
              ? 'bg-lira-error text-lira-ground animate-pulse'
              : 'bg-lira-error/85 hover:bg-lira-error text-lira-ground'
          }`}
          title={
            liveInvite === 'local'
              ? 'Mostrar sua tela no mini display'
              : isLiveSelected
              ? `Assistindo live de ${name}`
              : `Mostrar live de ${name} no mini display`
          }
        >
          <Radio className="w-2.5 h-2.5" />
          <span>{isLiveSelected ? 'AO VIVO' : liveInvite === 'local' ? 'SUA LIVE' : 'VER LIVE'}</span>
        </button>
      )}

      {(isScreenSharing || isScreenTrack) && (
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 bg-lira-error text-lira-ground rounded-[4px] text-[8px] font-mono font-bold">
          <Radio className="w-2.5 h-2.5" />
          <span>{isScreenTrack ? 'TELA AO VIVO' : 'AO VIVO'}</span>
        </div>
      )}

      {!isLocal && !isScreenTrack && callState === 'reconnecting' && (
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-lira-amber text-lira-ground rounded-[4px] text-[8px] font-mono font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-lira-ground animate-ping" />
          <span>RECONECTANDO</span>
        </div>
      )}

      {!isLocal && !isScreenTrack && callState === 'connecting' && (
        <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-lira-panel border border-lira-accent text-lira-accent rounded-[4px] text-[8px] font-mono font-bold">
          <span className="w-1.5 h-1.5 rounded-full bg-lira-accent animate-ping" />
          <span>CONECTANDO</span>
        </div>
      )}

      {!isLocal && !isScreenTrack && callState === 'failed' && (
        <div className="absolute inset-0 bg-lira-ground/90 z-20 flex flex-col items-center justify-center p-1 text-center">
          <span className="text-[10px] text-lira-error font-mono font-bold mb-1">Chamada caiu</span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRetryCall?.()
            }}
            className="px-2 py-0.5 bg-lira-accent hover:bg-lira-ink text-lira-ground text-[9px] rounded-[6px] font-mono font-bold transition-colors cursor-pointer"
          >
            Reconectar
          </button>
        </div>
      )}

      {!isLocal && !liveGate.needsClick && (
        <div
          className="absolute top-1.5 right-1.5 z-10 group/vol flex items-center bg-lira-panel/95 hover:border-lira-accent border border-lira-rule rounded-[6px] px-1 py-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {liveGate.watching && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                liveGate.stop()
              }}
              className="text-lira-ink hover:text-lira-error transition-colors p-0.5"
              title="Parar de assistir"
            >
              <EyeOff className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              const nextVol = rawVolume === 0 ? 100 : 0
              if (isScreenTrack) {
                setLiveStreamVolume(nextVol)
              } else {
                if (id) setParticipantVolume(id, nextVol)
                if (name) setParticipantVolume(name, nextVol)
              }
            }}
            className="text-lira-ink hover:text-lira-accent transition-colors p-0.5"
            title={
              rawVolume === 0
                ? isScreenTrack
                  ? 'Desmutar transmissão'
                  : 'Desmutar participante'
                : isScreenTrack
                ? 'Mutar transmissão'
                : 'Mutar participante'
            }
          >
            {rawVolume === 0 ? (
              <VolumeX className="w-3 h-3 text-lira-error" />
            ) : rawVolume < 50 ? (
              <Volume1 className="w-3 h-3 text-lira-accent" />
            ) : (
              <Volume2 className="w-3 h-3 text-lira-accent" />
            )}
          </button>
          <div className="w-0 group-hover/vol:w-14 focus-within:w-14 transition-all duration-200 overflow-hidden flex items-center pl-0.5">
            <input
              type="range"
              min="0"
              max="200"
              value={rawVolume}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const val = Number(e.target.value)
                if (isScreenTrack) {
                  setLiveStreamVolume(val)
                } else {
                  if (id) setParticipantVolume(id, val)
                  if (name) setParticipantVolume(name, val)
                }
              }}
              className="w-12 h-1 bg-lira-surface rounded-[4px] appearance-none cursor-pointer accent-lira-accent"
              title={isScreenTrack ? `Volume da live: ${rawVolume}%` : `Volume: ${rawVolume}%`}
            />
          </div>
        </div>
      )}

      <div className="absolute bottom-1.5 left-1.5 right-1.5 z-10 flex items-center justify-between px-2 py-0.5 bg-lira-ground/85 border border-lira-quiet rounded-[6px] text-[10px] font-mono text-lira-ink">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate font-medium">
            {isScreenTrack ? `Tela (${name})` : isLocal ? `${name} (Você)` : name}
          </span>
          {(Boolean(id?.startsWith('dj-')) || name.includes('DJ')) && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.2 bg-lira-online text-lira-ground text-[8px] font-extrabold rounded-[4px] shrink-0" title="DJ">
              <SpotifyIcon size={9} className="text-lira-ground" />
              <span>DJ</span>
            </span>
          )}
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
              <Headphones className="w-2.5 h-2.5 text-lira-amber" />
            </span>
          )}
          {!isLocal && isSilenced && (
            <span title="Silenciado mutuamente" className="flex items-center">
              <VolumeX className="w-2.5 h-2.5 text-lira-amber" />
            </span>
          )}
          {!isLocal && !isSilenced && rawVolume === 0 && (
            <span title="Mutado para você" className="flex items-center">
              <VolumeX className="w-2.5 h-2.5 text-lira-error" />
            </span>
          )}
          {isMuted && !isScreenTrack && (
            <span
              title={isMutedByAdmin ? "Mutado pelo Administrador" : "Microfone mutado"}
              className="flex items-center"
            >
              <MicOff className={`w-2.5 h-2.5 shrink-0 ${isMutedByAdmin ? 'text-lira-amber' : 'text-lira-error'}`} />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

interface FloatingScreenPreviewProps {
  stream: MediaStream | null
  presenterId?: string
  presenterName: string
  isLocal: boolean
  suppressAudio?: boolean
  asksFirst?: boolean
  watching?: boolean
  lives?: Array<{ id: string; label: string; isLocal: boolean }>
  onSelectLive?: (id: string) => void
  onExpand: () => void
  onClose: () => void
}

export const FloatingScreenPreview: React.FC<FloatingScreenPreviewProps> = ({
  stream,
  presenterId,
  presenterName,
  isLocal,
  suppressAudio = false,
  asksFirst = false,
  watching = false,
  lives,
  onSelectLive,
  onExpand,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const liveGate = useLiveGate(presenterId, Boolean(!isLocal && asksFirst), watching)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const frameStyle = useLiveFrameFit(frameRef, videoRef, stream, !liveGate.needsClick, { widthOnly: true })
  const outputVolume = useMediaStore((s) => s.outputVolume)
  const selectedAudioOutput = useMediaStore((s) => s.selectedAudioOutput)
  const liveStreamVolume = useMediaStore((s) => s.liveStreamVolume)
  const setLiveStreamVolume = useMediaStore((s) => s.setLiveStreamVolume)

  const rawVolume = liveStreamVolume !== undefined ? liveStreamVolume : 100

  const handleVolumeChange = (val: number) => {
    const clamped = Math.max(0, Math.min(200, Math.round(val)))
    setLiveStreamVolume(clamped)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return

    video.muted = !!isLocal || suppressAudio
    return attachStreamToVideo(video, stream, {
      tile: 'mini-pip',
      peer: presenterName,
      isLocal: !!isLocal,
      muted: !!isLocal || suppressAudio,
    })
  }, [stream, isLocal, suppressAudio, liveGate.needsClick])

  useLiveViewBox(presenterId, videoRef, 'contain', liveGate.watching && !suppressAudio)

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
  }, [rawVolume, outputVolume, selectedAudioOutput, isLocal, liveGate.needsClick])

  return (
    <div className="w-72 sm:w-80 bg-lira-panel rounded-[12px] overflow-hidden border border-dashed border-lira-rule font-mono">
      <div className="flex items-center justify-between px-3 py-1.5 bg-lira-surface border-b border-dashed border-lira-rule/60">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-lira-error animate-ping" />
          <span className="text-[11px] font-bold text-lira-ink">
            {isLocal ? 'Sua Tela' : `Tela de ${presenterName}`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {liveGate.watching && (
            <button
              onClick={liveGate.stop}
              className="p-1 rounded-[6px] text-lira-muted hover:text-lira-error hover:bg-lira-panel transition-colors"
              title="Parar de assistir"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          )}

          {!isLocal && !liveGate.needsClick && (
            <div className="group/vol relative flex items-center bg-lira-panel border border-lira-quiet rounded-[6px] px-1.5 py-0.5">
              <button
                onClick={() => {
                  if (rawVolume > 0) {
                    handleVolumeChange(0)
                  } else {
                    handleVolumeChange(100)
                  }
                }}
                className="text-lira-muted hover:text-lira-ink transition-colors p-0.5"
                title={rawVolume === 0 ? 'Desmutar Transmissão' : 'Mutar Transmissão'}
              >
                {rawVolume === 0 ? (
                  <VolumeX className="w-3 h-3 text-lira-error" />
                ) : rawVolume < 50 ? (
                  <Volume1 className="w-3 h-3 text-lira-accent" />
                ) : (
                  <Volume2 className="w-3 h-3 text-lira-accent" />
                )}
              </button>
              <div className="w-0 group-hover/vol:w-28 transition-all duration-200 overflow-hidden flex items-center pl-1 gap-1">
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={rawVolume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="w-14 h-1 bg-lira-surface rounded-[4px] appearance-none cursor-pointer accent-lira-accent"
                  title={`Volume: ${rawVolume}%`}
                />
                <span className="text-[10px] font-mono tabular-nums text-lira-ink min-w-[28px]">
                  {rawVolume}%
                </span>
              </div>
            </div>
          )}

          <button
            onClick={onExpand}
            className="p-1 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-panel transition-colors"
            title="Expandir Tela Cheia (Modo Grade)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-panel transition-colors"
            title="Recolher Janela Flutuante"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {lives && lives.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 bg-lira-surface/80 border-b border-dashed border-lira-rule/60 overflow-x-auto">
          {lives.map((entry) => {
            const isCurrent = entry.id === presenterId
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => onSelectLive?.(entry.id)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[10px] font-mono font-bold transition-colors shrink-0 cursor-pointer ${
                  isCurrent
                    ? 'bg-lira-accent text-lira-ground border border-lira-accent'
                    : 'bg-lira-panel text-lira-muted border border-lira-quiet hover:text-lira-ink hover:border-lira-accent'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isCurrent ? 'bg-lira-error animate-pulse' : 'bg-lira-error/70'}`} />
                <span className="truncate max-w-[96px]">{entry.label}</span>
              </button>
            )
          })}
        </div>
      )}

      <div
        onClick={onExpand}
        ref={frameRef}
        style={frameStyle}
        className="relative w-full h-40 bg-lira-ground flex items-center justify-center cursor-pointer group"
        title="Clique para expandir em tela cheia"
      >
        {!liveGate.needsClick && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isLocal || suppressAudio}
            onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
            onCanPlay={() => videoRef.current?.play().catch(() => {})}
            onLoadedData={liveGate.onFrame}
            onPlaying={liveGate.onFrame}
            className="w-full h-full object-contain bg-lira-ground"
          />
        )}
        {(liveGate.needsClick || liveGate.connecting) && (
          <LiveWatchPrompt
            size="card"
            name={presenterName}
            connecting={liveGate.connecting}
            onWatch={liveGate.watch}
          />
        )}

        {!liveGate.needsClick && !liveGate.connecting && (
          <div className="absolute inset-0 bg-lira-ground/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <span className="px-3 py-1.5 bg-lira-accent text-lira-ground border border-lira-accent text-xs font-mono font-bold rounded-[8px] flex items-center gap-1.5">
              <Maximize2 className="w-3.5 h-3.5" />
              Expandir Apresentação
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export const MiniCallOverlay: React.FC = () => {
  const currentZoneId = useGameStore((s) => s.localPlayer.currentZoneId)
  const hasProximityCall = useGameStore((s) => s.proximityPeerIds.length > 0)
  const isGridCallOpen = useMediaStore((s) => s.isGridCallOpen)
  if (!currentZoneId && !hasProximityCall) return null
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
  const localStream = useMediaStore((s) => s.localStream)
  const localScreenStream = useMediaStore((s) => s.localScreenStream)
  const peerStreams = useMediaStore((s) => s.peerStreams)
  const peerScreenStreams = useMediaStore((s) => s.peerScreenStreams)
  const peerVoiceStreams = useMediaStore((s) => s.peerVoiceStreams)
  const isMuted = useMediaStore((s) => s.isMuted)
  const isDeafened = useMediaStore((s) => s.isDeafened)
  const isCameraOff = useMediaStore((s) => s.isCameraOff)
  const isScreenSharing = useMediaStore((s) => s.isScreenSharing)
  const setGridCallOpen = useMediaStore((s) => s.setGridCallOpen)
  const toggleMute = useMediaStore((s) => s.toggleMute)
  const toggleDeafen = useMediaStore((s) => s.toggleDeafen)
  const toggleCamera = useMediaStore((s) => s.toggleCamera)
  const isNoiseSuppressionEnabled = useMediaStore((s) => s.isNoiseSuppressionEnabled)
  const audioProcessorMode = useMediaStore((s) => s.audioProcessorMode)
  const rnnoiseStatus = useMediaStore((s) => s.rnnoiseStatus)
  const processingMode = useMediaStore(resolveNoiseProcessorPreference)
  const deepFilterStatus = useMediaStore((s) => s.deepFilterStatus)
  const noiseDisplay = noiseSuppressionDisplay(isNoiseSuppressionEnabled, processingMode, rnnoiseStatus, deepFilterStatus)
  const toggleNoiseSuppression = useMediaStore((s) => s.toggleNoiseSuppression)
  const setAudioProcessorMode = useMediaStore((s) => s.setAudioProcessorMode)

  const localPlayer = useLocalPlayerDetails()
  const roomId = useGameStore((s) => s.roomId)
  const isRoomOwner = useGameStore((s) => s.isOwner)
  const peersInSameZone = useZonePeerDetails()
  const callStates = useGameStore((s) => s.callStates)
  const friendProfiles = useGameStore((s) => s.friendProfiles)
  const mapData = useMapStore((s) => s.mapData)
  const toggleZoneLock = useMapStore((s) => s.toggleZoneLock)
  const watchingLives = useLiveWatchStore((s) => s.watching)
  const securityPeers = useSecurityStore((s) => s.peers)
  const openSecurityInspection = useSecurityStore((s) => s.openInspection)
  const miniCallSecurity = aggregatePeersSecurity(
    securityPeers,
    peersInSameZone
      .filter((p) => !p.isDjBot && !p.id.startsWith('dj-'))
      .map((p) => ({ id: p.id, gameId: p.gameId, name: p.name }))
  )

  const isChatOpen = useChatStore((state) => state.isChatOpen)
  const activeChannelId = useChatStore((state) => state.activeChannelId)
  const zoneChannel = useChatStore((state) => state.channels.find((c) => c.id === 'current-zone'))
  const unreadZoneCount = zoneChannel?.unreadCount || 0

  const jamsByZone = useSpotifyJamStore((s) => s.jamsByZone)
  const setSpotifyJamModalOpen = useSpotifyJamStore((s) => s.setModalOpen)
  const activeZoneJam = localPlayer.currentZoneId ? jamsByZone[localPlayer.currentZoneId] : null
  const isJamActive = !!activeZoneJam?.isActive

  const [isScreenModalOpen, setIsScreenModalOpen] = useState(false)
  const [isActiveStreamMenuOpen, setIsActiveStreamMenuOpen] = useState(false)
  const [isNoiseMenuOpen, setIsNoiseMenuOpen] = useState(false)
  const [isFloatingPreviewVisible, setIsFloatingPreviewVisible] = useState(true)
  const [selectedLiveId, setSelectedLiveId] = useState<string | null>(null)
  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = useState(false)
  const [isCardCollapsed, setIsCardCollapsed] = useState(false)
  const [contextMenuState, setContextMenuState] = useState<{ user: ParticipantData; x: number; y: number } | null>(null)

  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ startX: number; startY: number; initX: number; initY: number; hasMoved: boolean } | null>(null)

  const getRailWidth = () => {
    if (typeof window === 'undefined') return 68
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--rail-width')
    return parseFloat(raw) || (window.innerWidth < 640 ? 56 : 68)
  }

  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        if (!prev || !containerRef.current) return prev
        const rect = containerRef.current.getBoundingClientRect()
        const minX = getRailWidth() + 8
        const maxX = Math.max(minX, window.innerWidth - rect.width - 8)
        const maxY = Math.max(8, window.innerHeight - rect.height - 8)
        return {
          x: Math.min(Math.max(minX, prev.x), maxX),
          y: Math.min(Math.max(8, prev.y), maxY),
        }
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragStartRef.current || !containerRef.current) return
      const dx = e.clientX - dragStartRef.current.startX
      const dy = e.clientY - dragStartRef.current.startY

      if (Math.hypot(dx, dy) > 4) {
        dragStartRef.current.hasMoved = true
      }

      const rect = containerRef.current.getBoundingClientRect()
      const minX = getRailWidth() + 8
      const maxX = Math.max(minX, window.innerWidth - rect.width - 8)
      const maxY = Math.max(8, window.innerHeight - rect.height - 8)

      const nextX = Math.min(Math.max(minX, dragStartRef.current.initX + dx), maxX)
      const nextY = Math.min(Math.max(8, dragStartRef.current.initY + dy), maxY)

      setPosition({ x: nextX, y: nextY })
    }

    const handlePointerUp = () => {
      dragStartRef.current = null
      setIsDragging(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [isDragging])

  const handleDragPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button, input, a, select, textarea, [data-no-drag="true"]')) {
      return
    }
    const el = containerRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initX: position ? position.x : rect.left,
      initY: position ? position.y : rect.top,
      hasMoved: false,
    }
    setIsDragging(true)
  }

  const streamMenuRef = useRef<HTMLDivElement>(null)
  const noiseMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isActiveStreamMenuOpen && !isNoiseMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (streamMenuRef.current && !streamMenuRef.current.contains(e.target as Node)) {
        setIsActiveStreamMenuOpen(false)
      }
      if (noiseMenuRef.current && !noiseMenuRef.current.contains(e.target as Node)) {
        setIsNoiseMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsActiveStreamMenuOpen(false)
        setIsNoiseMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActiveStreamMenuOpen, isNoiseMenuOpen])

  const isProximityCall = !localPlayer.currentZoneId && peersInSameZone.length > 0
  if (!localPlayer.currentZoneId && !isProximityCall) return null

  const currentZone = localPlayer.currentZoneId ? mapData.zones.find((z) => z.id === localPlayer.currentZoneId) : undefined
  const activeHouseName = localPlayer.currentHouseId ? mapData.houseInteriors?.[localPlayer.currentHouseId]?.name : undefined
  const zoneName = isProximityCall ? 'Proximidade' : currentZone?.name || activeHouseName || 'Mesa Privada'
  const isRoomLocked = !!currentZone?.isLocked

  const isAnyReconnecting = peersInSameZone.some(
    (p) => callStates[p.id] === 'reconnecting'
  )

  const previewableLives: Array<{
    id: string
    name: string
    stream: MediaStream | null
    isLocal: boolean
    asksFirst: boolean
    watching: boolean
    watchedAt: number
  }> = []

  if (isScreenSharing && localScreenStream) {
    previewableLives.push({
      id: localPlayer.id,
      name: localPlayer.name,
      stream: localScreenStream,
      isLocal: true,
      asksFirst: false,
      watching: false,
      watchedAt: 0,
    })
  }

  const pendingRemoteLives = peersInSameZone.filter(
    (p) => p.isScreenSharing && p.liveOptIn && !watchingLives[p.id]
  )

  for (const peer of peersInSameZone) {
    if (!peer.isScreenSharing) continue
    const screenStream = peerScreenStreams[peer.id] || peerStreams[peer.id] || null
    const asksFirst = !!peer.liveOptIn
    const watching = !!watchingLives[peer.id]
    if ((asksFirst && watching) || (!asksFirst && screenStream)) {
      previewableLives.push({
        id: peer.id,
        name: peer.name,
        stream: screenStream,
        isLocal: false,
        asksFirst,
        watching,
        watchedAt: watchingLives[peer.id] || 0,
      })
    }
  }

  const mostRecentWatchedLive = previewableLives
    .filter((entry) => !entry.isLocal && entry.watching)
    .sort((a, b) => b.watchedAt - a.watchedAt)[0]

  const activeLive =
    (selectedLiveId ? previewableLives.find((entry) => entry.id === selectedLiveId) : undefined) ||
    mostRecentWatchedLive ||
    previewableLives[0] ||
    null

  const hasPreviewableLive = !!activeLive

  const handleWatchPeerLive = (peerId: string) => {
    useLiveWatchStore.getState().watch(peerId)
    setSelectedLiveId(peerId)
    setIsFloatingPreviewVisible(true)
  }

  const handleFocusLive = (liveId: string) => {
    setSelectedLiveId(liveId)
    setIsFloatingPreviewVisible(true)
  }

  const handleOpenRoomChat = () => {
    const targetChannelId = isProximityCall ? 'general' : 'current-zone'
    const chatStore = useChatStore.getState()
    if (chatStore.isChatOpen && chatStore.activeChannelId === targetChannelId) {
      chatStore.setChatOpen(false)
    } else {
      chatStore.setActiveChannel(targetChannelId)
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
      <div
        ref={containerRef}
        onPointerDown={handleDragPointerDown}
        style={
          position
            ? { left: `${position.x}px`, top: `${position.y}px`, bottom: 'auto', right: 'auto' }
            : undefined
        }
        className={`fixed z-40 flex flex-col items-start select-none touch-none ${
          position ? '' : 'bottom-4 left-[calc(var(--rail-width)+16px)]'
        } ${isDragging ? 'cursor-grabbing' : ''}`}
      >
        {activeLive && isFloatingPreviewVisible && (
          <div className="absolute bottom-full left-0 pb-2">
            <FloatingScreenPreview
              key={activeLive.id}
              stream={activeLive.stream}
              presenterId={activeLive.id}
              presenterName={activeLive.name}
              isLocal={activeLive.isLocal}
              suppressAudio={suppressAudio}
              asksFirst={activeLive.asksFirst}
              watching={activeLive.watching}
              lives={previewableLives.map((entry) => ({
                id: entry.id,
                label: entry.isLocal ? 'Sua Tela' : entry.name,
                isLocal: entry.isLocal,
              }))}
              onSelectLive={handleFocusLive}
              onExpand={() => setGridCallOpen(true)}
              onClose={() => setIsFloatingPreviewVisible(false)}
            />
          </div>
        )}

        <div className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-2.5 sm:p-3 max-w-[calc(100vw-var(--rail-width)-24px)] sm:max-w-md font-mono">
          <div className="flex items-center justify-between gap-2 sm:gap-4 px-1">
            <div
              onClick={() => {
                if (dragStartRef.current?.hasMoved) return
                handleOpenRoomChat()
              }}
              className="flex items-center gap-1.5 cursor-grab active:cursor-grabbing group min-w-0"
              title={`Ir para o Chat da Sala (${zoneName}) • Arraste para mover`}
            >
              <GripHorizontal className="w-3.5 h-3.5 text-lira-muted group-hover:text-lira-ink shrink-0" />
              <div className="w-2 h-2 rounded-full bg-lira-online animate-pulse shrink-0" />
              <span className="font-display text-sm font-bold text-lira-ink group-hover:text-lira-accent transition-colors truncate max-w-[110px] sm:max-w-[180px]">
                {zoneName}
              </span>
              <span className="text-[10px] font-mono tabular-nums bg-lira-surface border border-lira-quiet text-lira-muted px-1.5 py-0.5 rounded-[6px] shrink-0">
                {peersInSameZone.length + 1} online
              </span>
              {isRoomLocked && (
                <span className="text-[9px] bg-lira-amber/15 text-lira-amber border border-lira-amber/40 px-1.5 py-0.5 rounded-[6px] font-bold flex items-center gap-1 shrink-0">
                  <Lock className="w-2.5 h-2.5 text-lira-amber" />
                </span>
              )}
              {isAnyReconnecting && (
                <span className="text-[9px] bg-lira-amber/15 text-lira-amber border border-lira-amber/40 px-1.5 py-0.5 rounded-[6px] font-bold flex items-center gap-1 animate-pulse shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-lira-amber animate-ping" />
                </span>
              )}
              <SecurityBadge
                compact
                status={miniCallSecurity.status}
                mediaEncrypted={miniCallSecurity.mediaEncryptedCount > 0}
                onClick={(e) => {
                  e.stopPropagation()
                  openSecurityInspection(
                    miniCallSecurity.primaryPeer ?? {
                      peerId: localPlayer.id,
                      displayName: zoneName,
                    }
                  )
                }}
              />
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {isCardCollapsed && (
                <button
                  onClick={toggleMute}
                  className={`p-1.5 rounded-[8px] text-xs font-medium transition-colors ${
                    localPlayer.isMutedByAdmin
                      ? 'bg-lira-amber/15 text-lira-amber border border-lira-amber/50'
                      : isMuted
                      ? 'bg-lira-error/15 text-lira-error border border-lira-error/40'
                      : 'bg-lira-surface text-lira-ink border border-lira-rule hover:border-lira-accent'
                  }`}
                  title={isMuted ? 'Desmutar Microfone' : 'Mutar Microfone'}
                >
                  {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                </button>
              )}

              {isCardCollapsed && pendingRemoteLives.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsCardCollapsed(false)}
                  className="px-2 py-0.5 rounded-[6px] bg-lira-error/15 text-lira-error border border-lira-error/40 hover:bg-lira-error hover:text-lira-ground transition-colors text-[10px] font-mono font-bold flex items-center gap-1 animate-pulse"
                  title={
                    pendingRemoteLives.length === 1
                      ? `${pendingRemoteLives[0].name} abriu live - Clique para ver`
                      : `${pendingRemoteLives.length} pessoas abriram live - Clique para ver`
                  }
                >
                  <Radio className="w-3 h-3" />
                  <span>{pendingRemoteLives.length === 1 ? '1 live' : `${pendingRemoteLives.length} lives`}</span>
                </button>
              )}

              {hasPreviewableLive && !isFloatingPreviewVisible && (
                <button
                  onClick={() => setIsFloatingPreviewVisible(true)}
                  className="px-2 py-0.5 rounded-[6px] bg-lira-error/15 text-lira-error border border-lira-error/40 hover:bg-lira-error hover:text-lira-ground transition-colors text-[10px] font-mono font-bold flex items-center gap-1"
                  title="Exibir Tela Flutuante da Apresentação"
                >
                  <Monitor className="w-3 h-3" />
                  <span className="hidden sm:inline">Ver Tela</span>
                </button>
              )}

              {localPlayer.currentZoneId && (
                <button
                  onClick={() => setSpotifyJamModalOpen(true, localPlayer.currentZoneId)}
                  className={`px-2 py-0.5 rounded-[6px] border text-[10px] font-mono font-bold flex items-center gap-1 transition-colors ${
                    isJamActive
                      ? 'bg-lira-online/15 text-lira-online border-lira-online/40 hover:bg-lira-online/25'
                      : 'bg-lira-surface text-lira-muted hover:text-lira-online hover:border-lira-online border-lira-quiet'
                  }`}
                  title={isJamActive ? `Spotify Jam ativo: ${activeZoneJam?.zoneName || zoneName}` : 'Iniciar Spotify Jam nesta sala'}
                >
                  <SpotifyIcon size={12} className={`w-3 h-3 ${isJamActive ? 'text-lira-online animate-pulse' : ''}`} />
                  <span>Jam</span>
                  {isJamActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-lira-online animate-ping" />
                  )}
                </button>
              )}

              <AvatarAnimationsButton />
              {roomId && isRoomOwner && <PetApiSettings roomId={roomId} />}
              <button
                onClick={() => setGridCallOpen(true)}
                className="p-1 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-surface transition-colors"
                title="Expandir Chamada (Modo Grade)"
              >
                <Maximize2 className="w-4 h-4" />
              </button>

              <button
                key="collapse-call-panel"
                onClick={() => {
                  void MediaManager.getInstance().resumeMicrophone()
                  setIsCardCollapsed((prev) => !prev)
                }}
                className="p-1 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-surface transition-colors"
                title={isCardCollapsed ? 'Expandir painel de chamada' : 'Recolher painel de chamada'}
              >
                {isCardCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <CallPanelBody collapsed={isCardCollapsed}>
              <div className="flex gap-2 items-center overflow-x-auto pb-1 max-w-[calc(100vw-40px)] sm:max-w-md mt-2">
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
              liveInvite={isScreenSharing && localScreenStream ? 'local' : undefined}
              isLiveSelected={isFloatingPreviewVisible && activeLive?.id === localPlayer.id}
              onFocusLive={() => handleFocusLive(localPlayer.id)}
              profilePicture={localPlayer.profilePicture}
              avatar={localPlayer.avatar}
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

            {peersInSameZone.map((peer) => {
              const friendProfile = friendProfiles[peer.id] || (peer.gameId ? friendProfiles[peer.gameId] : undefined)
              const resolvedPic = peer.profilePicture || friendProfile?.profilePicture
              const resolvedAvatar = peer.avatar || friendProfile?.avatar
              const isPeerPendingLive = Boolean(peer.isScreenSharing && peer.liveOptIn && !watchingLives[peer.id])
              const isPeerPreviewableLive = previewableLives.some((entry) => entry.id === peer.id)

              return (
                <VideoTile
                  key={peer.id}
                  id={peer.id}
                  stream={peer.isScreenSharing ? peerVoiceStreams[peer.id] || null : peerStreams[peer.id] || null}
                  name={peer.name}
                  isMuted={peer.isMuted}
                  isMutedByAdmin={peer.isMutedByAdmin}
                  isDeafened={peer.isDeafened}
                  isCameraOff={peer.isCameraOff ?? true}
                  isLocal={false}
                  isScreenSharing={false}
                  isScreenTrack={false}
                  liveOptIn={peer.liveOptIn}
                  liveWatching={!!watchingLives[peer.id]}
                  liveInvite={isPeerPendingLive ? 'available' : isPeerPreviewableLive ? 'watching' : undefined}
                  isLiveSelected={isFloatingPreviewVisible && activeLive?.id === peer.id}
                  onWatchLive={() => handleWatchPeerLive(peer.id)}
                  onFocusLive={() => handleFocusLive(peer.id)}
                  profilePicture={resolvedPic}
                  avatar={resolvedAvatar}
                  suppressAudio={suppressAudio}
                  color={resolvedAvatar?.shirtColor || '#d1b5ff'}
                  callState={callStates[peer.id] || peer.callState || 'idle'}
                  onRetryCall={() => PeerManager.getInstance().retryZoneCall(peer.id)}
                  onClick={() => setGridCallOpen(true)}
                  onContextMenu={(e) => {
                  setContextMenuState({
                    user: {
                      id: peer.id,
                      gameId: peer.gameId || peer.id,
                      name: peer.name,
                      stream: peer.isScreenSharing ? peerVoiceStreams[peer.id] || null : peerStreams[peer.id] || null,
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
            )
          })}
          </div>

          <div className="flex items-center justify-center gap-2 mt-2 pt-2 border-t border-dashed border-lira-rule/60">
            <button
              onClick={toggleMute}
              className={`p-2 rounded-[8px] text-xs font-medium transition-colors ${
                localPlayer.isMutedByAdmin
                  ? 'bg-lira-amber/15 text-lira-amber border border-lira-amber/50 hover:bg-lira-amber/25'
                  : isMuted
                  ? 'bg-lira-error/15 text-lira-error border border-lira-error/40 hover:bg-lira-error/25'
                  : 'bg-lira-surface text-lira-ink border border-lira-rule hover:border-lira-accent hover:text-lira-accent'
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
                <MicOff className={`w-4 h-4 ${localPlayer.isMutedByAdmin ? 'text-lira-amber' : ''}`} />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={toggleDeafen}
              className={`p-2 rounded-[8px] text-xs font-medium transition-colors ${
                isDeafened
                  ? 'bg-lira-error/15 text-lira-error border border-lira-error/40 hover:bg-lira-error/25'
                  : 'bg-lira-surface text-lira-ink border border-lira-rule hover:border-lira-accent hover:text-lira-accent'
              }`}
              title={
                isDeafened
                  ? 'Reativar som da chamada para você'
                  : 'Mutar o som para mim (Ensurdecer)'
              }
            >
              <Headphones className="w-4 h-4" />
            </button>

            <button
              onClick={toggleCamera}
              className={`p-2 rounded-[8px] text-xs font-medium transition-colors ${
                isCameraOff
                  ? 'bg-lira-error/15 text-lira-error border border-lira-error/40 hover:bg-lira-error/25'
                  : 'bg-lira-surface text-lira-ink border border-lira-rule hover:border-lira-accent hover:text-lira-accent'
              }`}
              title={isCameraOff ? 'Ligar Câmera' : 'Desligar Câmera'}
            >
              {isCameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
            </button>

            <div className="relative">
              <button
                onClick={handleToggleScreenShare}
                className={`p-2 rounded-[8px] text-xs font-medium transition-colors ${
                  isScreenSharing
                    ? 'bg-lira-error text-lira-ground border border-lira-error font-bold animate-pulse'
                    : 'bg-lira-surface text-lira-ink border border-lira-rule hover:border-lira-accent hover:text-lira-accent'
                }`}
                title={isScreenSharing ? 'Opções da Transmissão (Ao Vivo)' : 'Compartilhar Tela'}
              >
                <ScreenShare className="w-4 h-4" />
              </button>

              {isScreenSharing && isActiveStreamMenuOpen && (
                <div
                  ref={streamMenuRef}
                  className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-48 bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-1.5 z-50 select-none font-mono"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2.5 py-1 text-[10px] font-bold text-lira-error uppercase tracking-wider flex items-center gap-1.5 border-b border-dashed border-lira-rule/60 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-lira-error animate-pulse" />
                    Ao Vivo
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsActiveStreamMenuOpen(false)
                      setIsScreenModalOpen(true)
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-xs font-medium text-lira-ink hover:text-lira-accent hover:bg-lira-surface transition-colors text-left"
                  >
                    <Sliders className="w-3.5 h-3.5 text-lira-accent shrink-0" />
                    <span>Trocar configurações</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsActiveStreamMenuOpen(false)
                      MediaManager.getInstance().stopScreenShare()
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-xs font-medium text-lira-error hover:bg-lira-error/15 transition-colors text-left"
                  >
                    <StopCircle className="w-3.5 h-3.5 text-lira-error shrink-0" />
                    <span>Encerrar transmissão</span>
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={handleOpenRoomChat}
              className={`p-2 rounded-[8px] border text-xs font-medium transition-colors relative ${
                isChatOpen && activeChannelId === (isProximityCall ? 'general' : 'current-zone')
                  ? 'bg-lira-accent text-lira-ground border-lira-accent'
                  : 'bg-lira-surface text-lira-ink border-lira-rule hover:border-lira-accent hover:text-lira-accent'
              }`}
              title={isProximityCall ? 'Ir para o Chat Geral' : `Ir para o Chat da Sala (${zoneName})`}
            >
              <MessageSquare className="w-4 h-4" />
              {!isProximityCall && unreadZoneCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-lira-amber border border-lira-ground flex items-center justify-center text-[8px] font-mono tabular-nums font-bold text-lira-ground">
                  {unreadZoneCount > 9 ? '9+' : unreadZoneCount}
                </span>
              )}
            </button>

            <div className="relative">
              <button
                onClick={() => setIsNoiseMenuOpen((prev) => !prev)}
                className={`p-2 rounded-[8px] text-xs font-medium transition-colors ${
                  noiseDisplay.canRetry
                    ? 'bg-lira-amber/15 text-lira-amber border border-lira-amber/40 hover:bg-lira-amber/25'
                    : isNoiseSuppressionEnabled
                    ? 'bg-lira-online/15 text-lira-online border border-lira-online/40 hover:bg-lira-online/25'
                    : 'bg-lira-surface text-lira-muted border border-lira-rule hover:border-lira-accent hover:text-lira-ink'
                }`}
                title={noiseDisplay.title}
              >
                <AudioLines className={`w-4 h-4 ${noiseDisplay.canRetry ? 'text-lira-amber' : isNoiseSuppressionEnabled ? 'text-lira-online' : ''}`} />
              </button>

              {isNoiseMenuOpen && (
                <div
                  ref={noiseMenuRef}
                  className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-60 bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-1.5 z-50 select-none font-mono"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2.5 py-1 text-[10px] font-bold text-lira-online uppercase tracking-wider flex items-center justify-between border-b border-dashed border-lira-rule/60 mb-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          noiseDisplay.canRetry ? 'bg-lira-amber' : isNoiseSuppressionEnabled ? 'bg-lira-online animate-pulse' : 'bg-lira-muted'
                        }`}
                      />
                      <span>Supressor de Ruído</span>
                    </div>
                    <span
                      className={`text-[8.5px] font-mono tabular-nums px-1.5 py-0.5 rounded-[4px] font-bold uppercase ${
                        noiseDisplay.canRetry
                          ? 'bg-lira-amber/15 text-lira-amber'
                          : isNoiseSuppressionEnabled
                          ? 'bg-lira-online/15 text-lira-online'
                          : 'bg-lira-surface text-lira-muted'
                      }`}
                    >
                      {noiseDisplay.badge}
                    </span>
                  </div>

                  <NoiseSuppressionNotice message={noiseDisplay.notice} warning={noiseDisplay.canRetry} />
                  <div className="space-y-0.5">
                    {NOISE_ENGINES.map((engine) => {
                      const isSelected = noiseDisplay.activeMode === engine.id
                      const Icon = engine.icon
                      return (
                        <button
                          key={engine.id}
                          type="button"
                          aria-pressed={isSelected}
                          title={engine.id === processingMode && noiseDisplay.canRetry ? processingMode === 'deepfilter' ? 'Tentar DeepFilterNet novamente' : 'Tentar RNNoise novamente' : undefined}
                          onClick={async () => {
                            setIsNoiseMenuOpen(false)
                            if (!isNoiseSuppressionEnabled) {
                              toggleNoiseSuppression()
                              MediaManager.getInstance().updateNoiseSuppression(true)
                            }
                            if (audioProcessorMode !== engine.id || processingMode !== engine.id || (engine.id === processingMode && noiseDisplay.canRetry)) {
                              setAudioProcessorMode(engine.id)
                              await MediaManager.getInstance().reprocessStream()
                            }
                          }}
                          className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[8px] text-xs font-medium transition-colors text-left ${
                            isSelected
                              ? 'bg-lira-surface text-lira-online border border-lira-online/40 font-bold'
                              : 'text-lira-ink hover:text-lira-accent hover:bg-lira-surface border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isSelected ? 'text-lira-online' : 'text-lira-muted'
                              }`}
                            />
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate">{engine.name}</span>
                                {engine.badge && (
                                  <span className="text-[8px] px-1 py-0.2 rounded-[4px] bg-lira-ground border border-lira-quiet text-lira-muted font-normal">
                                    {engine.badge}
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] text-lira-muted font-normal whitespace-normal leading-snug">
                                {engine.id === processingMode && noiseDisplay.canRetry ? 'Indisponível · clique para tentar novamente' : engine.desc}
                              </span>
                            </div>
                          </div>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-lira-online shrink-0 ml-1.5" />
                          )}
                        </button>
                      )
                    })}
                  </div>

                  <div className="my-1 border-t border-dashed border-lira-rule/60" />

                  <button
                    type="button"
                    onClick={() => {
                      setIsNoiseMenuOpen(false)
                      if (isNoiseSuppressionEnabled) {
                        toggleNoiseSuppression()
                        MediaManager.getInstance().updateNoiseSuppression(false)
                      }
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[8px] text-xs font-medium transition-colors text-left ${
                      !isNoiseSuppressionEnabled
                        ? 'bg-lira-error/15 text-lira-error border border-lira-error/40 font-bold'
                        : 'text-lira-muted hover:text-lira-error hover:bg-lira-surface border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Power
                        className={`w-3.5 h-3.5 shrink-0 ${
                          !isNoiseSuppressionEnabled ? 'text-lira-error' : 'text-lira-muted'
                        }`}
                      />
                      <span>Supressor desligado</span>
                    </div>
                    {!isNoiseSuppressionEnabled && (
                      <Check className="w-3.5 h-3.5 text-lira-error shrink-0 ml-1.5" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {currentZone && (
              <button
                onClick={() => setIsRoomSettingsOpen(true)}
                className="p-2 rounded-[8px] text-xs font-medium bg-lira-surface border border-lira-rule text-lira-muted hover:border-lira-accent hover:text-lira-accent transition-colors"
                title="Gerenciar Usuários com Permissão de Entrada"
              >
                <Shield className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => useMediaStore.getState().setSettingsModalOpen(true)}
              className="p-2 rounded-[8px] text-xs font-medium bg-lira-surface border border-lira-rule text-lira-ink hover:border-lira-accent hover:text-lira-accent transition-colors"
              title="Configurações de Áudio e Voz"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </CallPanelBody>
    </div>
  </div>

      <ScreenShareModal
        isOpen={isScreenModalOpen}
        onClose={() => setIsScreenModalOpen(false)}
      />

      {currentZone && isRoomSettingsOpen && (
        <RoomSettingsModal
          zone={currentZone}
          isOpen={isRoomSettingsOpen}
          onClose={() => setIsRoomSettingsOpen(false)}
          initialTab="permissions"
        />
      )}

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

