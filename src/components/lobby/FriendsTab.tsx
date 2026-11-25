import React, { useState, useEffect, useMemo } from 'react'
import {
  Users,
  Search,
  UserPlus,
  MessageSquare,
  ArrowRight,
  Trash2,
  Star,
  Globe,
  Sparkles,
  Check,
  Clock,
  AlertCircle,
} from 'lucide-react'
import { FriendProfile, STATUS_META, PresenceStatus } from '../../types/game'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore, getDmChannelId } from '../../store/useChatStore'
import { FriendsPresenceService } from '../../services/friendsPresenceService'
import { PlayerAvatar } from '../common/PlayerAvatar'
import { StatusBadge } from '../common/StatusBadge'
import { MoonPhaseIcon } from '../common/MoonPhaseIcon'
import { Button, Input, Badge, Card } from '../ui'

interface Props {
  onOpenChat: (friend: FriendProfile) => void
  onJoinRoom: (code: string) => void
}

export const FriendsTab: React.FC<Props> = ({ onOpenChat, onJoinRoom }) => {
  const { friends, friendProfiles, addFriend, removeFriend, localPlayer } = useGameStore()
  const {
    channels,
    messages,
    lastReadByPeer,
    getUnreadCountForFriend,
    getLastMessageWithFriend,
    sendFriendRequest,
    getFriendRequestStatus,
  } = useChatStore()

  const [searchQuery, setSearchQuery] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newFriendName, setNewFriendName] = useState('')
  const [addSuccess, setAddSuccess] = useState(false)
  const [addFeedback, setAddFeedback] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [presenceTick, setPresenceTick] = useState(0)
  const [sendingTargetIds, setSendingTargetIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const unsub = FriendsPresenceService.getInstance().subscribe(() => {
      setPresenceTick((t) => t + 1)
    })
    return () => unsub()
  }, [])

  const friendsList = useMemo(() => {
    return friends.map((id) => {
      const profile: FriendProfile = friendProfiles[id] || {
        id,
        name: 'Amigo',
        lastSeen: Date.now(),
      }
      const presence = FriendsPresenceService.getInstance().getFriendStatus(profile)
      return {
        ...profile,
        isOnline: presence.isOnline,
        roomCode: presence.roomCode,
        roomName: presence.roomName,
        inRoom: presence.inRoom,
        status: presence.status || profile.status || 'available',
        statusText: presence.statusText || profile.statusText || 'Disponível',
      }
    })
  }, [friends, friendProfiles, presenceTick])

  const filteredFriends = useMemo(() => {
    let list = friendsList
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          (f.statusText && f.statusText.toLowerCase().includes(q)) ||
          (f.roomName && f.roomName.toLowerCase().includes(q))
      )
    }
    return list
  }, [friendsList, searchQuery])

  const nonFriendOnlineUsers = useMemo(() => {
    const allPresences = FriendsPresenceService.getInstance().getAllPresences()
    const myId = localPlayer.id
    const myGameId = localPlayer.gameId

    return allPresences.filter((p) => {
      if (p.userId === myId || (myGameId && p.userId === myGameId)) return false
      const isAlreadyFriend = friends.some((fid) => {
        const fp = friendProfiles[fid]
        return (
          fid === p.userId ||
          (fp?.actualUserId && fp.actualUserId === p.userId) ||
          (fp?.name && fp.name.toLowerCase() === p.name.toLowerCase())
        )
      })
      return !isAlreadyFriend
    })
  }, [friends, friendProfiles, localPlayer, presenceTick])

  const onlineFriends = filteredFriends.filter((f) => f.isOnline)
  const offlineFriends = filteredFriends.filter((f) => !f.isOnline)

  const getUnreadCount = (friend: FriendProfile) => {
    return getUnreadCountForFriend(friend)
  }

  const handleAddFriend = (e: React.FormEvent) => {
    e.preventDefault()
    const name = newFriendName.trim()
    if (!name) return

    const isAlreadyFriend = friends.some((id) => {
      const p = friendProfiles[id]
      return (
        id.toLowerCase() === name.toLowerCase() ||
        (p?.name && p.name.toLowerCase() === name.toLowerCase())
      )
    })
    if (isAlreadyFriend) {
      setAddFeedback('Esta pessoa já está na sua lista de amigos!')
      setTimeout(() => setAddFeedback(null), 3000)
      return
    }

    const existingReq = getFriendRequestStatus(name)
    if (existingReq?.status === 'pending') {
      setAddFeedback('Solicitação de amizade já está pendente no chat!')
      setTimeout(() => setAddFeedback(null), 3000)
      return
    }

    const allPresences = FriendsPresenceService.getInstance().getAllPresences()
    const targetPresence = allPresences.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() ||
        p.userId.toLowerCase() === name.toLowerCase()
    )

    const targetId = targetPresence
      ? targetPresence.userId
      : `friend-${name.toLowerCase().replace(/\s+/g, '-')}`

    sendFriendRequest({
      id: targetId,
      name,
      avatar: targetPresence?.avatar,
    })

    onOpenChat({
      id: targetId,
      name,
      avatar: targetPresence?.avatar,
      actualUserId: targetPresence?.userId,
      lastSeen: Date.now(),
      statusText: 'Solicitação enviada',
    })

    setNewFriendName('')
    setAddSuccess(true)
    setTimeout(() => {
      setAddSuccess(false)
      setShowAddForm(false)
    }, 1500)
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4 font-mono text-lira-ink bg-lira-panel">
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-lira-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar amigos por nome ou sala..."
            className="pl-9 pr-3"
          />
        </div>

        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setShowAddForm((prev) => !prev)}
          className="h-9"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>{showAddForm ? 'Fechar' : 'Adicionar Amigo'}</span>
        </Button>
      </div>

      {showAddForm && (
        <form
          onSubmit={handleAddFriend}
          className="p-3.5 bg-lira-ground border border-dashed border-lira-rule rounded-[12px] space-y-2.5"
        >
          <div className="flex items-center gap-1.5 font-display text-sm font-bold text-lira-accent">
            <Sparkles className="w-3.5 h-3.5 text-lira-accent" />
            <span>Adicionar Novo Amigo via Solicitação</span>
          </div>

          <p className="text-[11px] font-mono text-lira-muted">
            Ao adicionar, uma solicitação interativa será enviada para o chat da outra pessoa para ela aceitar ou recusar.
          </p>

          {addFeedback && (
            <div className="flex items-center gap-1.5 text-xs text-lira-amber bg-lira-amber/15 border border-lira-amber/40 rounded-[8px] p-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-lira-amber" />
              <span>{addFeedback}</span>
            </div>
          )}

          <div className="flex gap-2">
            <Input
              type="text"
              value={newFriendName}
              onChange={(e) => setNewFriendName(e.target.value)}
              placeholder="Digite o nome ou apelido do amigo..."
              className="flex-1"
            />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!newFriendName.trim()}
              className="h-9"
            >
              {addSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Enviada!</span>
                </>
              ) : (
                <span>Enviar Solicitação</span>
              )}
            </Button>
          </div>
        </form>
      )}

      {nonFriendOnlineUsers.length > 0 && (
        <Card variant="dashed" className="p-3.5 bg-lira-ground space-y-2.5">
          <div className="flex items-center justify-between text-xs font-bold text-lira-accent">
            <div className="flex items-center gap-1.5 font-display text-sm">
              <Sparkles className="w-3.5 h-3.5 text-lira-accent" />
              <span>Pessoas Online no Espaço / Rede ({nonFriendOnlineUsers.length})</span>
            </div>
            <span className="text-[10px] font-mono text-lira-muted font-normal">
              Envie uma solicitação para virarem amigos
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {nonFriendOnlineUsers.map((user) => {
              const req = getFriendRequestStatus(user.userId) || getFriendRequestStatus(user.name)
              const isPending = req?.status === 'pending'

              return (
                <Card
                  key={user.userId}
                  variant="surface"
                  className="p-2.5 hover:border-lira-accent rounded-[8px] flex items-center justify-between gap-2 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <PlayerAvatar
                      player={user}
                      name={user.name}
                      avatar={user.avatar}
                      profilePicture={(user as any).profilePicture}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-lira-ink truncate">
                        {user.name}
                      </div>
                      <div className="text-[10px] text-lira-muted truncate">
                        {user.inRoom ? `Em: ${user.roomName || 'Sala'}` : 'No Lobby'}
                      </div>
                    </div>
                  </div>

                  {isPending ? (
                    <Button
                      type="button"
                      variant="quiet"
                      size="xs"
                      onClick={() =>
                        onOpenChat({
                          id: user.userId,
                          name: user.name,
                          avatar: user.avatar,
                          actualUserId: user.userId,
                          lastSeen: Date.now(),
                          statusText: 'Solicitação pendente',
                        })
                      }
                      title="Abrir conversa no chat"
                    >
                      <Clock className="w-3 h-3 text-lira-accent" />
                      <span>Pendente</span>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      size="xs"
                      disabled={isPending || sendingTargetIds.has(user.userId)}
                      onClick={() => {
                        if (isPending || sendingTargetIds.has(user.userId)) return
                        setSendingTargetIds((prev) => new Set(prev).add(user.userId))
                        sendFriendRequest({
                          id: user.userId,
                          name: user.name,
                          avatar: user.avatar,
                        })
                        onOpenChat({
                          id: user.userId,
                          name: user.name,
                          avatar: user.avatar,
                          actualUserId: user.userId,
                          lastSeen: Date.now(),
                          statusText: 'Solicitação enviada',
                        })
                        setTimeout(() => {
                          setSendingTargetIds((prev) => {
                            const next = new Set(prev)
                            next.delete(user.userId)
                            return next
                          })
                        }, 1500)
                      }}
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>Adicionar</span>
                    </Button>
                  )}
                </Card>
              )
            })}
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between text-xs font-mono text-lira-muted px-1">
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-lira-accent" />
          <span>
            Total de amigos: <strong className="text-lira-ink">{friends.length}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-lira-online text-[11px] font-semibold">
          <span className="w-2 h-2 rounded-full bg-lira-online" />
          <span>{onlineFriends.length} online agora</span>
        </div>
      </div>

      {friends.length === 0 ? (
        <Card variant="dashed" className="text-center py-12 px-4 bg-lira-ground space-y-3">
          <div className="w-12 h-12 rounded-[12px] bg-lira-surface border border-lira-rule mx-auto flex items-center justify-center text-lira-accent">
            <Users className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-display text-base font-bold text-lira-accent">Sua lista de amigos está vazia</h4>
            <p className="text-xs font-mono text-lira-muted max-w-sm mx-auto">
              Adicione amigos clicando no botão acima ou clique no ícone de estrela ⭐ ao lado de qualquer participante quando estiver dentro de uma sala!
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setShowAddForm(true)}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Adicionar Primeiro Amigo</span>
          </Button>
        </Card>
      ) : filteredFriends.length === 0 ? (
        <div className="text-center py-8 text-xs font-mono text-lira-muted">
          Nenhum amigo encontrado para "{searchQuery}"
        </div>
      ) : (
        <div className="space-y-4">
          {onlineFriends.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono font-extrabold uppercase tracking-wider text-lira-online flex items-center gap-1.5 px-1">
                <span className="w-1.5 h-1.5 rounded-full bg-lira-online" />
                <span>Online Agora ({onlineFriends.length})</span>
              </div>

              <div className="space-y-2">
                {onlineFriends.map((friend) => {
                  const unread = getUnreadCount(friend)
                  const lastMsg = getLastMessageWithFriend(friend)
                  const isConfirming = confirmDeleteId === friend.id
                  const statusKey = (friend.status as PresenceStatus) || 'available'
                  const statusMeta = STATUS_META[statusKey] || STATUS_META.available
                  const displayStatusText = friend.statusText || statusMeta.label || 'Disponível'

                  return (
                    <Card
                      key={friend.id}
                      variant="ground"
                      className={`p-3.5 hover:bg-lira-surface/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        unread > 0
                          ? 'border-lira-error bg-lira-surface/40'
                          : 'border-lira-online/40 hover:border-lira-online'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <PlayerAvatar
                          player={friend}
                          showStatus={true}
                          status={statusKey}
                          size="md"
                        />

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-display text-sm font-bold text-lira-ink truncate">
                              {friend.name}
                            </span>
                            <StatusBadge status={statusKey} label={displayStatusText} />
                            {unread > 0 && (
                              <Badge variant="error" className="text-[9px] font-extrabold">
                                <MessageSquare className="w-2.5 h-2.5 fill-current" />
                                <span>{unread} nova{unread > 1 ? 's' : ''} mensagem{unread > 1 ? 'ens' : ''}</span>
                              </Badge>
                            )}
                          </div>

                          <div className="text-[11px] font-mono text-lira-muted truncate mt-0.5 flex items-center gap-1.5">
                            <span className="font-medium flex items-center gap-1 text-lira-ink">
                              <MoonPhaseIcon status={statusKey} className="w-3.5 h-3.5" />
                              <span className="truncate">{displayStatusText}</span>
                            </span>
                            {friend.inRoom && friend.roomName ? (
                              <>
                                <span className="text-lira-rule">•</span>
                                <span className="text-lira-accent font-medium flex items-center gap-1 truncate" title={`Na sala: ${friend.roomName}`}>
                                  <Globe className="w-3 h-3 text-lira-accent shrink-0" />
                                  <span className="truncate">Em: {friend.roomName}</span>
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-lira-rule">•</span>
                                <span className="text-lira-muted truncate">No Lobby / Tela Inicial</span>
                              </>
                            )}
                          </div>

                          {lastMsg && (
                            <div className={`text-[11px] font-mono truncate mt-1 flex items-center gap-1.5 ${unread > 0 ? 'text-lira-error font-medium' : 'text-lira-muted'}`}>
                              <MessageSquare className={`w-3 h-3 shrink-0 ${unread > 0 ? 'text-lira-error' : 'text-lira-muted'}`} />
                              <span className="truncate">
                                <span className={unread > 0 ? 'text-lira-error font-bold' : 'text-lira-ink'}>
                                  {lastMsg.senderName?.split(' ')[0]}:
                                </span>{' '}
                                {lastMsg.content}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        {friend.inRoom && friend.roomCode && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => onJoinRoom(friend.roomCode!)}
                            title={`Entrar na sala "${friend.roomName || ''}"`}
                          >
                            <span>Entrar</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant={unread > 0 ? 'destructive' : 'quiet'}
                          size="sm"
                          onClick={() => onOpenChat(friend)}
                        >
                          <MessageSquare className={`w-3.5 h-3.5 ${unread > 0 ? 'fill-current' : 'text-lira-accent'}`} />
                          <span>{unread > 0 ? `Responder (${unread})` : 'Chat'}</span>
                        </Button>

                        {isConfirming ? (
                          <div className="flex items-center gap-1 bg-lira-surface p-1 rounded-[8px] border border-lira-error/50">
                            <Button
                              type="button"
                              variant="destructive"
                              size="xs"
                              onClick={() => {
                                removeFriend(friend.id)
                                setConfirmDeleteId(null)
                              }}
                              className="h-6 px-2 text-[10px]"
                            >
                              Remover
                            </Button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1.5 py-0.5 text-lira-muted hover:text-lira-ink text-[10px] font-mono"
                            >
                              X
                            </button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setConfirmDeleteId(friend.id)}
                            className="h-8 w-8 hover:text-lira-error hover:border-lira-error/40"
                            title="Remover dos amigos"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}

          {offlineFriends.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-mono font-extrabold uppercase tracking-wider text-lira-muted px-1">
                Offline ({offlineFriends.length})
              </div>

              <div className="space-y-2">
                {offlineFriends.map((friend) => {
                  const unread = getUnreadCount(friend)
                  const lastMsg = getLastMessageWithFriend(friend)
                  const isConfirming = confirmDeleteId === friend.id

                  return (
                    <Card
                      key={friend.id}
                      variant="ground"
                      className={`p-3 hover:bg-lira-surface/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        unread > 0
                          ? 'border-lira-error bg-lira-surface/40 opacity-100'
                          : 'border-lira-quiet opacity-80 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <PlayerAvatar
                          player={friend}
                          showStatus={true}
                          status="offline"
                          size="sm"
                          className="opacity-75"
                        />

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-display text-sm font-bold text-lira-muted truncate">
                              {friend.name}
                            </span>
                            {unread > 0 && (
                              <Badge variant="error" className="text-[9px] font-extrabold">
                                <MessageSquare className="w-2.5 h-2.5 fill-current" />
                                <span>{unread} nova{unread > 1 ? 's' : ''} mensagem{unread > 1 ? 'ens' : ''}</span>
                              </Badge>
                            )}
                          </div>

                          <div className="text-[10px] font-mono text-lira-muted truncate mt-0.5">
                            {friend.lastSeen
                              ? `Visto por último: ${new Date(friend.lastSeen).toLocaleDateString([], {
                                  day: '2-digit',
                                  month: '2-digit',
                                })} às ${new Date(friend.lastSeen).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}`
                              : 'Offline'}
                          </div>

                          {lastMsg && (
                            <div className={`text-[11px] font-mono truncate mt-1 flex items-center gap-1.5 ${unread > 0 ? 'text-lira-error font-medium' : 'text-lira-muted'}`}>
                              <MessageSquare className={`w-3 h-3 shrink-0 ${unread > 0 ? 'text-lira-error' : 'text-lira-muted'}`} />
                              <span className="truncate">
                                <span className={unread > 0 ? 'text-lira-error font-bold' : 'text-lira-ink'}>
                                  {lastMsg.senderName?.split(' ')[0]}:
                                </span>{' '}
                                {lastMsg.content}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <Button
                          type="button"
                          variant={unread > 0 ? 'destructive' : 'quiet'}
                          size="sm"
                          onClick={() => onOpenChat(friend)}
                        >
                          <MessageSquare className={`w-3.5 h-3.5 ${unread > 0 ? 'fill-current' : 'text-lira-accent'}`} />
                          <span>{unread > 0 ? `Responder (${unread})` : 'Chat'}</span>
                        </Button>

                        {isConfirming ? (
                          <div className="flex items-center gap-1 bg-lira-surface p-1 rounded-[8px] border border-lira-error/50">
                            <Button
                              type="button"
                              variant="destructive"
                              size="xs"
                              onClick={() => {
                                removeFriend(friend.id)
                                setConfirmDeleteId(null)
                              }}
                              className="h-6 px-2 text-[10px]"
                            >
                              Remover
                            </Button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1.5 py-0.5 text-lira-muted hover:text-lira-ink text-[10px] font-mono"
                            >
                              X
                            </button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setConfirmDeleteId(friend.id)}
                            className="h-8 w-8 hover:text-lira-error hover:border-lira-error/40"
                            title="Remover dos amigos"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
