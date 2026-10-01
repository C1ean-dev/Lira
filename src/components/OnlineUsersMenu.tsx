import React, { useState, useMemo } from 'react'
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
import { knockOnLockedDoor } from '../utils/doorKnockHelper'

/**
 * Outer gate: subscribes ONLY to isOnlineUsersOpen so 60Hz position updates
 * don't re-render this drawer while it's closed (the common case).
 */
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
    setConnectionHostId,
    friends,
    toggleFriend,
    updatePlayerRole,
    teleportToPlayer,
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

  const remoteList = Object.values(remotePlayers)
  const allPlayers: { player: Player; isLocal: boolean }[] = [
    { player: localPlayer, isLocal: true },
    ...remoteList.map((p) => ({ player: p, isLocal: false })),
  ]

  const filteredPlayers = allPlayers.filter(({ player }) => {
    const q = searchQuery.toLowerCase()
    const matchesQuery =
      player.name.toLowerCase().includes(q) ||
      (player.statusText && player.statusText.toLowerCase().includes(q))
    if (!matchesQuery) return false

    if (filterTab === 'friends') {
      return friends.includes(player.id) || player.id === localPlayer.id
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
        icon: <Crown className="w-3 h-3 text-amber-400" />,
        bg: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      }
    }
    if (isHostPlayer) {
      return {
        label: 'Host de Conexão',
        icon: <Zap className="w-3 h-3 text-cyan-400" />,
        bg: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
      }
    }
    if (role === 'admin') {
      return {
        label: 'Admin',
        icon: <Shield className="w-3 h-3 text-indigo-400" />,
        bg: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
      }
    }
    if (role === 'guest') {
      return {
        label: 'Visitante',
        icon: <UserX className="w-3 h-3 text-slate-400" />,
        bg: 'bg-slate-800 text-slate-400 border-slate-700',
      }
    }
    return {
      label: 'Membro',
      icon: <UserCheck className="w-3 h-3 text-emerald-400" />,
      bg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    }
  }

  return (
    <div className="fixed top-16 right-4 w-96 bg-[#161922]/95 backdrop-blur-xl border border-[#2a3142] rounded-3xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[calc(100vh-80px)] animate-in fade-in slide-in-from-right-4 duration-200 select-none">
      {/* Header */}
      <div className="p-4 border-b border-[#2a3142] bg-[#12151d]/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/20">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-slate-100 flex items-center gap-2">
              Pessoas no Espaço
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">
                {allPlayers.length} online
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 truncate max-w-[200px]">
              {roomName || 'Espaço de Trabalho Virtual'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setOnlineUsersOpen(false)}
          className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Invite Banner / Quick Share */}
      <div className="p-3 bg-indigo-950/40 border-b border-indigo-500/20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Share2 className="w-4 h-4 text-indigo-400 shrink-0" />
          <div className="text-xs text-indigo-200 truncate">
            <span className="font-bold">Convidar amigos:</span> Código{' '}
            <span className="font-mono font-bold text-white bg-indigo-900/60 px-1.5 py-0.5 rounded border border-indigo-500/30">
              {roomId || 'Principal'}
            </span>
          </div>
        </div>

        <button
          onClick={handleCopyInvite}
          className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 shrink-0"
        >
          {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copiedLink ? 'Copiado!' : 'Copiar'}</span>
        </button>
      </div>

      {/* Search & Tabs */}
      <div className="p-3 space-y-2.5 border-b border-[#2a3142] bg-[#12151d]/40">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por nome ou status..."
            className="w-full bg-[#12151d] border border-[#2a3142] rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Tab Pills */}
        <div className="flex gap-1.5 bg-[#12151d] p-1 rounded-xl border border-[#2a3142]">
          <button
            onClick={() => setFilterTab('all')}
            className={`flex-1 py-1 rounded-lg text-xs font-bold transition-all ${
              filterTab === 'all'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Todos ({allPlayers.length})
          </button>
          <button
            onClick={() => setFilterTab('friends')}
            className={`flex-1 py-1 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 ${
              filterTab === 'friends'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
            <span>Amigos ({friends.length})</span>
          </button>
        </div>
      </div>

      {/* Members List */}
      <div className="p-3 overflow-y-auto flex-1 space-y-2">
        {filteredPlayers.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500 space-y-1">
            <Users className="w-6 h-6 mx-auto text-slate-600" />
            <div>Nenhum participante encontrado</div>
          </div>
        ) : (
          filteredPlayers.map(({ player, isLocal }) => {
            const isPlayerOwner = isLocal ? isOwner : (player.id.endsWith('-host') || player.isOwner || player.role === 'owner')
            const isPlayerConnectionHost = connectionHostId ? player.id === connectionHostId : (isLocal ? isHost : (player.isHost ?? false))
            const roleBadge = getRoleBadge(player.role, isPlayerOwner, isPlayerConnectionHost && !isPlayerOwner)
            const isFriend = friends.includes(player.id)
            const isMenuOpen = selectedUserMenuId === player.id
            const pingMs = player.ping ?? (isLocal ? 12 : 38)
            const pingColor = pingMs < 60 ? 'text-emerald-400' : pingMs < 120 ? 'text-amber-400' : 'text-rose-400'
            const pingDot = pingMs < 60 ? 'bg-emerald-400' : pingMs < 120 ? 'bg-amber-400' : 'bg-rose-400'

            return (
              <div
                key={player.id}
                className="p-3 rounded-2xl bg-[#12151d]/70 hover:bg-[#12151d] border border-[#2a3142] transition-all space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Avatar Icon */}
                    <div className="relative shrink-0">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs text-white border border-white/20 shadow-sm"
                        style={{ backgroundColor: player.avatar?.shirtColor || player.avatar?.topColor || '#4c6ef5' }}
                      >
                        {player.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[#12151d]" />
                    </div>

                    {/* Name, Status & Location */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-slate-100 truncate">
                          {player.name}
                        </span>
                        {isLocal && (
                          <span className="text-[9px] bg-slate-800 text-slate-300 px-1.5 py-0.2 rounded border border-slate-700 font-semibold">
                            Você
                          </span>
                        )}
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded-md font-bold border flex items-center gap-1 ${roleBadge.bg}`}
                        >
                          {roleBadge.icon}
                          <span>{roleBadge.label}</span>
                        </span>
                        {isPlayerOwner && isPlayerConnectionHost && (
                          <span className="text-[8px] bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 px-1 py-0.2 rounded font-semibold flex items-center gap-0.5">
                            <Zap className="w-2.5 h-2.5" />
                            Host
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                        <span className="flex items-center gap-0.5 text-indigo-300">
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
                      </div>
                    </div>
                  </div>

                  {/* Right Media Status & Quick Actions */}
                  <div className="flex items-center gap-1">
                    {/* Connecting badge — shown while WebRTC ICE/codecs are
                        still negotiating so users see "handshake happening"
                        instead of "frozen / delayed avatar". */}
                    {!isLocal && callStates[player.id] === 'connecting' && (
                      <span
                        className="text-[8px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded font-bold flex items-center gap-1 animate-pulse"
                        title="Estabelecendo conexão de áudio/vídeo…"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                        Conectando
                      </span>
                    )}
                    {!isLocal && callStates[player.id] === 'failed' && (
                      <span
                        className="text-[8px] bg-rose-500/15 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded font-bold flex items-center gap-1"
                        title="Falha na conexão de chamada"
                      >
                        Sem áudio
                      </span>
                    )}
                    {/* Media Badges */}
                    <div className="flex items-center gap-0.5 text-slate-400 bg-slate-900/60 p-1 rounded-lg border border-slate-800">
                      {player.isMuted ? (
                        <MicOff className="w-3 h-3 text-rose-400" />
                      ) : (
                        <Mic className="w-3 h-3 text-emerald-400" />
                      )}
                      {player.isCameraOff ? (
                        <VideoOff className="w-3 h-3 text-slate-500" />
                      ) : (
                        <Video className="w-3 h-3 text-emerald-400" />
                      )}
                      {player.isScreenSharing && (
                        <Tv className="w-3 h-3 text-blue-400 animate-pulse" />
                      )}
                    </div>

                    {/* Quick Message Button */}
                    {!isLocal && (() => {
                      const friendUnread = getUnreadCountForFriend({ id: player.id, name: player.name, actualUserId: player.id })
                      return (
                        <button
                          onClick={() => openDirectMessage({ id: player.id, name: player.name })}
                          className={`p-1.5 rounded-lg border transition-colors relative ${
                            friendUnread > 0
                              ? 'bg-rose-600 text-white border-rose-500 animate-pulse shadow-md shadow-rose-600/30'
                              : 'bg-slate-800/60 text-slate-400 hover:text-indigo-300 hover:bg-indigo-600/20 border-slate-700 hover:border-indigo-500/40'
                          }`}
                          title={
                            friendUnread > 0
                              ? `${friendUnread} nova(s) mensagem(ns) de ${player.name}`
                              : `Conversar com ${player.name}`
                          }
                        >
                          <MessageSquare className={`w-3 h-3 ${friendUnread > 0 ? 'text-white' : 'text-indigo-400'}`} />
                          {friendUnread > 0 && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-[#12151d] animate-ping" />
                          )}
                        </button>
                      )
                    })()}

                    {/* Friend Toggle / Request */}
                    {!isLocal && (() => {
                      const req = getFriendRequestStatus(player.id) || getFriendRequestStatus(player.name)
                      const isPending = req?.status === 'pending'

                      return (
                        <button
                          onClick={() => {
                            if (isFriend) {
                              toggleFriend(player.id, player)
                            } else {
                              sendFriendRequest({ id: player.id, name: player.name, avatar: player.avatar })
                              openDirectMessage({ id: player.id, name: player.name })
                            }
                          }}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            isFriend
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : isPending
                              ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 animate-pulse'
                              : 'bg-slate-800/60 text-slate-400 hover:text-slate-200 border-slate-700'
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
                            <Clock className="w-3 h-3 text-indigo-400" />
                          ) : (
                            <Star className={`w-3 h-3 ${isFriend ? 'fill-amber-400 text-amber-400' : ''}`} />
                          )}
                        </button>
                      )
                    })()}

                    {/* More Menu Dropdown Toggle */}
                    {!isLocal && (
                      <button
                        onClick={() =>
                          setSelectedUserMenuId(isMenuOpen ? null : player.id)
                        }
                        className={`p-1.5 rounded-lg border transition-colors ${
                          isMenuOpen
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-800/60 text-slate-400 hover:text-white border-slate-700'
                        }`}
                        title="Ações e Permissões do Usuário"
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Dropdown Action Menu */}
                {isMenuOpen && !isLocal && (
                  <div className="p-3 bg-[#181c26] rounded-xl border border-indigo-500/30 space-y-2.5 animate-in fade-in duration-150">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Ações & Interação
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => {
                          if (player.currentZoneId) {
                            const zone = mapData.zones?.find((z) => z.id === player.currentZoneId)
                            if (
                              zone &&
                              zone.isLocked &&
                              !useMapStore.getState().isPeerAuthorizedForZone(zone.id, localPlayer.id, localPlayer.name)
                            ) {
                              knockOnLockedDoor(zone)
                              setSelectedUserMenuId(null)
                              return
                            }
                          }
                          teleportToPlayer(player.id)
                          setSelectedUserMenuId(null)
                        }}
                        className="py-1.5 px-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 font-bold text-xs flex items-center gap-1.5 border border-indigo-500/30 transition-colors"
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>Ir até {player.name.split(' ')[0]}</span>
                      </button>

                      <button
                        onClick={() => {
                          openDirectMessage({ id: player.id, name: player.name })
                          setSelectedUserMenuId(null)
                        }}
                        className="py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 border border-slate-700 transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Mensagem</span>
                      </button>

                      {!isFriend && (
                        <button
                          onClick={() => {
                            sendFriendRequest({ id: player.id, name: player.name, avatar: player.avatar })
                            openDirectMessage({ id: player.id, name: player.name })
                            setSelectedUserMenuId(null)
                          }}
                          className="py-1.5 px-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 font-bold text-xs flex items-center gap-1.5 border border-emerald-500/30 transition-colors col-span-2"
                        >
                          <UserPlus className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Adicionar aos Amigos</span>
                        </button>
                      )}
                    </div>

                    {/* Permissions (Owner only) */}
                    {isOwner && (
                      <div className="pt-2 border-t border-slate-800 space-y-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Gerenciar Participante (Dono da Sala)
                        </div>

                        {/* Assign as Connection Host */}
                        <button
                          onClick={() => {
                            setConnectionHostId(player.id)
                            setSelectedUserMenuId(null)
                          }}
                          className={`w-full py-1.5 px-2.5 rounded-lg text-xs font-bold border flex items-center justify-between transition-colors ${
                            isPlayerConnectionHost
                              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                              : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                          title="Define este participante como o nó de melhor conexão para retransmitir dados do espaço"
                        >
                          <div className="flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-cyan-400" />
                            <span>{isPlayerConnectionHost ? 'Host de Conexão Ativo' : 'Tornar Host de Conexão'}</span>
                          </div>
                          <span className="text-[10px] font-mono text-emerald-400">{pingMs}ms</span>
                        </button>

                        <div className="flex items-center justify-between gap-1 text-xs">
                          <span className="text-slate-300">Cargo:</span>
                          <div className="flex gap-1">
                            {(['admin', 'member', 'guest'] as UserRole[]).map((r) => (
                              <button
                                key={r}
                                onClick={() => updatePlayerRole(player.id, r)}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                                  player.role === r || (!player.role && r === 'member')
                                    ? 'bg-indigo-600 text-white border-indigo-500'
                                    : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
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
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border flex items-center gap-1.5 transition-colors ${
                              player.permissions?.canEditMap
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : 'bg-slate-900 text-slate-400 border-slate-700'
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
                            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40 transition-colors"
                          >
                            Expulsar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Styled Kick Confirmation Modal */}
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
