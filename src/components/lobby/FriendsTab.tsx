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
import { FriendProfile } from '../../types/game'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore, getDmChannelId } from '../../store/useChatStore'
import { FriendsPresenceService } from '../../services/friendsPresenceService'
import { PlayerAvatar } from '../common/PlayerAvatar'

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

  // Subscribe to live presence changes
  useEffect(() => {
    const unsub = FriendsPresenceService.getInstance().subscribe(() => {
      setPresenceTick((t) => t + 1)
    })
    return () => unsub()
  }, [])

  // Build list of all friends with live presence
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
        statusText: presence.statusText || profile.statusText,
      }
    })
  }, [friends, friendProfiles, presenceTick])

  // Filtered friends
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

  // List of online users in the network/lobby who are NOT friends yet
  const nonFriendOnlineUsers = useMemo(() => {
    const allPresences = FriendsPresenceService.getInstance().getAllPresences()
    const myId = localPlayer.id
    const myGameId = localPlayer.gameId

    return allPresences.filter((p) => {
      if (p.userId === myId || (myGameId && p.userId === myGameId)) return false
      // Exclude if already in friends list
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

  // Split into Online and Offline
  const onlineFriends = filteredFriends.filter((f) => f.isOnline)
  const offlineFriends = filteredFriends.filter((f) => !f.isOnline)

  // Get unread count for a friend matching by ID, actualUserId, or Name
  const getUnreadCount = (friend: FriendProfile) => {
    return getUnreadCountForFriend(friend)
  }

  const handleAddFriend = (e: React.FormEvent) => {
    e.preventDefault()
    const name = newFriendName.trim()
    if (!name) return

    // 1. Check if already a friend
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

    // 2. Check if already pending
    const existingReq = getFriendRequestStatus(name)
    if (existingReq?.status === 'pending') {
      setAddFeedback('Solicitação de amizade já está pendente no chat!')
      setTimeout(() => setAddFeedback(null), 3000)
      return
    }

    // 3. Find if person is online to match avatar/id
    const allPresences = FriendsPresenceService.getInstance().getAllPresences()
    const targetPresence = allPresences.find(
      (p) =>
        p.name.toLowerCase() === name.toLowerCase() ||
        p.userId.toLowerCase() === name.toLowerCase()
    )

    const targetId = targetPresence
      ? targetPresence.userId
      : `friend-${name.toLowerCase().replace(/\s+/g, '-')}`

    // 4. Send friend request (interactive chat message)
    sendFriendRequest({
      id: targetId,
      name,
      avatar: targetPresence?.avatar,
    })

    // 5. Open chat modal for this person
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
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      {/* Top Controls: Search + Add Button */}
      <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar amigos por nome ou sala..."
            className="w-full bg-[#12151d] border border-[#2a3142] rounded-xl pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition-all flex items-center justify-center gap-1.5 shrink-0"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>{showAddForm ? 'Fechar' : 'Adicionar Amigo'}</span>
        </button>
      </div>

      {/* Add Friend Collapsible Form */}
      {showAddForm && (
        <form
          onSubmit={handleAddFriend}
          className="p-3.5 bg-[#12151d] border border-indigo-500/30 rounded-2xl space-y-2.5 animate-in fade-in duration-200"
        >
          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Adicionar Novo Amigo via Solicitação</span>
          </div>

          <p className="text-[11px] text-slate-400">
            Ao adicionar, uma solicitação interativa será enviada para o chat da outra pessoa para ela aceitar ou recusar.
          </p>

          {addFeedback && (
            <div className="flex items-center gap-1.5 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>{addFeedback}</span>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={newFriendName}
              onChange={(e) => setNewFriendName(e.target.value)}
              placeholder="Digite o nome ou apelido do amigo..."
              className="flex-1 bg-[#181c26] border border-[#2a3142] rounded-xl px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button
              type="submit"
              disabled={!newFriendName.trim()}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold shadow transition-all flex items-center gap-1 shrink-0"
            >
              {addSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Enviada!</span>
                </>
              ) : (
                <span>Enviar Solicitação</span>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Suggestions: Online Users in Network who are not friends yet */}
      {nonFriendOnlineUsers.length > 0 && (
        <div className="p-3.5 bg-gradient-to-r from-indigo-950/30 via-[#141824] to-[#12151d] border border-indigo-500/20 rounded-2xl space-y-2.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-300">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              <span>Pessoas Online no Espaço / Rede ({nonFriendOnlineUsers.length})</span>
            </div>
            <span className="text-[10px] text-slate-400 font-normal">
              Envie uma solicitação para virarem amigos
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {nonFriendOnlineUsers.map((user) => {
              const req = getFriendRequestStatus(user.userId) || getFriendRequestStatus(user.name)
              const isPending = req?.status === 'pending'

              return (
                <div
                  key={user.userId}
                  className="p-2.5 bg-[#181c28]/80 border border-slate-800 hover:border-indigo-500/30 rounded-xl flex items-center justify-between gap-2 transition-all"
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
                      <div className="text-xs font-bold text-slate-200 truncate">
                        {user.name}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">
                        {user.inRoom ? `Em: ${user.roomName || 'Sala'}` : 'No Lobby'}
                      </div>
                    </div>
                  </div>

                  {isPending ? (
                    <button
                      type="button"
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
                      className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 rounded-lg text-[11px] font-semibold flex items-center gap-1 shrink-0 hover:bg-indigo-500/30"
                      title="Abrir conversa no chat"
                    >
                      <Clock className="w-3 h-3 text-indigo-400" />
                      <span>Pendente</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
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
                      }}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white rounded-lg text-[11px] font-bold shadow-sm shadow-indigo-600/30 flex items-center gap-1 shrink-0 transition-all"
                    >
                      <UserPlus className="w-3 h-3" />
                      <span>Adicionar</span>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Friends Count Banner */}
      <div className="flex items-center justify-between text-xs text-slate-400 px-1">
        <div className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-indigo-400" />
          <span>
            Total de amigos: <strong className="text-slate-200">{friends.length}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>{onlineFriends.length} online agora</span>
        </div>
      </div>

      {/* Friends List */}
      {friends.length === 0 ? (
        <div className="text-center py-12 px-4 rounded-3xl bg-[#12151d]/60 border border-[#2a3142] border-dashed space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mx-auto flex items-center justify-center text-indigo-400">
            <Users className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-slate-200">Sua lista de amigos está vazia</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Adicione amigos clicando no botão acima ou clique no ícone de estrela ⭐ ao lado de qualquer participante quando estiver dentro de uma sala!
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow transition-all inline-flex items-center gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Adicionar Primeiro Amigo</span>
          </button>
        </div>
      ) : filteredFriends.length === 0 ? (
        <div className="text-center py-8 text-xs text-slate-500">
          Nenhum amigo encontrado para "{searchQuery}"
        </div>
      ) : (
        <div className="space-y-4">
          {/* Section: ONLINE FRIENDS */}
          {onlineFriends.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 px-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>Online Agora ({onlineFriends.length})</span>
              </div>

              <div className="space-y-2">
                {onlineFriends.map((friend) => {
                  const unread = getUnreadCount(friend)
                  const lastMsg = getLastMessageWithFriend(friend)
                  const isConfirming = confirmDeleteId === friend.id

                  return (
                    <div
                      key={friend.id}
                      className={`p-3.5 rounded-2xl bg-[#12151d] hover:bg-[#161a24] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm ${
                        unread > 0
                          ? 'border-2 border-rose-500/60 shadow-lg shadow-rose-950/40 bg-gradient-to-r from-rose-950/20 via-[#12151d] to-[#12151d]'
                          : 'border border-emerald-500/25 hover:border-emerald-500/40'
                      }`}
                    >
                      {/* Left: Avatar & Details */}
                      <div className="flex items-center gap-3 min-w-0">
                        <PlayerAvatar
                          player={friend}
                          showStatus={true}
                          status="available"
                          size="md"
                        />

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-100 truncate">
                              {friend.name}
                            </span>
                            <span className="text-[9px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded-full font-bold">
                              Online
                            </span>
                            {unread > 0 && (
                              <span className="text-[9px] bg-rose-500 text-white font-extrabold px-2 py-0.5 rounded-full shadow-md shadow-rose-500/40 flex items-center gap-1 animate-pulse">
                                <MessageSquare className="w-2.5 h-2.5 fill-white" />
                                <span>{unread} nova{unread > 1 ? 's' : ''} mensagem{unread > 1 ? 'ens' : ''}</span>
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-400 truncate mt-0.5 flex items-center gap-1.5">
                            {friend.inRoom && friend.roomName ? (
                              <span className="text-indigo-300 font-semibold flex items-center gap-1">
                                <Globe className="w-3 h-3 text-indigo-400" />
                                <span>Em: {friend.roomName}</span>
                              </span>
                            ) : (
                              <span>No Lobby / Tela Inicial</span>
                            )}
                          </div>

                          {lastMsg && (
                            <div className={`text-[11px] truncate mt-1 flex items-center gap-1.5 ${unread > 0 ? 'text-rose-300 font-medium' : 'text-slate-400'}`}>
                              <MessageSquare className={`w-3 h-3 shrink-0 ${unread > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-500'}`} />
                              <span className="truncate">
                                <span className={unread > 0 ? 'text-rose-200 font-bold' : 'text-slate-300'}>
                                  {lastMsg.senderName?.split(' ')[0]}:
                                </span>{' '}
                                {lastMsg.content}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right Actions */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        {friend.inRoom && friend.roomCode && (
                          <button
                            type="button"
                            onClick={() => onJoinRoom(friend.roomCode!)}
                            className="px-2.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all flex items-center gap-1 active:scale-95"
                            title={`Entrar na sala "${friend.roomName || ''}"`}
                          >
                            <span>Entrar</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onOpenChat(friend)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 relative active:scale-95 ${
                            unread > 0
                              ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/40 border border-rose-400 animate-pulse'
                              : 'bg-[#1b202c] hover:bg-indigo-600/20 text-slate-200 hover:text-indigo-300 border border-[#2a3142] hover:border-indigo-500/40'
                          }`}
                        >
                          <MessageSquare className={`w-3.5 h-3.5 ${unread > 0 ? 'fill-white text-white' : 'text-indigo-400'}`} />
                          <span>{unread > 0 ? `Responder (${unread})` : 'Chat'}</span>
                        </button>

                        {isConfirming ? (
                          <div className="flex items-center gap-1 bg-[#1a1f2c] p-1 rounded-xl border border-rose-500/40">
                            <button
                              type="button"
                              onClick={() => {
                                removeFriend(friend.id)
                                setConfirmDeleteId(null)
                              }}
                              className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold rounded-lg transition-colors"
                            >
                              Remover
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1.5 py-0.5 text-slate-400 hover:text-white text-[10px]"
                            >
                              X
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(friend.id)}
                            className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Remover dos amigos"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Section: OFFLINE FRIENDS */}
          {offlineFriends.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 px-1">
                Offline ({offlineFriends.length})
              </div>

              <div className="space-y-2">
                {offlineFriends.map((friend) => {
                  const unread = getUnreadCount(friend)
                  const lastMsg = getLastMessageWithFriend(friend)
                  const isConfirming = confirmDeleteId === friend.id

                  return (
                    <div
                      key={friend.id}
                      className={`p-3 rounded-2xl bg-[#12151d]/60 hover:bg-[#12151d] transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        unread > 0
                          ? 'border-2 border-rose-500/60 shadow-lg shadow-rose-950/40 bg-gradient-to-r from-rose-950/20 via-[#12151d] to-[#12151d] opacity-100'
                          : 'border border-[#2a3142] opacity-80 hover:opacity-100'
                      }`}
                    >
                      {/* Left: Avatar & Details */}
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
                            <span className="text-xs font-bold text-slate-300 truncate">
                              {friend.name}
                            </span>
                            {unread > 0 && (
                              <span className="text-[9px] bg-rose-500 text-white font-extrabold px-2 py-0.5 rounded-full shadow-md shadow-rose-500/40 flex items-center gap-1 animate-pulse">
                                <MessageSquare className="w-2.5 h-2.5 fill-white" />
                                <span>{unread} nova{unread > 1 ? 's' : ''} mensagem{unread > 1 ? 'ens' : ''}</span>
                              </span>
                            )}
                          </div>

                          <div className="text-[10px] text-slate-500 truncate mt-0.5">
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
                            <div className={`text-[11px] truncate mt-1 flex items-center gap-1.5 ${unread > 0 ? 'text-rose-300 font-medium' : 'text-slate-400'}`}>
                              <MessageSquare className={`w-3 h-3 shrink-0 ${unread > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-500'}`} />
                              <span className="truncate">
                                <span className={unread > 0 ? 'text-rose-200 font-bold' : 'text-slate-300'}>
                                  {lastMsg.senderName?.split(' ')[0]}:
                                </span>{' '}
                                {lastMsg.content}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right Actions */}
                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => onOpenChat(friend)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 relative active:scale-95 ${
                            unread > 0
                              ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/40 border border-rose-400 animate-pulse'
                              : 'bg-[#181c26] hover:bg-indigo-600/20 text-slate-300 hover:text-indigo-300 border border-[#2a3142] hover:border-indigo-500/40'
                          }`}
                        >
                          <MessageSquare className={`w-3.5 h-3.5 ${unread > 0 ? 'fill-white text-white' : 'text-indigo-400'}`} />
                          <span>{unread > 0 ? `Responder (${unread})` : 'Chat'}</span>
                        </button>

                        {isConfirming ? (
                          <div className="flex items-center gap-1 bg-[#1a1f2c] p-1 rounded-xl border border-rose-500/40">
                            <button
                              type="button"
                              onClick={() => {
                                removeFriend(friend.id)
                                setConfirmDeleteId(null)
                              }}
                              className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold rounded-lg transition-colors"
                            >
                              Remover
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1.5 py-0.5 text-slate-400 hover:text-white text-[10px]"
                            >
                              X
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(friend.id)}
                            className="p-1.5 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Remover dos amigos"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
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
