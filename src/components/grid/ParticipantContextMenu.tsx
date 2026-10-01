import React, { useEffect, useRef } from 'react'
import {
  VolumeX,
  Volume2,
  Volume1,
  MicOff,
  Mic,
  Shield,
  Crown,
  Headphones,
  Radio,
  Check,
  Lock,
} from 'lucide-react'
import { ParticipantData } from './GridParticipantTile'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { PeerManager } from '../../p2p/PeerManager'

interface Props {
  user: ParticipantData
  x: number
  y: number
  onClose: () => void
}

export const ParticipantContextMenu: React.FC<Props> = ({ user, x, y, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)

  const localPlayer = useGameStore((s) => s.localPlayer)
  const mapData = useMapStore((s) => s.mapData)
  const currentZone = mapData.zones.find((z) => z.id === localPlayer.currentZoneId)

  // Verify whether the local player is an Admin/Owner/Host
  const isLocalAdmin = Boolean(
    localPlayer.isOwner ||
    localPlayer.role === 'owner' ||
    localPlayer.role === 'admin' ||
    localPlayer.role === 'host' ||
    (currentZone?.admins &&
      (currentZone.admins.includes(localPlayer.name) || currentZone.admins.includes(localPlayer.id)))
  )

  const isSilencedForMe = useMediaStore((s) => s.isUserSilenced(user.id, user.name))
  const isMutedForMe = useMediaStore((s) => s.isUserLocallyMuted(user.id, user.name))
  const isDeafened = useMediaStore((s) => s.isDeafened)
  const participantVolumes = useMediaStore((s) => s.participantVolumes)
  const setParticipantVolume = useMediaStore((s) => s.setParticipantVolume)

  const currentVol =
    participantVolumes[user.id] !== undefined
      ? participantVolumes[user.id]
      : user.gameId && participantVolumes[user.gameId] !== undefined
      ? participantVolumes[user.gameId]
      : 100

  const remotePlayer = useGameStore((s) =>
    s.remotePlayers[user.id] ||
    Object.values(s.remotePlayers).find(
      (p) => p.id === user.id || p.gameId === user.id || (user.gameId && (p.id === user.gameId || p.gameId === user.gameId))
    )
  )
  const isTargetMuted = remotePlayer ? Boolean(remotePlayer.isMuted) : Boolean(user.isMuted)
  const isTargetDeafened = remotePlayer ? Boolean(remotePlayer.isDeafened) : Boolean(user.isDeafened)

  // Close on outside click or escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // Viewport clamping
  const menuWidth = 260
  const menuHeight = isLocalAdmin ? 410 : 300
  const clampedX = Math.min(Math.max(10, x), window.innerWidth - menuWidth - 10)
  const clampedY = Math.min(Math.max(10, y), window.innerHeight - menuHeight - 10)

  // Actions
  const handleToggleSilenceForMe = (e: React.MouseEvent) => {
    e.stopPropagation()
    const nextSilenced = useMediaStore.getState().toggleSilenceUser(user.id, user.name)
    PeerManager.getInstance().sendUserAudioIsolation(user.id, nextSilenced)
    onClose()
  }

  const handleToggleMuteForMe = (e: React.MouseEvent) => {
    e.stopPropagation()
    useMediaStore.getState().toggleLocalMuteUser(user.id, user.name)
    onClose()
  }

  const handleAdminMuteForEveryone = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isLocalAdmin) return
    const nextMute = !isTargetMuted
    PeerManager.getInstance().sendAdminMuteParticipant(user.id, nextMute, user.name, user.gameId)
    onClose()
  }

  const handleAdminDeafenForEveryone = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isLocalAdmin) return
    const nextDeafen = !isTargetDeafened
    PeerManager.getInstance().sendAdminDeafenParticipant(user.id, nextDeafen, user.name, user.gameId)
    onClose()
  }

  const isLive = Boolean(user.screenStream || user.isScreenSharing)

  return (
    <div
      ref={menuRef}
      style={{ left: clampedX, top: clampedY }}
      className="fixed z-[100] w-64 bg-[#12151d]/95 backdrop-blur-xl border border-[#2a3142] rounded-2xl shadow-2xl p-2 select-none text-slate-200 animate-in fade-in zoom-in-95 duration-150"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header: User identity */}
      <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1.5 border-b border-[#2a3142]/80">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-sm border border-white/20 shrink-0"
          style={{ backgroundColor: user.shirtColor || '#4f46e5' }}
        >
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-white truncate flex items-center gap-1.5">
            <span>{user.isLocal ? `${user.name} (Você)` : user.name}</span>
            {isLive && (
              <span className="text-[8px] bg-rose-500/20 text-rose-400 border border-rose-500/40 px-1 py-0.2 rounded font-bold">
                LIVE
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 truncate">
            {user.isLocal ? 'Controles do seu perfil' : 'Opções de áudio e moderação'}
          </div>
        </div>
      </div>

      {/* 0. Controle de Volume do Usuário (0% a 200%) */}
      {!user.isLocal && (
        <div
          className="px-2.5 py-2 mb-1.5 bg-[#1b202c]/90 rounded-xl border border-[#2a3142]/90 shadow-inner"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-1.5">
            <span className="flex items-center gap-1.5">
              {currentVol === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-rose-400" />
              ) : currentVol < 50 ? (
                <Volume1 className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span>Volume</span>
            </span>
            <span
              className={`text-[11px] font-mono font-bold ${
                currentVol === 0
                  ? 'text-rose-400'
                  : currentVol > 100
                  ? 'text-amber-400'
                  : 'text-indigo-300'
              }`}
            >
              {currentVol}%
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="200"
              step="1"
              value={currentVol}
              onChange={(e) => {
                const val = Number(e.target.value)
                setParticipantVolume(user.id, val)
                if (user.name) setParticipantVolume(user.name, val)
              }}
              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
            />
          </div>

          <div className="flex items-center justify-between mt-1.5 text-[9px] text-slate-400">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setParticipantVolume(user.id, 0)
                if (user.name) setParticipantVolume(user.name, 0)
              }}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                currentVol === 0 ? 'text-rose-400 font-bold bg-rose-500/10' : 'hover:text-white hover:bg-slate-800'
              }`}
            >
              0%
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setParticipantVolume(user.id, 100)
                if (user.name) setParticipantVolume(user.name, 100)
              }}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                currentVol === 100 ? 'text-indigo-400 font-bold bg-indigo-500/10' : 'hover:text-white hover:bg-slate-800'
              }`}
            >
              100% (Padrão)
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setParticipantVolume(user.id, 200)
                if (user.name) setParticipantVolume(user.name, 200)
              }}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                currentVol === 200 ? 'text-amber-400 font-bold bg-amber-500/10' : 'hover:text-amber-300 hover:bg-slate-800'
              }`}
            >
              200%
            </button>
          </div>
        </div>
      )}

      {/* Local Options for remote user */}
      {!user.isLocal && (
        <div className="space-y-1">
          {/* 1. Silenciar para mim (mútuo: eu não o escuto, ele não me escuta) */}
          <button
            onClick={handleToggleSilenceForMe}
            className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
              isSilencedForMe
                ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                : 'hover:bg-slate-800/80 text-slate-200'
            }`}
          >
            <VolumeX className={`w-4 h-4 mt-0.5 shrink-0 ${isSilencedForMe ? 'text-amber-400' : 'text-slate-400'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold flex items-center justify-between">
                <span>{isSilencedForMe ? 'Desfazer silêncio' : 'Silenciar para mim'}</span>
                {isSilencedForMe && <Check className="w-3 h-3 text-amber-400" />}
              </div>
              <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
                Muta nos 2 sentidos (ele não te escuta, você não o escuta)
              </p>
            </div>
          </button>

          {/* 2. Mutar para mim (muta microfone dele apenas para mim) */}
          <button
            onClick={handleToggleMuteForMe}
            className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
              isMutedForMe
                ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                : 'hover:bg-slate-800/80 text-slate-200'
            }`}
          >
            <MicOff className={`w-4 h-4 mt-0.5 shrink-0 ${isMutedForMe ? 'text-rose-400' : 'text-slate-400'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold flex items-center justify-between">
                <span>{isMutedForMe ? 'Desmutar para mim' : 'Mutar para mim'}</span>
                {isMutedForMe && <Check className="w-3 h-3 text-rose-400" />}
              </div>
              <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
                Muta o microfone dele para você (ele ainda pode te escutar)
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Admin Section */}
      {!user.isLocal && (
        <>
          <div className="my-1.5 border-t border-[#2a3142]/80" />
          <div className="px-2 py-1 flex items-center justify-between text-[9px] font-bold tracking-wider uppercase text-amber-400/90">
            <span className="flex items-center gap-1">
              <Crown className="w-3 h-3" />
              Opções de Administrador
            </span>
            {!isLocalAdmin && (
              <span className="text-slate-500 flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" />
                Apenas ADMs
              </span>
            )}
          </div>

          <div className="space-y-1">
            {/* 3. Mutar para todos (Apenas ADMs) */}
            <button
              onClick={handleAdminMuteForEveryone}
              disabled={!isLocalAdmin}
              className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
                !isLocalAdmin
                  ? 'opacity-40 cursor-not-allowed'
                  : isTargetMuted
                  ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                  : 'hover:bg-slate-800/80 text-slate-200'
              }`}
            >
              <MicOff className={`w-4 h-4 mt-0.5 shrink-0 ${isTargetMuted ? 'text-rose-400' : 'text-slate-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold flex items-center justify-between">
                  <span>{isTargetMuted ? 'Desmutar para todos' : 'Mutar para todos'}</span>
                  {isTargetMuted && <Check className="w-3 h-3 text-rose-400" />}
                </div>
                <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
                  {isTargetMuted
                    ? 'Reativa o microfone deste usuário para toda a sala'
                    : 'Muta o microfone deste usuário para toda a sala'}
                </p>
              </div>
            </button>

            {/* 4. Silenciar para todos (Apenas ADMs) */}
            <button
              onClick={handleAdminDeafenForEveryone}
              disabled={!isLocalAdmin}
              className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all ${
                !isLocalAdmin
                  ? 'opacity-40 cursor-not-allowed'
                  : isTargetDeafened
                  ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                  : 'hover:bg-slate-800/80 text-slate-200'
              }`}
            >
              <Headphones className={`w-4 h-4 mt-0.5 shrink-0 ${isTargetDeafened ? 'text-amber-400' : 'text-slate-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold flex items-center justify-between">
                  <span>{isTargetDeafened ? 'Desilenciar para todos' : 'Silenciar para todos'}</span>
                  {isTargetDeafened && <Check className="w-3 h-3 text-amber-400" />}
                </div>
                <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
                  {isTargetDeafened
                    ? 'Reativa o som da chamada para este participante'
                    : 'Desativa o som da chamada para este participante'}
                </p>
              </div>
            </button>
          </div>
        </>
      )}

      {/* Local player self options */}
      {user.isLocal && (
        <div className="space-y-1">
          <button
            onClick={() => {
              useMediaStore.getState().toggleMute()
              onClose()
            }}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition-all text-xs font-semibold ${
              user.isMuted
                ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30'
                : 'hover:bg-slate-800/80 text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {user.isMuted ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4 text-slate-400" />}
              <span>{user.isMuted ? 'Desmutar Meu Microfone' : 'Mutar Meu Microfone'}</span>
            </div>
            {user.isMuted && <Check className="w-3 h-3 text-rose-400" />}
          </button>

          <button
            onClick={() => {
              useMediaStore.getState().toggleDeafen()
              onClose()
            }}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-left transition-all text-xs font-semibold ${
              isDeafened
                ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                : 'hover:bg-slate-800/80 text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Headphones className={`w-4 h-4 ${isDeafened ? 'text-amber-400' : 'text-slate-400'}`} />
              <span>{isDeafened ? 'Desilenciar Meu Som' : 'Silenciar Meu Som'}</span>
            </div>
            {isDeafened && <Check className="w-3 h-3 text-amber-400" />}
          </button>
        </div>
      )}
    </div>
  )
}
