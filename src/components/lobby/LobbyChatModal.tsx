import React, { useState, useEffect, useRef } from 'react'
import { X, Send, MessageSquare, ArrowRight, Smile, Radio } from 'lucide-react'
import { FriendProfile, STATUS_META, PresenceStatus } from '../../types/game'
import { ChatMessage } from '../../types/chat'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore, getLocalDmChannelId } from '../../store/useChatStore'
import { FriendsPresenceService } from '../../services/friendsPresenceService'
import { PeerManager } from '../../p2p/PeerManager'
import { FriendRequestCard } from '../chat/FriendRequestCard'
import { RoomInviteCard } from '../chat/RoomInviteCard'
import { MessageStatusIcon } from '../chat/MessageStatusIcon'
import { StatusBadge } from '../common/StatusBadge'
import { MoonPhaseIcon } from '../common/MoonPhaseIcon'
import { Button, Input, Card } from '../ui'
import { getPlayerUserId, getFriendUserId, isSameParticipant } from '../../utils/userId'
import { getRoomInviteState, readRoomInvite } from '../../utils/roomInvite'
import { useChatPagination } from '../../hooks/useChatPagination'
import { renderChatContent } from '../../utils/chatLinks'
import { PeerSecurityIconButton } from '../security/PeerSecurityIconButton'

interface Props {
  friend: FriendProfile
  onClose: () => void
  onJoinRoom?: (code: string) => void
}

const QUICK_EMOJIS = ['👋', '👍', '❤️', '😂', '🚀', '🎉']

export const LobbyChatModal: React.FC<Props> = ({ friend, onClose, onJoinRoom }) => {
  const { localPlayer, friends, friendProfiles } = useGameStore()
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

  const inputRef = useRef<HTMLInputElement>(null)

  const friendUserId = getFriendUserId(friend)
  const channelId = getLocalDmChannelId(friendUserId || friend.id)

  useEffect(() => {
    const unsub = FriendsPresenceService.getInstance().subscribe(() => {
      setPresence(FriendsPresenceService.getInstance().getFriendStatus(friend))
    })
    return () => unsub()
  }, [friend])

  useEffect(() => {
    markChannelAsRead(channelId)
    const peerIdentifiers = [friend.name, friend.id, friend.actualUserId || ''].filter(Boolean)
    markPeerAsRead(peerIdentifiers)
    inputRef.current?.focus()

    peerIdentifiers.forEach((id) => {
      FriendsPresenceService.getInstance().sendReadReceipt(id, friend.name, channelId)
      try {
        PeerManager.getInstance().sendMessageStatus(id, channelId, 'read', undefined, Date.now())
      } catch (e) {}
    })
  }, [channelId, friend, markChannelAsRead, markPeerAsRead])

  const chatMessages = messages.filter((m) => {
    if (m.channelId === channelId) return true
    if (!m.channelId?.startsWith('dm-') && !m.recipientId) return false
    return (
      isSameParticipant(friend, m.senderId, m.senderName) ||
      isSameParticipant(friend, m.recipientId, m.recipientName)
    )
  })

  const pagination = useChatPagination(chatMessages, channelId)

  useEffect(() => {
    const peerIdentifiers = [friend.name, friend.id, friend.actualUserId || ''].filter(Boolean)
    markPeerAsRead(peerIdentifiers)
    markChannelAsRead(channelId)

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
      senderId: getPlayerUserId(localPlayer),
      senderName: localPlayer.name || 'Você',
      channelId,
      recipientId: friendUserId || friend.actualUserId || friend.id,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-lira-ground/85 p-4 font-mono text-lira-ink">
      <Card variant="dashed" className="w-full max-w-xl overflow-hidden flex flex-col h-[580px] max-h-[92vh]">
        <div className="bg-lira-surface border-b border-dashed border-lira-rule/60 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative shrink-0">
              <div
                className="w-10 h-10 rounded-[6px] flex items-center justify-center font-bold text-sm text-lira-ground border border-lira-rule"
                style={{
                  backgroundColor:
                    friend.avatar?.shirtColor || friend.avatar?.topColor || '#d1b5ff',
                }}
              >
                {friend.name.charAt(0).toUpperCase()}
              </div>
              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full ring-2 ring-lira-surface bg-lira-surface overflow-hidden flex items-center justify-center">
                <MoonPhaseIcon
                  status={
                    presence.isOnline
                      ? (presence.status as PresenceStatus) || friend.status || 'available'
                      : 'offline'
                  }
                  className="w-full h-full"
                  withBackground={true}
                />
              </span>
            </div>

            <div className="min-w-0">
              {(() => {
                const statusKey = (presence.status as PresenceStatus) || friend.status || 'available'
                const statusMeta = STATUS_META[statusKey] || STATUS_META.available
                const displayStatusText = presence.statusText || friend.statusText || statusMeta.label || 'Disponível'

                return (
                  <>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-base font-bold text-lira-accent truncate">
                        {friend.name}
                      </h3>
                      <StatusBadge
                        status={presence.isOnline ? statusKey : 'offline'}
                        label={presence.isOnline ? displayStatusText : 'Offline'}
                      />
                    </div>

                    <p className="text-[11px] font-mono text-lira-muted truncate mt-0.5 flex items-center gap-1.5">
                      {presence.isOnline ? (
                        <>
                          <span className="text-lira-ink font-medium">{displayStatusText}</span>
                          {presence.inRoom && presence.roomName ? (
                            <>
                              <span className="text-lira-rule">•</span>
                              <span className="text-lira-accent font-medium truncate">
                                Em: {presence.roomName}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-lira-rule">•</span>
                              <span className="text-lira-muted">No Lobby / Tela Inicial</span>
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

          <div className="flex items-center gap-2">
            <PeerSecurityIconButton
              size="sm"
              peerId={friendUserId || friend.actualUserId || friend.id}
              displayName={friend.name}
              candidateIds={[friendUserId, friend.actualUserId, friend.gameId, friend.id]}
            />
            {presence.isOnline && presence.roomCode && onJoinRoom && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onJoinRoom(presence.roomCode!)}
                title="Entrar no mesmo espaço de trabalho"
              >
                <span>Entrar na Sala</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}

            <Button
              type="button"
              variant="icon"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div ref={pagination.messagesRef} onScroll={pagination.onScroll} onWheel={pagination.onWheel} onTouchStart={pagination.onTouchStart} onTouchMove={pagination.onTouchMove} className="flex-1 min-h-0 overflow-y-auto p-4 bg-lira-panel">
          <div ref={pagination.contentRef} className="space-y-3">
          {chatMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-lira-muted space-y-3 select-none">
              <div className="w-14 h-14 rounded-[12px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent">
                <MessageSquare className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <div className="font-display text-base font-bold text-lira-accent">
                  Nenhuma mensagem com {friend.name}
                </div>
                <div className="text-xs font-mono text-lira-muted max-w-xs">
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
                    className="w-8 h-8 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-base transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ) : (() => {
            const seenRequestIds = new Set<string>()
            let seenAcceptedFriendCard = false

            return pagination.page.messages.map((msg) => {
              const isMe =
                msg.senderId === localPlayer.id ||
                (localPlayer.gameId && msg.senderId === localPlayer.gameId)

              if (msg.friendRequest) {
                const rId = msg.friendRequest.requestId
                const req = msg.friendRequest
                const isAccepted =
                  req.status === 'accepted' ||
                  friends.some((key) => {
                    const fp = friendProfiles[key] || { id: key }
                    return (
                      isSameParticipant(fp, req.fromUserId, req.fromUserName) ||
                      isSameParticipant(fp, req.toUserId, req.toUserName)
                    )
                  })

                if (seenRequestIds.has(rId) || (isAccepted && seenAcceptedFriendCard)) {
                  if (!msg.content) return null
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
                    >
                      <div
                        className={`max-w-[75%] rounded-[12px] px-3.5 py-2.5 text-xs font-mono break-words ${
                          isMe
                            ? 'bg-lira-accent text-lira-ground border border-lira-accent rounded-tr-none font-medium'
                            : 'bg-lira-surface text-lira-ink border border-lira-rule rounded-tl-none'
                        }`}
                      >
                        <div>{renderChatContent(msg.content)}</div>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-mono text-lira-muted px-1">
                        <span>{formatTime(msg.timestamp)}</span>
                        {isMe && <MessageStatusIcon status={msg.status} className="ml-0.5" />}
                      </div>
                    </div>
                  )
                }
                seenRequestIds.add(rId)
                if (isAccepted) {
                  seenAcceptedFriendCard = true
                }

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
                    <div className="flex items-center gap-1 text-[10px] font-mono text-lira-muted px-1">
                      <span>{formatTime(msg.timestamp)}</span>
                      {isMe && <MessageStatusIcon status={msg.status} className="ml-0.5" />}
                    </div>
                  </div>
                )
              }

              const invite = readRoomInvite(msg.roomInvite)
              if (invite) {
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1 w-full my-1`}
                  >
                    <RoomInviteCard
                      invite={invite}
                      state={getRoomInviteState({
                        invite,
                        isMine: !!isMe,
                        currentRoomId: null,
                        inviterPresence: presence,
                      })}
                      senderName={msg.senderName}
                      recipientName={friend.name}
                      onJoin={() => onJoinRoom?.(invite.roomCode)}
                    />
                    <div className="flex items-center gap-1 text-[10px] font-mono text-lira-muted px-1">
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
                    className={`max-w-[75%] rounded-[12px] px-3.5 py-2.5 text-xs font-mono break-words ${
                      isMe
                        ? 'bg-lira-accent text-lira-ground border border-lira-accent rounded-tr-none font-medium'
                        : 'bg-lira-surface text-lira-ink border border-lira-rule rounded-tl-none'
                    }`}
                  >
                    {!isMe && (
                      <div className="text-[10px] font-bold text-lira-accent mb-1">
                        {friend.name}
                      </div>
                    )}
                    <div>{renderChatContent(msg.content)}</div>
                  </div>

                  <div className="flex items-center gap-1 text-[10px] font-mono text-lira-muted px-1">
                    <span>{formatTime(msg.timestamp)}</span>
                    {isMe && <MessageStatusIcon status={msg.status} className="ml-0.5" />}
                  </div>
                </div>
              )
            })
          })()}
          </div>
        </div>

        <div className="px-4 py-1.5 bg-lira-sidebar border-t border-dashed border-lira-rule/60 flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] font-mono text-lira-muted font-semibold flex items-center gap-1">
            <Smile className="w-3 h-3 text-lira-muted" />
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

        <form
          onSubmit={handleSendMessage}
          className="p-3 bg-lira-surface border-t border-dashed border-lira-rule/60 flex items-center gap-2"
        >
          <Input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Mensagem para ${friend.name}...`}
            className="flex-1"
          />

          <Button
            type="submit"
            variant="primary"
            size="icon"
            disabled={!inputText.trim()}
            title="Enviar mensagem (Enter)"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </Card>
    </div>
  )
}
