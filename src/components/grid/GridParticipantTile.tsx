import React, { useEffect, useMemo, useRef } from 'react'
import { Radio, MicOff, Maximize, Pin, Maximize2, Volume2, Volume1, VolumeX, Headphones, EyeOff } from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'
import { useUserNetworkQuality } from '../../store/useNetworkQualityStore'
import { NetworkSignalIcon } from '../NetworkSignalIcon'
import { attachStreamToVideo } from '../../media/attachVideoElement'
import { AvatarConfig } from '../../types/game'
import { PlayerAvatar } from '../common/PlayerAvatar'
import { RemoteAudio } from '../common/RemoteAudio'
import { SpotifyIcon } from '../common/SpotifyIcon'
import { LiveWatchPrompt } from '../LiveWatchPrompt'
import { useLiveGate } from '../../hooks/useLiveGate'
import { useLiveViewBox } from '../../hooks/useLiveViewBox'
import { LiveTransmissionInfo } from './LiveTransmissionInfo'
import { useLiveFrameFit } from '../../hooks/useLiveFrameFit'

export interface ParticipantData {
  id: string
  gameId?: string
  name: string
  stream: MediaStream | null
  screenStream?: MediaStream | null
  isMuted?: boolean
  isMutedByAdmin?: boolean
  isDeafened?: boolean
  isCameraOff?: boolean
  isLocal?: boolean
  isScreenSharing?: boolean
  isSpeaking?: boolean
  isDjBot?: boolean
  profilePicture?: string
  avatar?: AvatarConfig
  shirtColor?: string
  statusEmoji?: string
  callState?: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
  onRetryCall?: () => void
  liveOptIn?: boolean
  liveWatching?: boolean
}

interface Props {
  user: ParticipantData
  mediaKind?: 'participant' | 'live'
  isFocused?: boolean
  isSidebar?: boolean
  onFocus?: () => void
  onOpenLiveFullscreen?: (user: ParticipantData) => void
  onOpenScreenShareSettings?: () => void
  onContextMenu?: (user: ParticipantData, e: React.MouseEvent) => void
}

export const GridParticipantTile: React.FC<Props> = ({
  user,
  mediaKind,
  isFocused = false,
  isSidebar = false,
  onFocus,
  onOpenLiveFullscreen,
  onOpenScreenShareSettings,
  onContextMenu,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const hasLive = Boolean(user.screenStream || user.isScreenSharing)
  const isLive = mediaKind !== 'participant' && hasLive
  // Some peers send the screen in the regular call stream. It cannot also be
  // displayed as their camera or played a second time in the participant card.
  const participantStream = hasLive && !user.isLocal && (!user.screenStream || user.stream === user.screenStream)
    ? null
    : user.stream
  const activeStream = isLive ? user.screenStream || user.stream : participantStream
  const liveGate = useLiveGate(user.id, Boolean(!user.isLocal && isLive && user.liveOptIn), !!user.liveWatching)

  const participantVolumes = useMediaStore((s) => s.participantVolumes)
  const setParticipantVolume = useMediaStore((s) => s.setParticipantVolume)
  const liveStreamVolume = useMediaStore((s) => s.liveStreamVolume)
  const setLiveStreamVolume = useMediaStore((s) => s.setLiveStreamVolume)
  const outputVolume = useMediaStore((s) => s.outputVolume)
  const selectedAudioOutput = useMediaStore((s) => s.selectedAudioOutput)
  const isDeafened = useMediaStore((s) => s.isDeafened)
  const isSilenced = useMediaStore((s) => s.isUserSilenced(user.id, user.name))
  const networkQuality = useUserNetworkQuality(user.id, user.isLocal)

  const rawVolume = isLive ? (liveStreamVolume ?? 100)
    : participantVolumes[user.id] !== undefined
      ? participantVolumes[user.id]
      : user.gameId && participantVolumes[user.gameId] !== undefined
      ? participantVolumes[user.gameId]
      : 100

  const setVolume = (value: number) => {
    if (isLive) {
      setLiveStreamVolume(value)
    } else {
      setParticipantVolume(user.id, value)
      if (user.name) setParticipantVolume(user.name, value)
    }
  }

  const isEffectivelyMuted = Boolean(user.isLocal || isDeafened || isSilenced || rawVolume === 0)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !activeStream) return

    video.muted = true
    return attachStreamToVideo(video, activeStream, {
      tile: 'grid',
      peer: user.id,
      isLocal: !!user.isLocal,
      muted: true,
      isLive,
    })
  }, [activeStream, isLive, user.isLocal, liveGate.needsClick])

  useLiveViewBox(user.id, videoRef, 'contain', liveGate.watching)
  const frameStyle = useLiveFrameFit(frameRef, videoRef, activeStream, isLive && !liveGate.needsClick, { inset: 4, widthOnly: isSidebar })

  const remoteAudio =
    !user.isLocal && activeStream ? (
      <RemoteAudio
        stream={activeStream}
        tile="grid-audio"
        peer={user.id}
        muted={isEffectivelyMuted}
        volume={(outputVolume / 100) * (rawVolume / 100)}
        sinkId={selectedAudioOutput}
      />
    ) : null

  const hasLiveVideoTrack = useMemo(() => {
    if (!activeStream) return false
    const videoTracks = activeStream.getVideoTracks()
    return videoTracks.some((t) => t.readyState === 'live' && t.enabled && !(t as any).__isDummy)
  }, [activeStream])

  const isCameraEffectivelyOff = user.isCameraOff ?? !hasLiveVideoTrack
  const shouldShowVideo = isLive || (!isCameraEffectivelyOff && hasLiveVideoTrack)

  const handleFullscreenClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onOpenLiveFullscreen) {
      onOpenLiveFullscreen(user)
    }
  }

  if (isSidebar) {
    return (
      <div
        ref={frameRef}
        style={frameStyle}
        onClick={onFocus}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu?.(user, e)
        }}
        className={`group relative w-full aspect-video bg-lira-surface rounded-[8px] overflow-hidden border transition-colors flex items-center justify-center cursor-pointer shrink-0 select-none font-mono ${
          user.isSpeaking
            ? 'border-lira-online ring-1 ring-lira-online/40'
            : isFocused
            ? 'border-lira-accent ring-1 ring-lira-accent/40'
            : 'border-lira-quiet hover:border-lira-rule'
        }`}
      >
        {liveGate.needsClick ? (
          <PlayerAvatar
            name={user.name}
            profilePicture={user.profilePicture}
            avatar={user.avatar}
            size="lg"
            className="w-10 h-10 rounded-[6px] border border-lira-quiet"
          />
        ) : isLive ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
            onCanPlay={() => videoRef.current?.play().catch(() => {})}
            onLoadedData={liveGate.onFrame}
            onPlaying={liveGate.onFrame}
            className="w-full h-full object-contain bg-lira-ground"
          />
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
              onCanPlay={() => videoRef.current?.play().catch(() => {})}
              className={`w-full h-full object-cover ${shouldShowVideo ? 'block' : 'hidden'} ${
                user.isLocal ? '-scale-x-100' : ''
              }`}
            />
            {!shouldShowVideo && (
              <PlayerAvatar
                name={user.name}
                profilePicture={user.profilePicture}
                avatar={user.avatar}
                size="lg"
                className="w-10 h-10 rounded-[6px] border border-lira-quiet"
              />
            )}
          </>
        )}

        {(liveGate.needsClick || liveGate.connecting) && (
          <LiveWatchPrompt size="tile" name={user.name} connecting={liveGate.connecting} onWatch={liveGate.watch} />
        )}

        {remoteAudio}

        {isLive && (
          <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 bg-lira-error text-lira-ground rounded-[4px] text-[8px] font-mono font-bold">
            <Radio className="w-2.5 h-2.5" />
            <span>AO VIVO</span>
          </div>
        )}

        {!user.isLocal && !isLive && user.callState === 'reconnecting' && (
          <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-lira-amber text-lira-ground rounded-[4px] text-[8px] font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-lira-ground animate-ping" />
            <span>RECONECTANDO</span>
          </div>
        )}

        {!user.isLocal && !isLive && user.callState === 'failed' && (
          <div className="absolute inset-0 bg-lira-ground/90 z-20 flex flex-col items-center justify-center p-1 text-center">
            <span className="text-[10px] text-lira-error font-mono font-bold mb-1">Chamada caiu</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                user.onRetryCall?.()
              }}
              className="px-2 py-0.5 bg-lira-accent hover:bg-lira-ink text-lira-ground text-[9px] rounded-[6px] font-mono font-bold"
            >
              Reconectar
            </button>
          </div>
        )}

        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between px-2 py-0.5 bg-lira-ground/85 border border-lira-quiet rounded-[6px] text-[10px] font-mono text-lira-ink">
          <span className="truncate font-semibold flex items-center gap-1.5 min-w-0">
            <span className="truncate">{isLive ? `Tela (${user.name})` : user.isLocal ? `${user.name} (Você)` : user.name}</span>
            {(user.isDjBot || user.id.startsWith('dj-') || user.name.includes('DJ')) && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.2 bg-lira-online text-lira-ground text-[8px] font-extrabold rounded-[4px] shrink-0" title="DJ">
                <SpotifyIcon size={9} className="text-lira-ground" />
                <span>DJ</span>
              </span>
            )}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {user.isDeafened && (
              <span title={user.isLocal ? "Você mutou o som para si" : "Usuário mutou o som para si (ensurdecido)"} className="flex items-center">
                <Headphones className="w-2.5 h-2.5 text-lira-amber" />
              </span>
            )}
            {!user.isLocal && isSilenced && (
              <span title="Silenciado para você (mútuo)" className="flex items-center">
                <VolumeX className="w-2.5 h-2.5 text-lira-amber" />
              </span>
            )}
            {!user.isLocal && !isSilenced && rawVolume === 0 && (
              <span title="Você mutou este áudio" className="flex items-center">
                <VolumeX className="w-2.5 h-2.5 text-lira-error" />
              </span>
            )}
            {user.isMuted && !isLive && (
              <span title={user.isMutedByAdmin ? "Mutado pelo Administrador" : "Microfone mutado"} className="flex items-center">
                <MicOff className={`w-2.5 h-2.5 shrink-0 ${user.isMutedByAdmin ? 'text-lira-amber' : 'text-lira-error'}`} />
              </span>
            )}
            <NetworkSignalIcon
              rating={networkQuality.rating}
              pingMs={networkQuality.pingMs}
              lossPct={networkQuality.lossPct}
              showPingText={false}
              size="sm"
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={frameRef}
      style={frameStyle}
      onClick={onFocus}
      onDoubleClick={handleFullscreenClick}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(user, e)
      }}
      className={`group relative w-full h-full bg-lira-panel rounded-[12px] overflow-hidden border transition-colors flex items-center justify-center cursor-pointer select-none font-mono ${
        user.isSpeaking
          ? 'border-lira-online ring-1 ring-lira-online/40'
          : isFocused
          ? 'border-lira-accent ring-1 ring-lira-accent/40'
          : 'border-lira-quiet hover:border-lira-rule'
      }`}
    >
      {liveGate.needsClick ? null : isLive ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
          onCanPlay={() => videoRef.current?.play().catch(() => {})}
          onLoadedData={liveGate.onFrame}
          onPlaying={liveGate.onFrame}
          className="w-full h-full object-contain bg-lira-ground"
        />
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
            onCanPlay={() => videoRef.current?.play().catch(() => {})}
            className={`w-full h-full object-cover ${shouldShowVideo ? 'block' : 'hidden'} ${
              user.isLocal ? '-scale-x-100' : ''
            }`}
          />

          {!shouldShowVideo && (
            <div className="flex flex-col items-center gap-3.5">
              <PlayerAvatar
                name={user.name}
                profilePicture={user.profilePicture}
                avatar={user.avatar}
                size="4xl"
                className="w-28 h-28 sm:w-32 sm:h-32 md:w-36 md:h-36 rounded-[12px] border border-dashed border-lira-rule"
              />
              <div className="font-display text-base sm:text-lg font-bold text-lira-ink flex items-center gap-2">
                <span>{user.name}</span>
                {(user.isDjBot || user.id.startsWith('dj-') || user.name.includes('DJ')) && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-lira-online text-lira-ground text-[10px] font-mono font-extrabold rounded-[4px]" title="DJ">
                    <SpotifyIcon size={11} className="text-lira-ground" />
                    <span>DJ</span>
                  </span>
                )}
                {user.isMuted && <MicOff className="w-3.5 h-3.5 text-lira-error" />}
              </div>
            </div>
          )}
        </>
      )}

      {(liveGate.needsClick || liveGate.connecting) && (
        <LiveWatchPrompt size="stage" name={user.name} connecting={liveGate.connecting} onWatch={liveGate.watch} />
      )}

      {remoteAudio}

      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none z-10">
        {isLive ? (
          <LiveTransmissionInfo stream={activeStream} local={!!user.isLocal} peerName={user.name}
            onOpenSettings={user.isLocal ? onOpenScreenShareSettings : undefined} />
        ) : !user.isLocal && user.callState === 'reconnecting' ? (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-lira-amber text-lira-ground rounded-[8px] text-xs font-mono font-bold flex-shrink-0 pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-lira-ground animate-ping" />
            <span>RECONECTANDO ÁUDIO/VÍDEO...</span>
          </div>
        ) : !user.isLocal && user.callState === 'connecting' ? (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-lira-surface border border-lira-accent text-lira-accent rounded-[8px] text-xs font-mono font-bold flex-shrink-0 pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-lira-accent animate-ping" />
            <span>CONECTANDO ÁUDIO/VÍDEO...</span>
          </div>
        ) : (
          <div />
        )}

        {!user.isLocal && !isLive && user.callState === 'failed' && (
          <div className="absolute inset-0 bg-lira-ground/90 z-30 flex flex-col items-center justify-center p-4 text-center pointer-events-auto">
            <span className="font-display text-lg text-lira-error font-bold mb-1">Conexão de áudio/vídeo perdida</span>
            <p className="text-xs font-mono text-lira-muted mb-3 max-w-xs">A chamada com este participante caiu devido a instabilidade na rede.</p>
            <button
              onClick={(e) => {
                e.stopPropagation()
                user.onRetryCall?.()
              }}
              className="px-4 py-1.5 bg-lira-accent hover:bg-lira-ink text-lira-ground text-xs font-mono font-bold rounded-[8px] transition-colors cursor-pointer"
            >
              Reconectar Chamada
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
          {!user.isLocal && (
            <div
              className="relative group/vol flex items-center bg-lira-panel/95 hover:border-lira-accent rounded-[8px] border border-lira-rule px-2 py-1.5 gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const nextVol = rawVolume === 0 ? 100 : 0
                  setVolume(nextVol)
                }}
                className="p-0.5 rounded-[4px] text-lira-muted hover:text-lira-ink transition-colors"
                title={isLive ? (rawVolume === 0 ? 'Desmutar transmissão' : 'Mutar transmissão') : (rawVolume === 0 ? 'Desmutar este participante' : 'Mutar este participante')}
              >
                {rawVolume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 text-lira-error" />
                ) : rawVolume < 50 ? (
                  <Volume1 className="w-3.5 h-3.5 text-lira-accent" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-lira-accent" />
                )}
              </button>

              <div className="w-0 group-hover/vol:w-32 transition-all duration-200 overflow-hidden flex items-center gap-1.5">
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={rawVolume}
                  onChange={(e) => {
                    const val = Number(e.target.value)
                    setVolume(val)
                  }}
                  className="w-16 h-1 bg-lira-surface rounded-[4px] appearance-none cursor-pointer accent-lira-accent"
                  aria-label={isLive ? 'Volume da live' : 'Volume da voz'}
                  title={`${isLive ? 'Volume da live' : 'Volume da voz'}: ${rawVolume}%`}
                />
                <span className="text-[10px] font-mono tabular-nums text-lira-ink min-w-[32px]">
                  {rawVolume}%
                </span>
              </div>
            </div>
          )}

          {liveGate.watching && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                liveGate.stop()
              }}
              className="px-3 py-1.5 rounded-[8px] bg-lira-panel/95 hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-error/40 transition-colors flex items-center gap-1.5 text-xs font-mono font-bold"
              title="Deixar de receber o vídeo e o som desta transmissão"
            >
              <EyeOff className="w-4 h-4" />
              <span>Parar de assistir</span>
            </button>
          )}

          <button
            onClick={handleFullscreenClick}
            className="px-3 py-1.5 rounded-[8px] bg-lira-panel/95 hover:bg-lira-accent text-lira-ink hover:text-lira-ground border border-lira-rule hover:border-lira-accent transition-colors flex items-center gap-1.5 text-xs font-mono font-bold"
            title="Expandir Live em Tela Cheia do Monitor"
          >
            <Maximize className="w-4 h-4" />
            <span>Tela Cheia</span>
          </button>

          {onFocus && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onFocus()
              }}
              className={`p-2 rounded-[8px] border transition-colors ${
                isFocused ? 'bg-lira-accent text-lira-ground border-lira-accent' : 'bg-lira-panel/95 hover:bg-lira-surface text-lira-ink border-lira-rule'
              }`}
              title={isFocused ? 'Desafixar' : 'Fixar / Destacar'}
            >
              <Pin className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="absolute bottom-3 left-3 pointer-events-none z-10">
        <div className="bg-lira-panel/95 px-3.5 py-1.5 rounded-[8px] flex items-center gap-2 border border-dashed border-lira-rule text-xs font-mono font-semibold text-lira-ink pointer-events-auto">
          <span>{isLive ? `Tela de ${user.name}` : user.isLocal ? `${user.name} (Você)` : user.name}</span>
          <NetworkSignalIcon
            rating={networkQuality.rating}
            pingMs={networkQuality.pingMs}
            lossPct={networkQuality.lossPct}
            showPingText={true}
            size="sm"
          />
          {user.isDeafened && (
            <span
              className="flex items-center gap-1 text-[10px] text-lira-amber bg-lira-amber/15 px-1.5 py-0.5 rounded-[4px] border border-lira-amber/40"
              title={user.isLocal ? "Você mutou o som para si" : "Usuário mutou o som para si (ensurdecido)"}
            >
              <Headphones className="w-3 h-3 text-lira-amber" />
              <span>Som Desativado</span>
            </span>
          )}
          {!user.isLocal && isSilenced && (
            <span className="flex items-center gap-1 text-[10px] text-lira-amber bg-lira-amber/15 px-1.5 py-0.5 rounded-[4px] border border-lira-amber/40" title="Silenciado mutuamente">
              <VolumeX className="w-3 h-3" />
              <span>Silenciado para você</span>
            </span>
          )}
          {!user.isLocal && !isSilenced && rawVolume === 0 && (
            <span className="flex items-center gap-1 text-[10px] text-lira-error bg-lira-error/15 px-1.5 py-0.5 rounded-[4px] border border-lira-error/40">
              <VolumeX className="w-3 h-3" />
              <span>Mutado para você</span>
            </span>
          )}
          {user.isMuted && !isLive && (
            <div
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-[4px] border ${
                user.isMutedByAdmin
                  ? 'text-lira-amber bg-lira-amber/15 border-lira-amber/40 font-bold'
                  : 'text-lira-error border-transparent'
              }`}
              title={user.isMutedByAdmin ? "Mutado pelo Administrador" : "Microfone mutado"}
            >
              <MicOff className={`w-3.5 h-3.5 ${user.isMutedByAdmin ? 'text-lira-amber' : 'text-lira-error'}`} />
              {user.isMutedByAdmin && <span>Mutado por ADM</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
