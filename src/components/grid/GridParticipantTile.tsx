import React, { useEffect, useRef } from 'react'
import { Radio, MicOff, Maximize, Pin, Maximize2, Volume2, Volume1, VolumeX, Headphones } from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'
import { useUserNetworkQuality } from '../../store/useNetworkQualityStore'
import { NetworkSignalIcon } from '../NetworkSignalIcon'
import { attachStreamToVideo } from '../../media/attachVideoElement'

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
  shirtColor?: string
  statusEmoji?: string
  callState?: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
  onRetryCall?: () => void
}

interface Props {
  user: ParticipantData
  isFocused?: boolean
  isSidebar?: boolean
  onFocus?: () => void
  onOpenLiveFullscreen?: (user: ParticipantData) => void
  onContextMenu?: (user: ParticipantData, e: React.MouseEvent) => void
}

export const GridParticipantTile: React.FC<Props> = ({
  user,
  isFocused = false,
  isSidebar = false,
  onFocus,
  onOpenLiveFullscreen,
  onContextMenu,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const isLive = Boolean(user.screenStream || user.isScreenSharing)
  const activeStream = user.screenStream || user.stream

  // Granular selectors: the media store updates on every VU-meter tick and
  // every peer-stream change — subscribing whole-store would re-render every
  // tile on each tick. Select only the volume/output slices this tile needs.
  const participantVolumes = useMediaStore((s) => s.participantVolumes)
  const setParticipantVolume = useMediaStore((s) => s.setParticipantVolume)
  const liveStreamVolume = useMediaStore((s) => s.liveStreamVolume)
  const setLiveStreamVolume = useMediaStore((s) => s.setLiveStreamVolume)
  const outputVolume = useMediaStore((s) => s.outputVolume)
  const selectedAudioOutput = useMediaStore((s) => s.selectedAudioOutput)
  const isDeafened = useMediaStore((s) => s.isDeafened)
  const isSilenced = useMediaStore((s) => s.isUserSilenced(user.id, user.name))
  const networkQuality = useUserNetworkQuality(user.id, user.isLocal)

  const rawVolume =
    participantVolumes[user.id] !== undefined
      ? participantVolumes[user.id]
      : user.gameId && participantVolumes[user.gameId] !== undefined
      ? participantVolumes[user.gameId]
      : isLive && liveStreamVolume !== undefined
      ? liveStreamVolume
      : 100

  const isEffectivelyMuted = Boolean(user.isLocal || isDeafened || isSilenced || rawVolume === 0)

  // Apply viewer's volume preference & audio output sink
  useEffect(() => {
    if (videoRef.current && !user.isLocal) {
      const effectiveVol = isEffectivelyMuted
        ? 0
        : Math.max(0, Math.min(1, (outputVolume / 100) * (rawVolume / 100)))
      videoRef.current.volume = effectiveVol
      videoRef.current.muted = isEffectivelyMuted
      if (typeof (videoRef.current as any).setSinkId === 'function' && selectedAudioOutput) {
        ;(videoRef.current as any)
          .setSinkId(selectedAudioOutput === 'default' ? '' : selectedAudioOutput)
          .catch(() => {})
      }
    }
  }, [rawVolume, outputVolume, selectedAudioOutput, user.isLocal, isEffectivelyMuted])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !activeStream) return

    video.muted = isEffectivelyMuted
    return attachStreamToVideo(video, activeStream, {
      tile: 'grid',
      peer: user.id,
      isLocal: !!user.isLocal,
      muted: isEffectivelyMuted,
      isLive,
    })
  }, [activeStream, isLive, user.isLocal, isEffectivelyMuted])

  const handleFullscreenClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onOpenLiveFullscreen) {
      onOpenLiveFullscreen(user)
    }
  }

  // Compact Sidebar Thumbnail
  if (isSidebar) {
    return (
      <div
        onClick={onFocus}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu?.(user, e)
        }}
        className={`group relative w-full aspect-video bg-[#12151d] rounded-2xl overflow-hidden border-2 transition-all flex items-center justify-center cursor-pointer shadow-md shrink-0 select-none ${
          user.isSpeaking
            ? 'border-emerald-500 ring-2 ring-emerald-500/30'
            : isFocused
            ? 'border-indigo-500 ring-2 ring-indigo-500/40'
            : 'border-[#2a3142] hover:border-slate-500'
        }`}
      >
        {isLive ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={user.isLocal}
            onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
            onCanPlay={() => videoRef.current?.play().catch(() => {})}
            className="w-full h-full object-cover bg-black"
          />
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={user.isLocal}
              onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
              onCanPlay={() => videoRef.current?.play().catch(() => {})}
              className={`w-full h-full object-cover ${user.isCameraOff ? 'hidden' : 'block'} ${
                user.isLocal ? '-scale-x-100' : ''
              }`}
            />
            {user.isCameraOff && (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-md border border-white/20"
                style={{ backgroundColor: user.shirtColor || '#4c6ef5' }}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
          </>
        )}

        {/* Live Badge if sharing in sidebar */}
        {isLive && (
          <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 bg-rose-600 text-white rounded-md text-[8px] font-bold shadow animate-pulse">
            <Radio className="w-2.5 h-2.5" />
            <span>AO VIVO</span>
          </div>
        )}

        {/* Reconnecting Badge in sidebar */}
        {!user.isLocal && !isLive && user.callState === 'reconnecting' && (
          <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-amber-500 text-white rounded text-[8px] font-bold shadow animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            <span>RECONECTANDO</span>
          </div>
        )}

        {/* Failed overlay in sidebar */}
        {!user.isLocal && !isLive && user.callState === 'failed' && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center p-1 text-center">
            <span className="text-[10px] text-rose-400 font-bold mb-1">Chamada caiu</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                user.onRetryCall?.()
              }}
              className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] rounded font-bold"
            >
              Reconectar
            </button>
          </div>
        )}

        {/* Small Bottom Name Tag */}
        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between px-2 py-0.5 bg-black/70 backdrop-blur-md rounded-lg text-[10px] text-white">
          <span className="truncate font-semibold">
            {isLive ? `Tela (${user.name})` : user.isLocal ? `${user.name} (Você)` : user.name}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {user.isDeafened && (
              <span title={user.isLocal ? "Você mutou o som para si" : "Usuário mutou o som para si (ensurdecido)"} className="flex items-center">
                <Headphones className="w-2.5 h-2.5 text-amber-400" />
              </span>
            )}
            {!user.isLocal && isSilenced && (
              <span title="Silenciado para você (mútuo)" className="flex items-center">
                <VolumeX className="w-2.5 h-2.5 text-amber-400" />
              </span>
            )}
            {!user.isLocal && !isSilenced && rawVolume === 0 && (
              <span title="Você mutou este áudio" className="flex items-center">
                <VolumeX className="w-2.5 h-2.5 text-rose-400" />
              </span>
            )}
            {user.isMuted && !isLive && (
              <span title={user.isMutedByAdmin ? "Mutado pelo Administrador" : "Microfone mutado"} className="flex items-center">
                <MicOff className={`w-2.5 h-2.5 shrink-0 ${user.isMutedByAdmin ? 'text-amber-400' : 'text-rose-400'}`} />
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

  // Large Main / Grid Tile
  return (
    <div
      onClick={onFocus}
      onDoubleClick={handleFullscreenClick}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextMenu?.(user, e)
      }}
      className={`group relative w-full h-full bg-[#12151d] rounded-3xl overflow-hidden border-2 transition-all flex items-center justify-center shadow-2xl cursor-pointer select-none ${
        user.isSpeaking
          ? 'border-emerald-500 shadow-emerald-500/20 shadow-lg ring-2 ring-emerald-500/30'
          : isFocused
          ? 'border-indigo-500 ring-2 ring-indigo-500/30'
          : 'border-[#2a3142] hover:border-slate-500'
      }`}
    >
      {/* Screen Share or Video Content */}
      {isLive ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={user.isLocal}
          onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
          onCanPlay={() => videoRef.current?.play().catch(() => {})}
          className="w-full h-full object-contain bg-black"
        />
      ) : (
        <>
          {/* Main Camera Video */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={user.isLocal}
            onLoadedMetadata={() => videoRef.current?.play().catch(() => {})}
            onCanPlay={() => videoRef.current?.play().catch(() => {})}
            className={`w-full h-full object-cover ${user.isCameraOff ? 'hidden' : 'block'} ${
              user.isLocal ? '-scale-x-100' : ''
            }`}
          />

          {/* Camera Off Avatar Screen */}
          {user.isCameraOff && (
            <div className="flex flex-col items-center gap-3">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-extrabold text-white shadow-2xl border-2 border-white/20"
                style={{ backgroundColor: user.shirtColor || '#4c6ef5' }}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="text-sm font-semibold text-slate-300 flex items-center gap-1.5">
                <span>{user.name}</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Top Badges: LIVE indicator + Reconnecting + Action Buttons */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none z-10">
        {isLive ? (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-rose-600/95 text-white rounded-xl text-xs font-bold shadow-lg flex-shrink-0 animate-pulse pointer-events-auto">
            <Radio className="w-3.5 h-3.5" />
            <span>TRANSMISSÃO AO VIVO DE TELA</span>
          </div>
        ) : !user.isLocal && user.callState === 'reconnecting' ? (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/95 text-white rounded-xl text-xs font-bold shadow-lg flex-shrink-0 animate-pulse pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            <span>RECONECTANDO ÁUDIO/VÍDEO...</span>
          </div>
        ) : !user.isLocal && user.callState === 'connecting' ? (
          <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500/95 text-white rounded-xl text-xs font-bold shadow-lg flex-shrink-0 animate-pulse pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            <span>CONECTANDO ÁUDIO/VÍDEO...</span>
          </div>
        ) : (
          <div />
        )}

        {/* Failed state overlay for main tile */}
        {!user.isLocal && !isLive && user.callState === 'failed' && (
          <div className="absolute inset-0 bg-black/85 backdrop-blur-md z-30 flex flex-col items-center justify-center p-4 text-center pointer-events-auto">
            <span className="text-base text-rose-400 font-bold mb-1">Conexão de áudio/vídeo perdida</span>
            <p className="text-xs text-slate-300 mb-3 max-w-xs">A chamada com este participante caiu devido a instabilidade na rede.</p>
            <button
              onClick={(e) => {
                e.stopPropagation()
                user.onRetryCall?.()
              }}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer"
            >
              Reconectar Chamada
            </button>
          </div>
        )}

        {/* Action buttons on hover */}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
          {/* Viewer Volume Control for Remote User */}
          {!user.isLocal && (
            <div
              className="relative group/vol flex items-center bg-black/80 hover:bg-black/95 rounded-xl border border-white/15 px-2 py-1.5 backdrop-blur-md shadow-md gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const nextVol = rawVolume === 0 ? 100 : 0
                  setParticipantVolume(user.id, nextVol)
                  if (user.name) setParticipantVolume(user.name, nextVol)
                  if (isLive) setLiveStreamVolume(nextVol)
                }}
                className="p-0.5 rounded text-slate-300 hover:text-white transition-colors"
                title={rawVolume === 0 ? 'Desmutar este participante' : 'Mutar este participante'}
              >
                {rawVolume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                ) : rawVolume < 50 ? (
                  <Volume1 className="w-3.5 h-3.5 text-indigo-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                )}
              </button>

              {/* Slider expands smoothly on hover */}
              <div className="w-0 group-hover/vol:w-28 transition-all duration-200 overflow-hidden flex items-center gap-1.5">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={rawVolume}
                  onChange={(e) => {
                    const val = Number(e.target.value)
                    setParticipantVolume(user.id, val)
                    if (user.name) setParticipantVolume(user.name, val)
                    if (isLive) setLiveStreamVolume(val)
                  }}
                  className="w-16 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
                  title={`Volume: ${rawVolume}%`}
                />
                <span className="text-[10px] font-mono text-slate-200 min-w-[28px]">
                  {rawVolume}%
                </span>
              </div>
            </div>
          )}

          <button
            onClick={handleFullscreenClick}
            className="px-3 py-1.5 rounded-xl bg-black/80 hover:bg-indigo-600 text-white backdrop-blur-md transition-all shadow-md flex items-center gap-1.5 text-xs font-bold"
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
              className={`p-2 rounded-xl backdrop-blur-md transition-colors shadow-md ${
                isFocused ? 'bg-indigo-600 text-white' : 'bg-black/80 hover:bg-slate-700 text-white'
              }`}
              title={isFocused ? 'Desafixar' : 'Fixar / Destacar'}
            >
              <Pin className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom Name Pill */}
      <div className="absolute bottom-3 left-3 pointer-events-none z-10">
        <div className="bg-black/80 backdrop-blur-md px-3.5 py-1.5 rounded-xl flex items-center gap-2 border border-white/10 text-xs font-semibold text-white pointer-events-auto">
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
              className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-950/70 px-1.5 py-0.5 rounded border border-amber-800/50"
              title={user.isLocal ? "Você mutou o som para si" : "Usuário mutou o som para si (ensurdecido)"}
            >
              <Headphones className="w-3 h-3 text-amber-400" />
              <span>Som Desativado</span>
            </span>
          )}
          {!user.isLocal && isSilenced && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/70 px-1.5 py-0.5 rounded border border-amber-800/40" title="Silenciado mutuamente">
              <VolumeX className="w-3 h-3" />
              <span>Silenciado para você</span>
            </span>
          )}
          {!user.isLocal && !isSilenced && rawVolume === 0 && (
            <span className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800/40">
              <VolumeX className="w-3 h-3" />
              <span>Mutado para você</span>
            </span>
          )}
          {user.isMuted && !isLive && (
            <div
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${
                user.isMutedByAdmin
                  ? 'text-amber-300 bg-amber-950/70 border-amber-800/50 font-bold'
                  : 'text-rose-400 border-transparent'
              }`}
              title={user.isMutedByAdmin ? "Mutado pelo Administrador" : "Microfone mutado"}
            >
              <MicOff className={`w-3.5 h-3.5 ${user.isMutedByAdmin ? 'text-amber-400' : 'text-rose-400'}`} />
              {user.isMutedByAdmin && <span>Mutado por ADM</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
