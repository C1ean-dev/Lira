import React, { useState, useEffect, useRef } from 'react'
import { X, Send, MessageSquare, ArrowRight, Smile, Radio } from 'lucide-react'
import { FriendProfile, STATUS_META, PresenceStatus } from '../../types/game'
import { ChatMessage } from '../../types/chat'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore, getDmChannelId } from '../../store/useChatStore'
import { FriendsPresenceService } from '../../services/friendsPresenceService'
import { PeerManager } from '../../p2p/PeerManager'
import { FriendRequestCard } from '../chat/FriendRequestCard'
import { MessageStatusIcon } from '../chat/MessageStatusIcon'

interface Props {
  friend: FriendProfile
  onClose: () => void
  onJoinRoom?: (code: string) => void
}

const QUICK_EMOJIS = ['👋', '👍', '❤️', '😂', '🚀', '🎉']

export const LobbyChatModal: React.FC<Props> = ({ friend, onClose, onJoinRoom }) => {
  const { localPlayer } = useGameStore()
  const {
    messages,
    addMessage,
    markChannelAsRead,
    markPeerAsRead,
    respondToFriendRequest,
  } = useChatStore()
  const [inputText, setInputText] = useState('')
  const [presence, setPresence] = useState(() =>
    FriendsPresenceService.getInstance().getFriendStatus(friend)
  )

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Channel ID between me and friend
  const channelId = getDmChannelId(localPlayer.id, friend.id)

  // Keep presence updated
  useEffect(() => {
    const unsub = FriendsPresenceService.getInstance().subscribe(() => {
      setPresence(FriendsPresenceService.getInstance().getFriendStatus(friend))
    })
    return () => unsub()
  }, [friend])

  // Mark channel & peer as read on open and emit read receipts
  useEffect(() => {
    markChannelAsRead(channelId)
    const peerIdentifiers = [friend.name, friend.id, friend.actualUserId || ''].filter(Boolean)
    markPeerAsRead(peerIdentifiers)
    inputRef.current?.focus()

    // Send read receipts immediately to friend
    peerIdentifiers.forEach((id) => {
      FriendsPresenceService.getInstance().sendReadReceipt(id, friend.name, channelId)
      try {
        PeerManager.getInstance().sendMessageStatus(id, channelId, 'read', undefined, Date.now())
      } catch (e) {}
    })
  }, [channelId, friend, markChannelAsRead, markPeerAsRead])

  // Filter messages for this conversation
  const chatMessages = messages.filter((m) => {
    if (m.channelId === channelId) return true
    const isFromFriendId =
      m.senderId === friend.id || (friend.actualUserId && m.senderId === friend.actualUserId)
    const isToFriendId =
      m.recipientId === friend.id || (friend.actualUserId && m.recipientId === friend.actualUserId)

    if (
      isToFriendId &&
      (m.senderId === localPlayer.id || m.senderId === localPlayer.gameId)
    ) {
      return true
    }
    if (
      isFromFriendId &&
      (m.recipientId === localPlayer.id || m.recipientId === localPlayer.gameId)
    ) {
      return true
    }

    // Name-based matching fallback
    const friendNameLower = friend.name.toLowerCase()
    if (
      (m.senderName && m.senderName.toLowerCase() === friendNameLower) ||
      (m.recipientName && m.recipientName.toLowerCase() === friendNameLower)
    ) {
      return true
    }
    return false
  })

  // Auto-scroll to bottom & mark as read
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    const peerIdentifiers = [friend.name, friend.id, friend.actualUserId || ''].filter(Boolean)
    markPeerAsRead(peerIdentifiers)
    markChannelAsRead(channelId)

    // Notify sender that incoming messages were read
    peerIdentifiers.forEach((id) => {
      FriendsPresenceService.getInstance().sendReadReceipt(id, friend.name, channelId)
      try {
        PeerManager.getInstance().sendMessageStatus(id, channelId, 'read', undefined, Date.now())
      } catch (e) {}
    })
  }, [chatMessages.length, friend, channelId, markPeerAsRead, markChannelAsRead])

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const content = inputText.trim()
    if (!content) return

    const newMsg: ChatMessage = {
      id: 'dm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8),
      senderId: localPlayer.id,
      senderName: localPlayer.name || 'Você',
      channelId,
      recipientId: friend.actualUserId || friend.id,
      recipientName: friend.name,
      content,
      timestamp: Date.now(),
      status: 'sent',
    }

    addMessage(newMsg)
    FriendsPresenceService.getInstance().sendDirectMessage(newMsg)
    try {
      PeerManager.getInstance().sendChatMessage(newMsg)
    } catch (e) {}
    setInputText('')
  }

  const handleEmojiClick = (emoji: string) => {
    setInputText((prev) => prev + emoji)
    inputRef.current?.focus()
  }

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#07090e]/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-[#161a24] border border-[#2b3345] rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col h-[580px] max-h-[92vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-[#12151e] border-b border-[#262e40] p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {/* Friend Avatar */}
            <div className="relative shrink-0">
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm text-white border border-white/20 shadow-md"
                style={{
                  backgroundColor:
                    friend.avatar?.shirtColor || friend.avatar?.topColor || '#6366f1',
                }}
              >
                {friend.name.charAt(0).toUpperCase()}
              </div>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full ring-2 ring-[#12151e] flex items-center justify-center ${
                  presence.isOnline
                    ? (STATUS_META[(presence.status as PresenceStatus) || friend.status || 'available'] || STATUS_META.available).dotColor
                    : 'bg-slate-500'
                }`}
              />
            </div>

            {/* Info */}
            <div className="min-w-0">
              {(() => {
                const statusKey = (presence.status as PresenceStatus) || friend.status || 'available'
                const statusMeta = STATUS_META[statusKey] || STATUS_META.available
                const displayStatusText = presence.statusText || friend.statusText || statusMeta.label || 'Disponível'

                return (
                  <>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-extrabold text-slate-100 truncate">
                        {friend.name}
                      </h3>
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded-full font-bold border flex items-center gap-1 ${
                          presence.isOnline
                            ? statusKey === 'busy'
                              ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                              : statusKey === 'focusing'
                              ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                              : statusKey === 'away'
                              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                              : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            presence.isOnline ? statusMeta.dotColor : 'bg-slate-500'
                          }`}
                        />
                        <span>{presence.isOnline ? displayStatusText : 'Offline'}</span>
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 truncate mt-0.5 flex items-center gap-1.5">
                      {presence.isOnline ? (
                        <>
                          <span className="text-slate-300 font-medium">{displayStatusText}</span>
                          {presence.inRoom && presence.roomName ? (
                            <>
                              <span className="text-slate-600">•</span>
                              <span className="text-indigo-300 font-medium truncate">
                                Em: {presence.roomName}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-slate-600">•</span>
                              <span className="text-slate-500">No Lobby / Tela Inicial</span>
                            </>
                          )}
                        </>
                      ) : (
                        <span>
                          {friend.lastSeen
                            ? `Visto por último: ${new Date(friend.lastSeen).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}`
                            : 'Visto recentemente'}
                        </span>
                      )}
                    </p>
                  </>
                )
              })()}
            </div>
          </div>

          {/* Top Actions */}
          <div className="flex items-center gap-2">
            {presence.isOnline && presence.roomCode && onJoinRoom && (
              <button
                type="button"
                onClick={() => onJoinRoom(presence.roomCode!)}
                className="px-2.5 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 active:scale-95 transition-all flex items-center gap-1"
                title="Entrar no mesmo espaço de trabalho"
              >
                <span>Entrar na Sala</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Message History */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#11141c]/50">
          {chatMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-3 select-none">
              <div className="w-14 h-14 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-inner">
                <MessageSquare className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-200">
                  Nenhuma mensagem com {friend.name}
                </div>
                <div className="text-xs text-slate-500 max-w-xs">
                  Envie uma mensagem direta para iniciar a conversa! Ela fica salva para consultas futuras.
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => {
                      setInputText(emoji + ' ')
                      inputRef.current?.focus()
                    }}
                    className="w-8 h-8 rounded-xl bg-[#1b202c] hover:bg-indigo-600/20 border border-[#2b3345] hover:border-indigo-500/40 text-base transition-all active:scale-95"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : (() => {
            const seenRequestIds = new Set<string>()

            return chatMessages.map((msg) => {
              const isMe =
                msg.senderId === localPlayer.id ||
                (localPlayer.gameId && msg.senderId === localPlayer.gameId)

              if (msg.friendRequest) {
                const rId = msg.friendRequest.requestId
                if (seenRequestIds.has(rId)) {
                  if (!msg.content) return null
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-xs shadow-sm break-words ${
                          isMe
                            ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-none'
                            : 'bg-[#1e2433] text-slate-100 border border-[#2c354a] rounded-tl-none'
                        }`}
                      >
                        <div>{msg.content}</div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-slate-500 px-1">
                        <span>{formatTime(msg.timestamp)}</span>
                        {isMe && <MessageStatusIcon status={msg.status} className="ml-0.5" />}
                      </div>
                    </div>
                  )
                }
                seenRequestIds.add(rId)

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1 w-full my-1`}
                  >
                    <FriendRequestCard
                      message={msg}
                      onAccept={(reqId) => respondToFriendRequest(reqId, 'accepted')}
                      onDecline={(reqId) => respondToFriendRequest(reqId, 'declined')}
                    />
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 px-1">
                      <span>{formatTime(msg.timestamp)}</span>
                      {isMe && <MessageStatusIcon status={msg.status} className="ml-0.5" />}
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-xs shadow-sm break-words ${
                      isMe
                        ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-tr-none'
                        : 'bg-[#1e2433] text-slate-100 border border-[#2c354a] rounded-tl-none'
                    }`}
                  >
                    {!isMe && (
                      <div className="text-[10px] font-bold text-indigo-300 mb-1">
                        {friend.name}
                      </div>
                    )}
                    <div>{msg.content}</div>
                  </div>

                  <div className="flex items-center gap-1 text-[10px] text-slate-500 px-1">
                    <span>{formatTime(msg.timestamp)}</span>
                    {isMe && <MessageStatusIcon status={msg.status} className="ml-0.5" />}
                  </div>
                </div>
              )
            })
          })()}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Reactions Bar */}
        <div className="px-4 py-1.5 bg-[#12151e]/80 border-t border-[#22293a] flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
            <Smile className="w-3 h-3 text-slate-400" />
            <span>Reagir:</span>
          </span>
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => handleEmojiClick(emoji)}
              className="text-xs hover:scale-125 transition-transform px-1"
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Input Footer */}
        <form
          onSubmit={handleSendMessage}
          className="p-3 bg-[#12151e] border-t border-[#262e40] flex items-center gap-2"
        >
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Mensagem para ${friend.name}...`}
            className="flex-1 bg-[#1a1f2b] border border-[#2b3345] rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white rounded-xl shadow-md shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
            title="Enviar mensagem (Enter)"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
