import React, { useState, useMemo, useRef } from 'react'
import {
  X,
  Users,
  Search,
  Copy,
  Check,
  Crown,
  Shield,
  UserCheck,
  UserX,
  Star,
  MapPin,
  MessageSquare,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Tv,
  MoreVertical,
  UserPlus,
  Share2,
  Lock,
  Compass,
  Zap,
  Activity,
  Clock,
} from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useChatStore } from '../store/useChatStore'
import { useMediaStore } from '../store/useMediaStore'
import { useNetworkQualityStore, DEFAULT_NETWORK_QUALITY } from '../store/useNetworkQualityStore'
import { NetworkSignalIcon } from './NetworkSignalIcon'
import { ConfirmModal } from './ConfirmModal'
import { Player, UserRole } from '../types/game'
import { goToPlayer } from '../utils/goToPlayer'
import { PlayerAvatar } from './common/PlayerAvatar'
import { SpotifyIcon } from './common/SpotifyIcon'
import { getPlayerUserId, findFriendKey } from '../utils/userId'
import { PeerManager } from '../p2p/PeerManager'

export const OnlineUsersMenu: React.FC = () => {
  const isOnlineUsersOpen = useGameStore((s) => s.isOnlineUsersOpen)
  if (!isOnlineUsersOpen) return null
  return <OnlineUsersMenuInner />
}

const OnlineUsersMenuInner: React.FC = () => {
  const {
    isOnlineUsersOpen,
    setOnlineUsersOpen,
    localPlayer,
    remotePlayers,
    roomId,
    roomName,
    isOwner,
    isHost,
    connectionHostId,
    friends,
    friendProfiles,
    removeFriend,
    updatePlayerRole,
    kickPlayer,
  } = useGameStore()

  const { mapData } = useMapStore()
  const {
    toggleChat,
    openDirectMessage,
    getUnreadCountForFriend,
    sendFriendRequest,
    getFriendRequestStatus,
  } = useChatStore()
  const peerStreams = useMediaStore((s) => s.peerStreams)
  const callStates = useGameStore((s) => s.callStates)
  const networkQualities = useNetworkQualityStore((s) => s.peerQualities)
  const localQuality = useNetworkQualityStore((s) => s.localQuality)

  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<'all' | 'friends' | 'roles'>('all')
  const [selectedUserMenuId, setSelectedUserMenuId] = useState<string | null>(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const [kickConfirmPlayer, setKickConfirmPlayer] = useState<{ id: string; name: string } | null>(null)
  const [transferTargetId, setTransferTargetId] = useState<string | null>(null)
  const [transferError, setTransferError] = useState<string | null>(null)
  const transferInProgress = useRef(false)

  const remoteList = Object.values(remotePlayers).filter(p => !p.isDjBot && !p.id.startsWith('dj-'))
  const allPlayers: { player: Player; isLocal: boolean }[] = [
    { player: localPlayer, isLocal: true },
    ...remoteList.map((p) => ({ player: p, isLocal: false })),
  ]

  const friendsInRoomCount = useMemo(() => {
    return remoteList.filter((p) => !!findFriendKey(friends, friendProfiles, [p.id, p.gameId])).length
  }, [remoteList, friends, friendProfiles])

  const filteredPlayers = allPlayers.filter(({ player, isLocal }) => {
    const q = searchQuery.toLowerCase().trim()
    const matchesQuery =
      !q ||
      player.name.toLowerCase().includes(q) ||
      (player.statusText && player.statusText.toLowerCase().includes(q))
    if (!matchesQuery) return false

    if (filterTab === 'friends') {
      if (isLocal) return false
      return !!findFriendKey(friends, friendProfiles, [player.id, player.gameId])
    }
    return true
  })

  const handleCopyInvite = () => {
    if (!roomId) return
    navigator.clipboard.writeText(roomId)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2200)
  }

  const getZoneName = (zoneId?: string | null) => {
    if (!zoneId) return 'Corredor Geral'
    const z = mapData.zones.find((item) => item.id === zoneId)
    return z ? z.name : 'Zona Privada'
  }

  const getRoleBadge = (role?: UserRole, isOwnerPlayer?: boolean, isHostPlayer?: boolean) => {
    if (isOwnerPlayer) {
      return {
        label: 'Dono',
        icon: <Crown className="w-3 h-3 text-lira-amber" />,
        bg: 'bg-lira-amber/15 text-lira-amber border-lira-amber/40',
      }
    }
    if (isHostPlayer) {
      return {
        label: 'Host de Conexão',
        icon: <Zap className="w-3 h-3 text-lira-accent" />,
        bg: 'bg-lira-accent/15 text-lira-accent border-lira-accent/40',
      }
    }
    if (role === 'admin') {
      return {
        label: 'Admin',
        icon: <Shield className="w-3 h-3 text-lira-accent" />,
        bg: 'bg-lira-surface text-lira-accent border-lira-rule',
      }
    }
    if (role === 'guest') {
      return {
        label: 'Visitante',
        icon: <UserX className="w-3 h-3 text-lira-muted" />,
        bg: 'bg-lira-ground text-lira-muted border-lira-quiet',
      }
    }
    return {
      label: 'Membro',
      icon: <UserCheck className="w-3 h-3 text-lira-online" />,
      bg: 'bg-lira-online/15 text-lira-online border-lira-online/40',
    }
  }

  return (
    <div className="fixed top-3 sm:top-4 left-[calc(var(--rail-width)+8px)] right-2 sm:left-auto sm:right-4 w-auto sm:w-96 bg-lira-panel border border-dashed border-lira-rule rounded-[12px] z-[75] overflow-hidden flex flex-col max-h-[calc(100dvh-24px)] sm:max-h-[calc(100dvh-32px)] select-none font-mono text-lira-ink">
      <div className="p-4 border-b border-dashed border-lira-rule/60 bg-lira-ground flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[8px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h2 className="font-display text-base font-bold text-lira-accent flex items-center gap-2">
              Pessoas no Espaço
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-[6px] bg-lira-online/15 text-lira-online border border-lira-online/40 font-bold">
                {allPlayers.length} online
              </span>
            </h2>
            <p className="text-[11px] font-mono text-lira-muted truncate max-w-[200px]">
              {roomName || 'Espaço de Trabalho Virtual'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setOnlineUsersOpen(false)}
          className="p-1.5 rounded-[8px] bg-lira-surface border border-lira-quiet hover:border-lira-accent text-lira-muted hover:text-lira-ink transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 bg-lira-surface border-b border-dashed border-lira-rule/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Share2 className="w-4 h-4 text-lira-accent shrink-0" />
          <div className="text-xs text-lira-ink truncate">
            <span className="font-bold">Convidar amigos:</span> Código{' '}
            <span className="font-mono font-bold text-lira-accent bg-lira-ground px-1.5 py-0.5 rounded-[4px] border border-lira-quiet">
              {roomId || 'Principal'}
            </span>
          </div>
        </div>

        <button
          onClick={handleCopyInvite}
          className="px-3 py-1 bg-lira-accent hover:bg-lira-ink text-lira-ground border border-lira-accent rounded-[8px] text-xs font-bold transition-colors flex items-center gap-1.5 shrink-0"
        >
          {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copiedLink ? 'Copiado!' : 'Copiar'}</span>
        </button>
      </div>

      <div className="p-3 space-y-2.5 border-b border-dashed border-lira-rule/60 bg-lira-panel">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-lira-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome ou status..."
            className="w-full bg-lira-ground border border-lira-rule rounded-[8px] pl-9 pr-3 py-1.5 text-xs font-mono text-lira-ink placeholder:text-lira-muted/70 focus:outline-none focus:border-lira-accent"
          />
        </div>

        <div className="flex gap-1.5 bg-lira-ground p-1 rounded-[8px] border border-lira-quiet">
          <button
            onClick={() => setFilterTab('all')}
            className={`flex-1 py-1 rounded-[6px] text-xs font-bold transition-colors ${
              filterTab === 'all'
                ? 'bg-lira-accent text-lira-ground'
                : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface'
            }`}
          >
            Todos ({allPlayers.length})
          </button>
          <button
            onClick={() => setFilterTab('friends')}
            className={`flex-1 py-1 rounded-[6px] text-xs font-bold transition-colors flex items-center justify-center gap-1 ${
              filterTab === 'friends'
                ? 'bg-lira-accent text-lira-ground'
                : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface'
            }`}
          >
            <Star className={`w-3 h-3 ${filterTab === 'friends' ? 'text-lira-ground fill-lira-ground' : 'text-lira-amber fill-lira-amber'}`} />
            <span>Amigos ({friendsInRoomCount})</span>
          </button>
        </div>
      </div>

      {transferError && <div role="alert" className="mx-3 mt-3 p-2.5 rounded-[8px] border border-lira-error/40 bg-lira-error/15 text-xs text-lira-error">{transferError}</div>}

      <div className="p-3 overflow-y-auto flex-1 space-y-2">
        {filteredPlayers.length === 0 ? (
          <div className="text-center py-8 text-xs text-lira-muted space-y-1 border border-dashed border-lira-rule/50 rounded-[8px] bg-lira-ground">
            <Users className="w-6 h-6 mx-auto text-lira-muted" />
            <div>
              {searchQuery
                ? 'Nenhum participante encontrado'
                : filterTab === 'friends'
                ? 'Nenhum amigo nesta sala no momento'
                : 'Nenhum participante encontrado'}
            </div>
          </div>
        ) : (
          filteredPlayers.map(({ player, isLocal }) => {
            const isPlayerOwner = isLocal ? isOwner : (player.isOwner || player.role === 'owner')
            const isPlayerConnectionHost = connectionHostId ? player.id === connectionHostId : (isLocal ? isHost : (player.isHost ?? false))
            const roleBadge = getRoleBadge(player.role, isPlayerOwner, isPlayerConnectionHost && !isPlayerOwner)
            const playerUserId = getPlayerUserId(player)
            const friendKey = isLocal
              ? undefined
              : findFriendKey(friends, friendProfiles, [player.id, player.gameId])
            const isFriend = !!friendKey
            const isMenuOpen = selectedUserMenuId === player.id
            const pingMs = player.ping ?? (isLocal ? 12 : 38)

            return (
              <div
                key={player.id}
                className="p-3 rounded-[10px] bg-lira-ground hover:bg-lira-surface/60 border border-lira-quiet hover:border-lira-rule transition-colors space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PlayerAvatar
                      player={player}
                      showStatus={true}
                      size="md"
                    />

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-display font-bold text-lira-ink truncate">
                          {player.name}
                        </span>
                        {isLocal && (
                          <span className="text-[9px] font-mono bg-lira-surface text-lira-muted px-1.5 py-0.2 rounded-[4px] border border-lira-quiet font-semibold">
                            Você
                          </span>
                        )}
                        {(player.isDjBot || player.id.startsWith('dj-')) && (
                          <span className="text-[9px] bg-[#1db954] text-black px-1.5 py-0.2 rounded-[4px] font-extrabold flex items-center gap-1">
                            <SpotifyIcon size={10} className="text-black" />
                            <span>DJ</span>
                          </span>
                        )}
                        <span
                          className={`text-[9px] font-mono px-1.5 py-0.2 rounded-[4px] font-bold border flex items-center gap-1 ${roleBadge.bg}`}
                        >
                          {roleBadge.icon}
                          <span>{roleBadge.label}</span>
                        </span>
                        {isPlayerOwner && isPlayerConnectionHost && (
                          <span className="text-[8px] font-mono bg-lira-accent/15 text-lira-accent border border-lira-accent/30 px-1 py-0.2 rounded-[4px] font-semibold flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5" />
                            Host
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-lira-muted mt-0.5">
                        <span className="flex items-center gap-0.5 text-lira-accent">
                          <MapPin className="w-2.5 h-2.5" />
                          <span>{getZoneName(player.currentZoneId)}</span>
                        </span>
                        {(() => {
                          const q = (isLocal ? localQuality : networkQualities[player.id]) || DEFAULT_NETWORK_QUALITY
                          return (
                            <NetworkSignalIcon
                              rating={q.rating}
                              pingMs={q.pingMs}
                              lossPct={q.lossPct}
                              showPingText={true}
                              size="sm"
                            />
                          )
                        })()}
                        {player.statusText && (
                          <>
                            <span>•</span>
                            <span className="truncate max-w-[90px]">
                              {player.statusText}
                            </span>
                          </>
                        )}
                        {player.spotifyActivity?.isPlaying && (
                          <div
                            onClick={(e) => {
                              e.stopPropagation()
                              const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
                              const query = `${player.spotifyActivity!.artist} ${player.spotifyActivity!.track}`.trim()
                              const deepLink = `spotify:search:${encodeURIComponent(query)}`
                              if (electronAPI?.openExternal) {
                                electronAPI.openExternal(deepLink)
                              } else {
                                window.open(`https://open.spotify.com/search/${encodeURIComponent(query)}`, '_blank')
                              }
                            }}
                            className="flex items-center gap-1 text-[10px] text-lira-online hover:text-lira-ink font-medium cursor-pointer truncate max-w-[130px] transition-colors bg-lira-online/10 px-1.5 py-0.2 rounded-[4px] border border-lira-online/30"
                            title={`Ouvindo no Spotify: ${player.spotifyActivity.track}${player.spotifyActivity.artist ? ` - ${player.spotifyActivity.artist}` : ''} (Clique para ouvir)`}
                          >
                            <SpotifyIcon size={10} className="w-2.5 h-2.5 shrink-0 text-lira-online" />
                            <span className="truncate">
                              {player.spotifyActivity.track}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {!isLocal && callStates[player.id] === 'connecting' && (
                      <span
                        className="text-[8px] bg-lira-amber/15 text-lira-amber border border-lira-amber/40 px-1.5 py-0.5 rounded-[4px] font-bold flex items-center gap-1"
                        title="Estabelecendo conexão de áudio/vídeo…"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-lira-amber" />
                        Conectando
                      </span>
                    )}
                    {!isLocal && callStates[player.id] === 'failed' && (
                      <span
                        className="text-[8px] bg-lira-error/15 text-lira-error border border-lira-error/40 px-1.5 py-0.5 rounded-[4px] font-bold flex items-center gap-1"
                        title="Falha na conexão de chamada"
                      >
                        Sem áudio
                      </span>
                    )}
                    <div className="flex items-center gap-0.5 text-lira-muted bg-lira-panel p-1 rounded-[6px] border border-lira-quiet">
                      {player.isMuted ? (
                        <MicOff className="w-3 h-3 text-lira-error" />
                      ) : (
                        <Mic className="w-3 h-3 text-lira-online" />
                      )}
                      {player.isCameraOff ? (
                        <VideoOff className="w-3 h-3 text-lira-muted" />
                      ) : (
                        <Video className="w-3 h-3 text-lira-online" />
                      )}
                      {player.isScreenSharing && (
                        <Tv className="w-3 h-3 text-lira-accent" />
                      )}
                    </div>

                    {!isLocal && (() => {
                      const friendUnread = getUnreadCountForFriend({ id: player.id, name: player.name, actualUserId: playerUserId })
                      return (
                        <button
                          onClick={() => openDirectMessage({ id: playerUserId, name: player.name })}
                          className={`p-1.5 rounded-[6px] border transition-colors relative ${
                            friendUnread > 0
                              ? 'bg-lira-error text-lira-ground border-lira-error'
                              : 'bg-lira-surface text-lira-muted hover:text-lira-accent border-lira-quiet hover:border-lira-accent'
                          }`}
                          title={
                            friendUnread > 0
                              ? `${friendUnread} nova(s) mensagem(ns) de ${player.name}`
                              : `Conversar com ${player.name}`
                          }
                        >
                          <MessageSquare className={`w-3 h-3 ${friendUnread > 0 ? 'text-lira-ground' : 'text-lira-accent'}`} />
                          {friendUnread > 0 && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-lira-error ring-2 ring-lira-ground" />
                          )}
                        </button>
                      )
                    })()}

                    {!isLocal && (() => {
                      const req =
                        getFriendRequestStatus(playerUserId) ||
                        getFriendRequestStatus(player.id) ||
                        getFriendRequestStatus(player.name)
                      const isPending = req?.status === 'pending'

                      return (
                        <button
                          onClick={() => {
                            if (friendKey) {
                              removeFriend(friendKey)
                            } else {
                              if (isPending) return
                              sendFriendRequest({ id: playerUserId, name: player.name, avatar: player.avatar })
                              openDirectMessage({ id: playerUserId, name: player.name })
                            }
                          }}
                          className={`p-1.5 rounded-[6px] border transition-colors ${
                            isFriend
                              ? 'bg-lira-amber/15 text-lira-amber border-lira-amber/40'
                              : isPending
                              ? 'bg-lira-surface text-lira-accent border-lira-rule'
                              : 'bg-lira-surface text-lira-muted hover:text-lira-ink border-lira-quiet hover:border-lira-rule'
                          }`}
                          title={
                            isFriend
                              ? 'Remover dos amigos'
                              : isPending
                              ? 'Solicitação de amizade pendente no chat'
                              : 'Enviar solicitação de amizade'
                          }
                        >
                          {isPending && !isFriend ? (
                            <Clock className="w-3 h-3 text-lira-accent" />
                          ) : (
                            <Star className={`w-3 h-3 ${isFriend ? 'fill-lira-amber text-lira-amber' : ''}`} />
                          )}
                        </button>
                      )
                    })()}

                    {!isLocal && (
                      <button
                        onClick={() =>
                          setSelectedUserMenuId(isMenuOpen ? null : player.id)
                        }
                        className={`p-1.5 rounded-[6px] border transition-colors ${
                          isMenuOpen
                            ? 'bg-lira-accent text-lira-ground border-lira-accent'
                            : 'bg-lira-surface text-lira-muted hover:text-lira-ink border-lira-quiet hover:border-lira-rule'
                        }`}
                        title="Ações e Permissões do Usuário"
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {isMenuOpen && !isLocal && (
                  <div className="p-3 bg-lira-surface rounded-[8px] border border-dashed border-lira-rule space-y-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-lira-muted">
                      Ações & Interação
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => {
                          goToPlayer(player.id)
                          setSelectedUserMenuId(null)
                        }}
                        className="py-1.5 px-2 rounded-[6px] bg-lira-ground hover:border-lira-accent text-lira-accent font-bold text-xs flex items-center gap-1.5 border border-lira-rule transition-colors"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>Ir até {player.name.split(' ')[0]}</span>
                      </button>

                      <button
                        onClick={() => {
                          openDirectMessage({ id: playerUserId, name: player.name })
                          setSelectedUserMenuId(null)
                        }}
                        className="py-1.5 px-2 rounded-[6px] bg-lira-ground hover:border-lira-rule text-lira-ink font-bold text-xs flex items-center gap-1.5 border border-lira-quiet transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-lira-accent" />
                        <span>Mensagem</span>
                      </button>

                      {(() => {
                        const req =
                          getFriendRequestStatus(playerUserId) ||
                          getFriendRequestStatus(player.id) ||
                          getFriendRequestStatus(player.name)
                        const isPending = req?.status === 'pending'
                        if (isFriend || isPending) return null

                        return (
                          <button
                            onClick={() => {
                              sendFriendRequest({ id: playerUserId, name: player.name, avatar: player.avatar })
                              openDirectMessage({ id: playerUserId, name: player.name })
                              setSelectedUserMenuId(null)
                            }}
                            className="py-1.5 px-2 rounded-[6px] bg-lira-online/15 hover:bg-lira-online/25 text-lira-online font-bold text-xs flex items-center gap-1.5 border border-lira-online/40 transition-colors col-span-2"
                          >
                            <UserPlus className="w-3.5 h-3.5 text-lira-online" />
                            <span>Adicionar aos Amigos</span>
                          </button>
                        )
                      })()}
                    </div>

                    {(isOwner || isHost) && (
                      <div className="pt-2 border-t border-dashed border-lira-rule/60 space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-lira-muted">
                          {isOwner ? 'Gerenciar Participante (Dono da Sala)' : 'Host de Conexão'}
                        </div>

                        <button
                          disabled={isPlayerConnectionHost || transferTargetId !== null}
                          onClick={async () => {
                            if (transferInProgress.current || isPlayerConnectionHost) return
                            transferInProgress.current = true
                            setTransferTargetId(player.id)
                            setTransferError(null)
                            try {
                              await PeerManager.getInstance().transferConnectionHost(player.id)
                              setSelectedUserMenuId(null)
                            } catch (error) {
                              setTransferError(error instanceof Error ? error.message : 'Não foi possível transferir o host.')
                            } finally {
                              transferInProgress.current = false
                              setTransferTargetId(null)
                            }
                          }}
                          className={`w-full py-1.5 px-2.5 rounded-[6px] text-xs font-bold border flex items-center justify-between transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                            isPlayerConnectionHost
                              ? 'bg-lira-accent/15 text-lira-accent border-lira-accent/40'
                              : 'bg-lira-ground hover:border-lira-accent text-lira-ink border-lira-quiet'
                          }`}
                          title="Transfere a conexão da sala para este participante após a confirmação dele"
                        >
                          <div className="flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-lira-accent" />
                            <span>{transferTargetId === player.id ? 'Transferindo…' : isPlayerConnectionHost ? 'Host de Conexão Ativo' : 'Tornar Host de Conexão'}</span>
                          </div>
                          <span className="text-[10px] font-mono text-lira-online">{pingMs}ms</span>
                        </button>

                        {isOwner && <>
                        <div className="flex items-center justify-between gap-1 text-xs">
                          <span className="text-lira-muted">Cargo:</span>
                          <div className="flex gap-1">
                            {(['admin', 'member', 'guest'] as UserRole[]).map((r) => (
                              <button
                                key={r}
                                onClick={() => updatePlayerRole(player.id, r)}
                                className={`px-2 py-0.5 rounded-[4px] text-[10px] font-bold border transition-colors ${
                                  player.role === r || (!player.role && r === 'member')
                                    ? 'bg-lira-accent text-lira-ground border-lira-accent'
                                    : 'bg-lira-ground text-lira-muted border-lira-quiet hover:text-lira-ink hover:border-lira-rule'
                                }`}
                              >
                                {r === 'admin' ? 'Admin' : r === 'member' ? 'Membro' : 'Visitante'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1">
                          <button
                            onClick={() => {
                              const canEdit = !player.permissions?.canEditMap
                              updatePlayerRole(player.id, player.role || 'member', {
                                ...player.permissions,
                                canEditMap: canEdit,
                              })
                            }}
                            className={`px-2.5 py-1 rounded-[6px] text-[10px] font-bold border flex items-center gap-1.5 transition-colors ${
                              player.permissions?.canEditMap
                                ? 'bg-lira-online/15 text-lira-online border-lira-online/40'
                                : 'bg-lira-ground text-lira-muted border-lira-quiet'
                            }`}
                          >
                            <Shield className="w-3 h-3" />
                            <span>
                              {player.permissions?.canEditMap
                                ? 'Pode Editar Mapa'
                                : 'Sem Permissão de Mapa'}
                            </span>
                          </button>

                          <button
                            onClick={() => {
                              setKickConfirmPlayer({ id: player.id, name: player.name })
                            }}
                            className="px-2.5 py-1 rounded-[6px] text-[10px] font-bold bg-lira-error/15 hover:bg-lira-error hover:text-lira-ground text-lira-error border border-lira-error/40 transition-colors"
                          >
                            Expulsar
                          </button>
                        </div>
                        </>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <ConfirmModal
        isOpen={!!kickConfirmPlayer}
        title={`Expulsar ${kickConfirmPlayer?.name}?`}
        message={`Tem certeza de que deseja expulsar ${kickConfirmPlayer?.name} desta sala? O participante será desconectado imediatamente.`}
        confirmText="Sim, Expulsar"
        cancelText="Cancelar"
        variant="danger"
        icon="alert"
        onConfirm={() => {
          if (kickConfirmPlayer) {
            kickPlayer(kickConfirmPlayer.id)
            setKickConfirmPlayer(null)
            setSelectedUserMenuId(null)
          }
        }}
        onCancel={() => setKickConfirmPlayer(null)}
      />
    </div>
  )
}
