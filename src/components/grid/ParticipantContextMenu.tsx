import React, { useEffect, useRef, useState } from 'react'
import {
  VolumeX,
  Volume2,
  Volume1,
  MicOff,
  Mic,
  Crown,
  Headphones,
  Check,
  Lock,
  UserCircle,
  Wifi,
  Server,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import { ParticipantData } from './GridParticipantTile'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { buildProfileTargetFromPlayer, useProfileModalStore } from '../../store/useProfileModalStore'
import { PeerManager } from '../../p2p/PeerManager'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { MediaManager } from '../../media/MediaManager'
import { participantVolumeControl } from '../../media/participantVolumeControl'
import {
  useUserNetworkQuality,
  type ConnectionRoute,
  type TransportPreference,
  type TurnProvider,
} from '../../store/useNetworkQualityStore'

function formatConnectionLabel(
  route: ConnectionRoute,
  turnProvider: TurnProvider | undefined,
  isSwitching: boolean,
  hasActiveCall: boolean,
  callState?: string
): string {
  if (isSwitching) return 'Trocando rota...'
  if (route === 'direct') return 'P2P Direta'
  if (route === 'turn') {
    if (turnProvider === 'cloudflare') return 'TURN (Cloudflare)'
    if (turnProvider === 'metered') return 'TURN (Metered)'
    return 'TURN (Relay)'
  }
  if (route === 'super-peer') return 'Relay (Host)'
  if (callState === 'connecting' || callState === 'reconnecting') return 'Conectando...'
  if (hasActiveCall) return 'Verificando...'
  return 'Sem chamada'
}

function formatSwitchError(reason?: string): string {
  switch (reason) {
    case 'no_turn_servers':
      return 'Servidor TURN indisponível no momento'
    case 'no_active_call':
      return 'Nenhuma chamada ativa com este participante'
    case 'busy':
      return 'Troca de conexão já em andamento'
    case 'peer_unsupported':
      return 'Este participante precisa atualizar o Lira'
    default:
      return 'Não foi possível trocar a conexão'
  }
}

interface Props {
  user: ParticipantData
  x: number
  y: number
  onClose: () => void
}

export const ParticipantContextMenu: React.FC<Props> = ({ user, x, y, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [isSubmittingSwitch, setIsSubmittingSwitch] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const localPlayer = useGameStore((s) => s.localPlayer)
  const mapData = useMapStore((s) => s.mapData)
  const currentZone = mapData.zones.find((z) => z.id === localPlayer.currentZoneId)

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
  const liveStreamVolume = useMediaStore((s) => s.liveStreamVolume)
  const setLiveStreamVolume = useMediaStore((s) => s.setLiveStreamVolume)
  const isLive = Boolean(user.screenStream || user.isScreenSharing)

  const djVolume = useSpotifyJamStore((s) => s.volume)
  const djMuted = useSpotifyJamStore((s) => s.isMuted)
  const isDjModeActive = useSpotifyJamStore((s) => s.isDjModeActive)
  const setDjVolume = useSpotifyJamStore((s) => s.setVolume)

  const remotePlayer = useGameStore((s) =>
    s.remotePlayers[user.id] ||
    Object.values(s.remotePlayers).find(
      (p) => p.id === user.id || p.gameId === user.id || (user.gameId && (p.id === user.gameId || p.gameId === user.gameId))
    )
  )
  const targetPeerId = remotePlayer?.id || user.id
  const callState = useGameStore((s) => s.callStates?.[targetPeerId]) || remotePlayer?.callState || user.callState || 'idle'
  const isDjBot = Boolean(user.isDjBot || remotePlayer?.isDjBot || user.id.startsWith('dj-'))
  const showConnectionControls = !user.isLocal && !isDjBot
  const networkQuality = useUserNetworkQuality(targetPeerId, user.isLocal)
  const peerManager = typeof PeerManager?.getInstance === 'function' ? PeerManager.getInstance() : null
  const hasActiveCall = Boolean(
    peerManager?.hasActiveMediaCall?.(targetPeerId) ||
    user.stream ||
    callState === 'connected' ||
    callState === 'connecting' ||
    callState === 'reconnecting'
  )
  const currentRoute: ConnectionRoute = networkQuality.route ?? 'unknown'
  const transportPreference: TransportPreference = networkQuality.transportPreference ?? 'auto'
  const isSwitching = isSubmittingSwitch || Boolean(networkQuality.isSwitchingTransport)
  const connectionLabel = formatConnectionLabel(
    currentRoute,
    networkQuality.turnProvider,
    isSwitching,
    hasActiveCall,
    callState
  )

  const isTargetMuted = remotePlayer ? Boolean(remotePlayer.isMuted) : Boolean(user.isMuted)
  const isTargetDeafened = remotePlayer ? Boolean(remotePlayer.isDeafened) : Boolean(user.isDeafened)
  const volumeControl = participantVolumeControl(user, remotePlayer, localPlayer.id,
    { volume: djVolume, isMuted: djMuted, isDjModeActive, setVolume: setDjVolume },
    { participantVolumes, setParticipantVolume },
    (value) => MediaManager.getInstance().setDjVolume(value))
  const volumeControls = [
    { label: user.isDjBot || remotePlayer?.isDjBot ? 'Volume do player' : 'Volume da voz', ...volumeControl },
    ...(isLive ? [{ label: 'Volume da live', volume: liveStreamVolume ?? 100, setVolume: setLiveStreamVolume }] : []),
  ]

  useEffect(() => {
    if (showConnectionControls && hasActiveCall) {
      peerManager?.refreshPeerConnectionStats?.()
    }
  }, [showConnectionControls, hasActiveCall, targetPeerId])

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

  const menuWidth = 260
  const menuHeight = user.isLocal ? 150 : (isLive ? 530 : 450) + (showConnectionControls ? 130 : 0)
  const clampedX = Math.min(Math.max(10, x), window.innerWidth - menuWidth - 10)
  const clampedY = Math.max(10, Math.min(y, window.innerHeight - menuHeight - 10))

  const handleSwitchTransport = async (e: React.MouseEvent, target: TransportPreference) => {
    e.stopPropagation()
    if (!peerManager || typeof peerManager.switchPeerConnectionTransport !== 'function' || isSwitching) return
    setSwitchError(null)
    setIsSubmittingSwitch(true)
    try {
      const result = await peerManager.switchPeerConnectionTransport(targetPeerId, target)
      if (!result.ok) {
        setSwitchError(formatSwitchError(result.reason))
      }
    } catch {
      setSwitchError('Não foi possível trocar a conexão')
    } finally {
      setIsSubmittingSwitch(false)
    }
  }

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

  return (
    <div
      ref={menuRef}
      style={{ left: clampedX, top: clampedY, maxHeight: 'calc(100vh - 20px)' }}
      className="fixed z-[100] w-64 overflow-y-auto bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-2 select-none text-lira-ink font-mono"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1.5 border-b border-dashed border-lira-rule/60">
        <div
          className="w-7 h-7 rounded-[6px] flex items-center justify-center text-xs font-bold text-lira-ground border border-lira-quiet shrink-0"
          style={{ backgroundColor: user.shirtColor || '#d1b5ff' }}
        >
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-bold text-lira-accent truncate flex items-center gap-1.5">
            <span>{user.isLocal ? `${user.name} (Você)` : user.name}</span>
            {isLive && (
              <span className="text-[8px] font-mono bg-lira-error/20 text-lira-error border border-lira-error/40 px-1 py-0.2 rounded-[4px] font-bold">
                LIVE
              </span>
            )}
          </div>
          <div className="text-[10px] text-lira-muted truncate">
            {user.isLocal ? 'Controles do seu perfil' : 'Opções de áudio e moderação'}
          </div>
        </div>
      </div>

      {!user.isLocal && volumeControls.map((control) => {
        const currentVol = control.volume
        return (
          <div
            key={control.label}
            className="px-2.5 py-2 mb-1.5 bg-lira-surface rounded-[8px] border border-lira-quiet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between text-xs font-semibold text-lira-ink mb-1.5">
              <span className="flex items-center gap-1.5">
                {currentVol === 0 ? (
                  <VolumeX className="w-3.5 h-3.5 text-lira-error" />
                ) : currentVol < 50 ? (
                  <Volume1 className="w-3.5 h-3.5 text-lira-muted" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-lira-accent" />
                )}
                <span>{control.label}</span>
              </span>
              <span
                className={`text-[11px] font-mono tabular-nums font-bold ${
                  currentVol === 0
                    ? 'text-lira-error'
                    : currentVol > 100
                    ? 'text-lira-amber'
                    : 'text-lira-accent'
                }`}
              >
                {currentVol}%
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="range"
                aria-label={control.label}
                min="0"
                max="200"
                step="1"
                value={currentVol}
                onChange={(e) => {
                  const val = Number(e.target.value)
                  control.setVolume(val)
                }}
                className="w-full h-1.5 bg-lira-ground rounded-[4px] appearance-none cursor-pointer accent-lira-accent"
              />
            </div>

            <div className="flex items-center justify-between mt-1.5 text-[9px] font-mono tabular-nums text-lira-muted">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  control.setVolume(0)
                }}
                className={`px-1.5 py-0.5 rounded-[4px] transition-colors ${
                  currentVol === 0 ? 'text-lira-error font-bold bg-lira-error/15' : 'hover:text-lira-ink hover:bg-lira-ground'
                }`}
              >
                0%
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  control.setVolume(100)
                }}
                className={`px-1.5 py-0.5 rounded-[4px] transition-colors ${
                  currentVol === 100 ? 'text-lira-accent font-bold bg-lira-accent/15' : 'hover:text-lira-ink hover:bg-lira-ground'
                }`}
              >
                100% (Padrão)
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  control.setVolume(200)
                }}
                className={`px-1.5 py-0.5 rounded-[4px] transition-colors ${
                  currentVol === 200 ? 'text-lira-amber font-bold bg-lira-amber/15' : 'hover:text-lira-amber hover:bg-lira-ground'
                }`}
              >
                200%
              </button>
            </div>
          </div>
        )
      })}

      {!user.isLocal && (
        <div className="space-y-1">
          {!user.isDjBot && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                if (remotePlayer) {
                  useProfileModalStore.getState().openProfile(buildProfileTargetFromPlayer(remotePlayer, false), 'view')
                } else {
                  useProfileModalStore.getState().openProfile(
                    {
                      userId: user.gameId || user.id,
                      peerId: user.id,
                      name: user.name,
                      profilePicture: user.profilePicture,
                      avatar: user.avatar,
                      profile: user.profile,
                    },
                    'view'
                  )
                }
                onClose()
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-xs font-semibold hover:bg-indigo-600/20 text-slate-100 transition-colors"
            >
              <UserCircle className="w-4 h-4 text-sky-400 shrink-0" />
              <span>Ver Perfil Completo</span>
            </button>
          )}
          <button
            onClick={handleToggleSilenceForMe}
            className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[8px] text-left transition-colors ${
              isSilencedForMe
                ? 'bg-lira-amber/15 text-lira-amber border border-lira-amber/40'
                : 'hover:bg-lira-surface text-lira-ink border border-transparent'
            }`}
          >
            <VolumeX className={`w-4 h-4 mt-0.5 shrink-0 ${isSilencedForMe ? 'text-lira-amber' : 'text-lira-muted'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold flex items-center justify-between">
                <span>{isSilencedForMe ? 'Desfazer silêncio' : 'Silenciar para mim'}</span>
                {isSilencedForMe && <Check className="w-3 h-3 text-lira-amber" />}
              </div>
              <p className="text-[10px] text-lira-muted leading-tight mt-0.5">
                Muta nos 2 sentidos (ele não te escuta, você não o escuta)
              </p>
            </div>
          </button>

          <button
            onClick={handleToggleMuteForMe}
            className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[8px] text-left transition-colors ${
              isMutedForMe
                ? 'bg-lira-error/15 text-lira-error border border-lira-error/40'
                : 'hover:bg-lira-surface text-lira-ink border border-transparent'
            }`}
          >
            <MicOff className={`w-4 h-4 mt-0.5 shrink-0 ${isMutedForMe ? 'text-lira-error' : 'text-lira-muted'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold flex items-center justify-between">
                <span>{isMutedForMe ? 'Desmutar para mim' : 'Mutar para mim'}</span>
                {isMutedForMe && <Check className="w-3 h-3 text-lira-error" />}
              </div>
              <p className="text-[10px] text-lira-muted leading-tight mt-0.5">
                Muta o microfone dele para você (ele ainda pode te escutar)
              </p>
            </div>
          </button>
        </div>
      )}

      {showConnectionControls && (
        <>
          <div className="my-1.5 border-t border-dashed border-lira-rule/60" />
          <div
            className="px-2.5 py-2 bg-lira-surface rounded-[8px] border border-lira-quiet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold tracking-wider uppercase text-lira-muted flex items-center gap-1">
                {currentRoute === 'turn' ? (
                  <Server className="w-3 h-3 text-cyan-400" />
                ) : (
                  <Wifi className="w-3 h-3 text-emerald-400" />
                )}
                Conexão
              </span>
              <span
                data-testid="connection-current-route"
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] border text-[10px] font-semibold ${
                  isSwitching
                    ? 'bg-lira-amber/15 text-lira-amber border-lira-amber/40'
                    : currentRoute === 'direct'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                    : currentRoute === 'turn'
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/35'
                    : currentRoute === 'super-peer'
                    ? 'bg-lira-amber/15 text-lira-amber border-lira-amber/40'
                    : 'bg-lira-panel text-lira-muted border-lira-quiet'
                }`}
              >
                {isSwitching ? (
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                ) : (
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      currentRoute === 'direct'
                        ? 'bg-emerald-400'
                        : currentRoute === 'turn'
                        ? 'bg-cyan-400'
                        : currentRoute === 'super-peer'
                        ? 'bg-lira-amber'
                        : 'bg-lira-muted'
                    }`}
                  />
                )}
                <span>{connectionLabel}</span>
              </span>
            </div>

            <div className="text-[10px] text-lira-muted mt-1 flex items-center justify-between gap-1">
              <span className="truncate font-mono tabular-nums">
                {hasActiveCall
                  ? [
                      networkQuality.pingMs > 0 ? `${networkQuality.pingMs}ms` : null,
                      currentRoute !== 'unknown' || networkQuality.pingMs > 0
                        ? `${networkQuality.lossPct}% perda`
                        : null,
                      networkQuality.protocol ? networkQuality.protocol.toUpperCase() : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Aguardando métricas'
                  : 'Fora da chamada'}
              </span>
              <span className="shrink-0 text-[9px] font-semibold text-lira-muted">
                {transportPreference === 'auto' ? 'Automático' : 'Manual'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 mt-2">
              <button
                type="button"
                data-testid="connection-switch-direct"
                disabled={
                  !hasActiveCall ||
                  isSwitching ||
                  (currentRoute === 'direct' && transportPreference === 'direct')
                }
                onClick={(e) => {
                  void handleSwitchTransport(e, 'direct')
                }}
                className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-[6px] border text-[11px] font-semibold transition-colors ${
                  currentRoute === 'direct'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-lira-panel text-lira-ink border-lira-quiet hover:bg-lira-ground hover:text-lira-accent'
                } disabled:opacity-45 disabled:cursor-not-allowed`}
              >
                <Wifi className="w-3 h-3 shrink-0" />
                <span>P2P Direta</span>
              </button>

              <button
                type="button"
                data-testid="connection-switch-turn"
                disabled={
                  !hasActiveCall ||
                  isSwitching ||
                  (currentRoute === 'turn' && transportPreference === 'turn')
                }
                onClick={(e) => {
                  void handleSwitchTransport(e, 'turn')
                }}
                className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-[6px] border text-[11px] font-semibold transition-colors ${
                  currentRoute === 'turn'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : 'bg-lira-panel text-lira-ink border-lira-quiet hover:bg-lira-ground hover:text-lira-accent'
                } disabled:opacity-45 disabled:cursor-not-allowed`}
              >
                <Server className="w-3 h-3 shrink-0" />
                <span>TURN</span>
              </button>
            </div>

            {transportPreference !== 'auto' && (
              <button
                type="button"
                data-testid="connection-switch-auto"
                disabled={!hasActiveCall || isSwitching}
                onClick={(e) => {
                  void handleSwitchTransport(e, 'auto')
                }}
                className="w-full mt-1.5 flex items-center justify-center gap-1 px-2 py-1 rounded-[6px] text-[10px] font-semibold text-lira-muted hover:text-lira-ink hover:bg-lira-panel transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Voltar para automático</span>
              </button>
            )}

            {switchError && (
              <p
                data-testid="connection-switch-error"
                className="text-[10px] text-lira-error mt-1.5 leading-tight"
              >
                {switchError}
              </p>
            )}
          </div>
        </>
      )}

      {!user.isLocal && (
        <>
          <div className="my-1.5 border-t border-dashed border-lira-rule/60" />
          <div className="px-2 py-1 flex items-center justify-between text-[9px] font-bold tracking-wider uppercase text-lira-amber">
            <span className="flex items-center gap-1">
              <Crown className="w-3 h-3" />
              Opções de Administrador
            </span>
            {!isLocalAdmin && (
              <span className="text-lira-muted flex items-center gap-0.5">
                <Lock className="w-2.5 h-2.5" />
                Apenas ADMs
              </span>
            )}
          </div>

          <div className="space-y-1">
            <button
              onClick={handleAdminMuteForEveryone}
              disabled={!isLocalAdmin}
              className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[8px] text-left transition-colors ${
                !isLocalAdmin
                  ? 'opacity-40 cursor-not-allowed border border-transparent'
                  : isTargetMuted
                  ? 'bg-lira-error/15 text-lira-error border border-lira-error/40'
                  : 'hover:bg-lira-surface text-lira-ink border border-transparent'
              }`}
            >
              <MicOff className={`w-4 h-4 mt-0.5 shrink-0 ${isTargetMuted ? 'text-lira-error' : 'text-lira-muted'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold flex items-center justify-between">
                  <span>{isTargetMuted ? 'Desmutar para todos' : 'Mutar para todos'}</span>
                  {isTargetMuted && <Check className="w-3 h-3 text-lira-error" />}
                </div>
                <p className="text-[10px] text-lira-muted leading-tight mt-0.5">
                  {isTargetMuted
                    ? 'Reativa o microfone deste usuário para toda a sala'
                    : 'Muta o microfone deste usuário para toda a sala'}
                </p>
              </div>
            </button>

            <button
              onClick={handleAdminDeafenForEveryone}
              disabled={!isLocalAdmin}
              className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[8px] text-left transition-colors ${
                !isLocalAdmin
                  ? 'opacity-40 cursor-not-allowed border border-transparent'
                  : isTargetDeafened
                  ? 'bg-lira-amber/15 text-lira-amber border border-lira-amber/40'
                  : 'hover:bg-lira-surface text-lira-ink border border-transparent'
              }`}
            >
              <Headphones className={`w-4 h-4 mt-0.5 shrink-0 ${isTargetDeafened ? 'text-lira-amber' : 'text-lira-muted'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold flex items-center justify-between">
                  <span>{isTargetDeafened ? 'Desilenciar para todos' : 'Silenciar para todos'}</span>
                  {isTargetDeafened && <Check className="w-3 h-3 text-lira-amber" />}
                </div>
                <p className="text-[10px] text-lira-muted leading-tight mt-0.5">
                  {isTargetDeafened
                    ? 'Reativa o som da chamada para este participante'
                    : 'Desativa o som da chamada para este participante'}
                </p>
              </div>
            </button>
          </div>
        </>
      )}

      {user.isLocal && (
        <div className="space-y-1">
          <button
            onClick={() => {
              useMediaStore.getState().toggleMute()
              onClose()
            }}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-[8px] text-left transition-colors text-xs font-semibold ${
              user.isMuted
                ? 'bg-lira-error/15 text-lira-error border border-lira-error/40'
                : 'hover:bg-lira-surface text-lira-ink border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {user.isMuted ? <MicOff className="w-4 h-4 text-lira-error" /> : <Mic className="w-4 h-4 text-lira-muted" />}
              <span>{user.isMuted ? 'Desmutar Meu Microfone' : 'Mutar Meu Microfone'}</span>
            </div>
            {user.isMuted && <Check className="w-3 h-3 text-lira-error" />}
          </button>

          <button
            onClick={() => {
              useMediaStore.getState().toggleDeafen()
              onClose()
            }}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-[8px] text-left transition-colors text-xs font-semibold ${
              isDeafened
                ? 'bg-lira-amber/15 text-lira-amber border border-lira-amber/40'
                : 'hover:bg-lira-surface text-lira-ink border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Headphones className={`w-4 h-4 ${isDeafened ? 'text-lira-amber' : 'text-lira-muted'}`} />
              <span>{isDeafened ? 'Desilenciar Meu Som' : 'Silenciar Meu Som'}</span>
            </div>
            {isDeafened && <Check className="w-3 h-3 text-lira-amber" />}
          </button>
        </div>
      )}
    </div>
  )
}
