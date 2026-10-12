import React, { useState, useRef, useEffect, useCallback } from 'react'
import {
  MessageSquare,
  Hash,
  Send,
  X,
  Lock,
  Paperclip,
  Download,
  FileText,
  Maximize2,
  Minimize2,
  AlertCircle,
  GripVertical,
  CheckCheck,
  Compass,
  Copy,
  DoorOpen,
  LogIn,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'

const DEFAULT_DRAWER_WIDTH = 440
const MIN_DRAWER_WIDTH = 340
const DEFAULT_CHANNELS_WIDTH = 144
const MIN_CHANNELS_WIDTH = 110

const DRAWER_STORAGE_KEY = 'lira_chat_drawer_width'
const CHANNELS_STORAGE_KEY = 'lira_chat_channels_width'
import { useChatStore, getLocalDmChannelId } from '../store/useChatStore'
import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'
import { PeerManager } from '../p2p/PeerManager'
import { FriendsPresenceService } from '../services/friendsPresenceService'
import { Channel, ChatMessage, ChatAttachment } from '../types/chat'
import { FriendRequestCard } from './chat/FriendRequestCard'
import { PlayerAvatar } from './common/PlayerAvatar'
import { MessageStatusIcon } from './chat/MessageStatusIcon'
import { ChatUserContextMenu } from './chat/ChatUserContextMenu'
import { ChatPeopleList } from './chat/ChatPeopleList'
import { ChatChannelList, ChannelEditing } from './chat/ChatChannelList'
import { SpotifyIcon } from './common/SpotifyIcon'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { toSpotifyDeepLink } from '../types/spotifyJam'
import { MediaManager } from '../media/MediaManager'
import { ChatContextMenu } from './chat/ChatContextMenu'
import { RoomInviteCard } from './chat/RoomInviteCard'
import { ConfirmModal } from './ConfirmModal'
import { getPlayerUserId, findFriendKey } from '../utils/userId'
import { getChatUserFriendState } from '../utils/chatUserActions'
import { buildChatPeople, openChatPerson, ChatPerson } from '../utils/chatPeople'
import { ChatPersonAction, getChatPersonMenu } from '../utils/chatPersonMenu'
import { ChannelAction, getChannelMenu } from '../utils/roomChannels'
import { getRoomInviteState, readRoomInvite } from '../utils/roomInvite'
import { goToPlayer } from '../utils/goToPlayer'
import { createRoomChannel, deleteRoomChannel, renameRoomChannel } from '../services/roomChannelsService'
import { useRoomJoinStore } from '../store/useRoomJoinStore'

const MENU_ICON = 'w-4 h-4 shrink-0'

const PERSON_ACTION_ICONS: Record<ChatPersonAction, React.ReactNode> = {
  message: <MessageSquare className={`${MENU_ICON} text-indigo-400`} />,
  goto: <Compass className={`${MENU_ICON} text-indigo-400`} />,
  invite: <DoorOpen className={`${MENU_ICON} text-emerald-400`} />,
  join: <LogIn className={`${MENU_ICON} text-emerald-400`} />,
  'add-friend': <UserPlus className={`${MENU_ICON} text-indigo-400`} />,
  'remove-friend': <UserMinus className={`${MENU_ICON} text-rose-400`} />,
  'close-conversation': <X className={`${MENU_ICON} text-slate-400`} />,
  'copy-name': <Copy className={`${MENU_ICON} text-slate-400`} />,
}

const CHANNEL_ACTION_ICONS: Record<ChannelAction, React.ReactNode> = {
  'mark-read': <CheckCheck className={`${MENU_ICON} text-slate-400`} />,
  rename: <Pencil className={`${MENU_ICON} text-indigo-400`} />,
  delete: <Trash2 className={`${MENU_ICON} text-rose-400`} />,
  create: <Plus className={`${MENU_ICON} text-emerald-400`} />,
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImageAttachment(att: { type?: string; name?: string }): boolean {
  if (att.type && att.type.startsWith('image/')) return true
  const ext = att.name?.toLowerCase().split('.').pop() || ''
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
}

function downloadAttachment(att: ChatAttachment) {
  try {
    const link = document.createElement('a')
    link.href = att.dataUrl
    link.download = att.name || 'arquivo'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } catch (err) {
    console.error('Falha ao baixar anexo:', err)
  }
}

function extractSpotifyLink(text: string): string | null {
  const match = text.match(/(https?:\/\/(open\.)?spotify\.(com|link)\/[^\s]+|spotify:[a-zA-Z0-9:]+)/i)
  return match ? match[0] : null
}

const SpotifyChatCard: React.FC<{ url: string }> = ({ url }) => {
  const [copied, setCopied] = useState(false)
  const isJam = url.includes('/jam') || url.includes('spotify.link')

  const handleOpen = () => {
    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
    const deep = toSpotifyDeepLink(url)
    if (electronAPI?.openExternal) {
      electronAPI.openExternal(deep)
    } else {
      window.open(url.startsWith('spotify:') ? `https://open.spotify.com/search/${encodeURIComponent(url.replace('spotify:search:', ''))}` : url, '_blank')
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="mt-2 p-2 bg-[#12151d] rounded-xl border border-emerald-500/30 flex items-center justify-between gap-2 shadow-inner">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
          <SpotifyIcon size={14} className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-slate-100 truncate">
            {isJam ? 'Spotify Jam' : 'Spotify Music Link'}
          </div>
          <div className="text-[9px] text-emerald-400 font-mono truncate max-w-[200px]">
            {url}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={handleOpen}
          className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors"
          title="Abrir no Spotify App ou Navegador"
        >
          <SpotifyIcon size={10} className="w-2.5 h-2.5" />
          <span>Ouvir</span>
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="p-1 text-slate-400 hover:text-white bg-slate-800 rounded-lg text-[10px] transition-colors"
          title="Copiar Link"
        >
          {copied ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
    </div>
  )
}

export const ChatDrawer: React.FC = () => {
  const isChatOpen = useChatStore((s) => s.isChatOpen)
  if (!isChatOpen) return null
  return <ChatDrawerInner />
}

const ChatDrawerInner: React.FC = () => {
  const {
    channels,
    activeChannelId,
    messages,
    setChatOpen,
    setActiveChannel,
    openDirectMessage,
    addMessage,
    addReactionToMessage,
    respondToFriendRequest,
    markChannelAsRead,
    sendFriendRequest,
    getFriendRequestStatus,
    closeDirectMessage,
    sendRoomInvite,
  } = useChatStore()

  const { localPlayer, remotePlayers, friends, friendProfiles, roomId, isOwner, removeFriend } = useGameStore()
  const isGridCallOpen = useMediaStore((s) => s.isGridCallOpen)

  const [inputMessage, setInputMessage] = useState('')
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null)
  const [userMenu, setUserMenu] = useState<{ x: number; y: number; msg: ChatMessage } | null>(null)
  const closeUserMenu = useCallback(() => setUserMenu(null), [])

  const openUserMenu = (e: React.MouseEvent, msg: ChatMessage) => {
    e.preventDefault()
    e.stopPropagation()
    setUserMenu({ x: e.clientX, y: e.clientY, msg })
  }

  const [personMenu, setPersonMenu] = useState<{ x: number; y: number; person: ChatPerson } | null>(null)
  const closePersonMenu = useCallback(() => setPersonMenu(null), [])
  const [channelMenu, setChannelMenu] = useState<{ x: number; y: number; channel: Channel | null } | null>(null)
  const closeChannelMenu = useCallback(() => setChannelMenu(null), [])
  const [channelEditing, setChannelEditing] = useState<ChannelEditing>(null)
  const [channelError, setChannelError] = useState<string | null>(null)
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null)
  const [roomToJoin, setRoomToJoin] = useState<{ code: string; name?: string } | null>(null)

  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(DRAWER_STORAGE_KEY)
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= MIN_DRAWER_WIDTH && val <= 1600) {
          return val
        }
      }
    } catch {}
    return DEFAULT_DRAWER_WIDTH
  })

  const [channelsWidth, setChannelsWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(CHANNELS_STORAGE_KEY)
      if (saved) {
        const val = parseInt(saved, 10)
        if (!isNaN(val) && val >= MIN_CHANNELS_WIDTH && val <= 400) {
          return val
        }
      }
    } catch {}
    return DEFAULT_CHANNELS_WIDTH
  })

  const [isResizingDrawer, setIsResizingDrawer] = useState(false)
  const [isResizingChannels, setIsResizingChannels] = useState(false)

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  const [mobileTab, setMobileTab] = useState<'chat' | 'channels'>('chat')

  const drawerWidthRef = useRef(drawerWidth)
  drawerWidthRef.current = drawerWidth

  const channelsWidthRef = useRef(channelsWidth)
  channelsWidthRef.current = channelsWidth

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640)
      const maxW = Math.max(MIN_DRAWER_WIDTH, Math.floor(window.innerWidth * 0.92))
      setDrawerWidth((prev) => (prev > maxW ? maxW : prev))
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (isResizingDrawer || isResizingChannels) {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    } else {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingDrawer, isResizingChannels])

  const handleDrawerResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingDrawer(true)

    const onPointerMove = (moveEv: PointerEvent) => {
      const maxW = Math.max(MIN_DRAWER_WIDTH, Math.min(1200, Math.floor(window.innerWidth * 0.92)))
      const minW = Math.max(MIN_DRAWER_WIDTH, channelsWidthRef.current + 180)
      const nextWidth = Math.min(maxW, Math.max(minW, moveEv.clientX))
      drawerWidthRef.current = nextWidth
      setDrawerWidth(nextWidth)
    }

    const onPointerUp = () => {
      setIsResizingDrawer(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      try {
        localStorage.setItem(DRAWER_STORAGE_KEY, String(drawerWidthRef.current))
      } catch {}
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [])

  const handleChannelsResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingChannels(true)

    const onPointerMove = (moveEv: PointerEvent) => {
      const maxW = Math.min(320, Math.max(MIN_CHANNELS_WIDTH, drawerWidthRef.current - 200))
      const nextWidth = Math.min(maxW, Math.max(MIN_CHANNELS_WIDTH, moveEv.clientX))
      channelsWidthRef.current = nextWidth
      setChannelsWidth(nextWidth)
    }

    const onPointerUp = () => {
      setIsResizingChannels(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      try {
        localStorage.setItem(CHANNELS_STORAGE_KEY, String(channelsWidthRef.current))
      } catch {}
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [])

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const activeChannel = channels.find((c) => c.id === activeChannelId) || channels[0]
  const filteredMessages = messages.filter((m) => {
    if (m.channelId === activeChannelId) return true
    if (activeChannel?.type === 'dm' && activeChannel.recipientId) {
      const recId = activeChannel.recipientId
      const isBetweenUs =
        (m.senderId === localPlayer.id && m.recipientId === recId) ||
        (m.senderId === recId && (m.recipientId === localPlayer.id || !m.recipientId)) ||
        (localPlayer.gameId && m.senderId === localPlayer.gameId && m.recipientId === recId) ||
        (localPlayer.gameId && m.recipientId === localPlayer.gameId && m.senderId === recId)
      return isBetweenUs
    }
    return false
  })
  const people = buildChatPeople({
    remotePlayers: Object.values(remotePlayers),
    friends,
    friendProfiles,
    channels,
    activeChannelId,
    dmChannelIdFor: getLocalDmChannelId,
    getFriendPresence: (friend) => FriendsPresenceService.getInstance().getFriendStatus(friend),
  })

  const canManageChannels = !!roomId && isOwner

  const isRequestPending = (person: ChatPerson) =>
    [person.contactId, person.playerId, person.name].some(
      (key) => !!key && getFriendRequestStatus(key)?.status === 'pending'
    )

  const runPersonAction = (person: ChatPerson, action: ChatPersonAction) => {
    switch (action) {
      case 'message':
        openChatPerson(person, { setActiveChannel, openDirectMessage })
        break
      case 'goto':
        if (person.playerId) goToPlayer(person.playerId)
        break
      case 'invite':
        if (person.contactId) sendRoomInvite({ id: person.contactId, name: person.name })
        break
      case 'join':
        if (person.room) setRoomToJoin(person.room)
        break
      case 'add-friend':
        if (person.contactId) {
          sendFriendRequest({ id: person.contactId, name: person.name, avatar: person.avatarSource?.avatar })
        }
        break
      case 'remove-friend':
        if (person.friendKey) removeFriend(person.friendKey)
        break
      case 'close-conversation':
        if (person.channelId) closeDirectMessage(person.channelId)
        break
      case 'copy-name':
        navigator.clipboard?.writeText(person.name).catch(() => {})
        break
    }
  }

  const startChannelEdit = (editing: ChannelEditing) => {
    setChannelError(null)
    setChannelEditing(editing)
  }

  const runChannelAction = (channel: Channel | null, action: ChannelAction) => {
    switch (action) {
      case 'mark-read':
        if (channel) markChannelAsRead(channel.id)
        break
      case 'rename':
        if (channel) startChannelEdit({ mode: 'rename', channelId: channel.id })
        break
      case 'delete':
        if (channel) setChannelToDelete(channel)
        break
      case 'create':
        startChannelEdit({ mode: 'create' })
        break
    }
  }

  const submitChannelName = (name: string) => {
    if (!channelEditing) return
    const result =
      channelEditing.mode === 'create'
        ? createRoomChannel(name)
        : renameRoomChannel(channelEditing.channelId, name)
    if (result.ok) {
      startChannelEdit(null)
    } else {
      setChannelError(result.error)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [filteredMessages.length])

  const isDmOpen = activeChannel?.type === 'dm'
  useEffect(() => {
    if (isDmOpen) markChannelAsRead(activeChannelId)
  }, [isDmOpen, activeChannelId, filteredMessages.length, markChannelAsRead])

  const [, setPresenceTick] = useState(0)
  useEffect(() => FriendsPresenceService.getInstance().subscribe(() => setPresenceTick((t) => t + 1)), [])

  const handleFileSelect = (file: File) => {
    setUploadError(null)
    const MAX_BYTES = 15 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      setUploadError(`Arquivo excede o limite máximo de 15MB (${(file.size / (1024 * 1024)).toFixed(1)}MB)`)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setPendingAttachment({
        id: 'att-' + Math.random().toString(36).substring(2, 9),
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        dataUrl,
      })
    }
    reader.onerror = () => {
      setUploadError('Erro ao carregar o arquivo.')
    }
    reader.readAsDataURL(file)
  }

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputMessage.trim() && !pendingAttachment) return

    const trimmedInput = inputMessage.trim()
    const lowerInput = trimmedInput.toLowerCase()
    const isDm = activeChannel?.type === 'dm'

    const sendChatMessageWithContent = (text: string) => {
      const newMsg: ChatMessage = {
        id: 'msg-' + Math.random().toString(36).substring(2, 9),
        senderId: isDm ? getPlayerUserId(localPlayer) : localPlayer.id,
        senderName: localPlayer.name,
        channelId: activeChannelId,
        content: text,
        timestamp: Date.now(),
        avatarConfig: localPlayer.avatar,
        recipientId: isDm ? activeChannel.recipientId : undefined,
        status: 'sent',
      }
      addMessage(newMsg)
      PeerManager.getInstance().sendChatMessage(newMsg)
      if (isDm) {
        FriendsPresenceService.getInstance().sendDirectMessage(newMsg)
      }
    }

    if (lowerInput.startsWith('/spotify') || lowerInput.startsWith('/musica')) {
      const parts = trimmedInput.split(' ')
      const subCommand = parts[1]?.toLowerCase()
      const fullArg = parts.slice(1).join(' ').trim()

      if (!subCommand || subCommand === 'ajuda' || subCommand === 'help') {
        const helpMsg: ChatMessage = {
          id: 'msg-' + Math.random().toString(36).substring(2, 9),
          senderId: 'system',
          senderName: 'Spotify',
          channelId: activeChannelId,
          content: '🎵 Comandos do Spotify no Lira:\n• /spotify <música ou termo> - Busca e compartilha a faixa\n• /spotify status - Compartilha o que você está ouvindo no Spotify\n• /spotify jam - Compartilha o link Jam desta sala\n• /spotify web - Abre o player Web persistente integrado\n• /spotify dj - Alterna a transmissão de áudio do Spotify na sala',
          timestamp: Date.now(),
          status: 'delivered',
        }
        addMessage(helpMsg)
        setInputMessage('')
        return
      }

      if (subCommand === 'status' || subCommand === 'tocando' || subCommand === 'ouvindo') {
        const activity = localPlayer.spotifyActivity
        if (activity && activity.isPlaying && activity.track) {
          const trackLabel = `${activity.track}${activity.artist ? ` - ${activity.artist}` : ''}`
          const searchWeb = `https://open.spotify.com/search/${encodeURIComponent(trackLabel)}`
          sendChatMessageWithContent(`🎵 Estou ouvindo no Spotify: ${trackLabel}\n${searchWeb}`)
        } else {
          const infoMsg: ChatMessage = {
            id: 'msg-' + Math.random().toString(36).substring(2, 9),
            senderId: 'system',
            senderName: 'Spotify',
            channelId: activeChannelId,
            content: 'Nenhuma música em execução detectada no Spotify Desktop. Inicie uma música no seu Spotify!',
            timestamp: Date.now(),
            status: 'delivered',
          }
          addMessage(infoMsg)
        }
        setInputMessage('')
        return
      }

      if (subCommand === 'jam') {
        const localZoneId = localPlayer.currentZoneId
        const activeJam = localZoneId ? useSpotifyJamStore.getState().jamsByZone[localZoneId] : null
        if (activeJam?.jamUrl) {
          sendChatMessageWithContent(`🎵 Spotify Jam da sala (${activeJam.zoneName || 'Sala'}):\n${activeJam.jamUrl}`)
        } else {
          const infoMsg: ChatMessage = {
            id: 'msg-' + Math.random().toString(36).substring(2, 9),
            senderId: 'system',
            senderName: 'Spotify',
            channelId: activeChannelId,
            content: 'Nenhuma sessão Jam ativa nesta sala no momento.',
            timestamp: Date.now(),
            status: 'delivered',
          }
          addMessage(infoMsg)
        }
        setInputMessage('')
        return
      }

      if (subCommand === 'web' || subCommand === 'player') {
        const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
        if (electronAPI?.openSpotifyPlayer) {
          electronAPI.openSpotifyPlayer()
        } else {
          window.open('https://open.spotify.com', '_blank')
        }
        setInputMessage('')
        return
      }

      if (subCommand === 'dj') {
        const isDj = MediaManager.getInstance().isDjAudioActive()
        if (isDj) {
          MediaManager.getInstance().stopDjAudio().then(() => {
            const localZoneId = localPlayer.currentZoneId
            if (localZoneId) {
              useSpotifyJamStore.getState().setDjStateInZone(localZoneId, null, true)
            }
          })
          sendChatMessageWithContent('🛑 Encerrei a transmissão de áudio do Spotify (Modo DJ).')
        } else {
          MediaManager.getInstance().startDjAudio().then((res) => {
            if (res.ok) {
              const localZoneId = localPlayer.currentZoneId
              if (localZoneId) {
                useSpotifyJamStore.getState().setDjStateInZone(
                  localZoneId,
                  {
                    zoneId: localZoneId,
                    isDjActive: true,
                    djPeerId: localPlayer.id,
                    djName: localPlayer.name,
                    startedAt: Date.now(),
                  },
                  true
                )
              }
              sendChatMessageWithContent('🎧 Ativei o Modo DJ! Transmitindo áudio do Spotify para a sala.')
            } else {
              const infoMsg: ChatMessage = {
                id: 'msg-' + Math.random().toString(36).substring(2, 9),
                senderId: 'system',
                senderName: 'DJ',
                channelId: activeChannelId,
                content: res.error || 'Não foi possível iniciar o Modo DJ.',
                timestamp: Date.now(),
                status: 'delivered',
              }
              addMessage(infoMsg)
            }
          })
        }
        setInputMessage('')
        return
      }

      // Default: Share track query
      const query = fullArg
      const searchWeb = `https://open.spotify.com/search/${encodeURIComponent(query)}`
      sendChatMessageWithContent(`🎵 Recomendei no Spotify: "${query}"\n${searchWeb}`)

      const localZoneId = localPlayer.currentZoneId
      if (localZoneId) {
        useSpotifyJamStore.getState().shareTrackInZone(localZoneId, query)
      }

      setInputMessage('')
      return
    }

    const newMsg: ChatMessage = {
      id: 'msg-' + Math.random().toString(36).substring(2, 9),
      senderId: isDm ? getPlayerUserId(localPlayer) : localPlayer.id,
      senderName: localPlayer.name,
      channelId: activeChannelId,
      content: trimmedInput,
      timestamp: Date.now(),
      avatarConfig: localPlayer.avatar,
      attachment: pendingAttachment || undefined,
      recipientId: isDm ? activeChannel.recipientId : undefined,
      status: 'sent',
    }

    addMessage(newMsg)
    PeerManager.getInstance().sendChatMessage(newMsg)
    if (isDm) {
      FriendsPresenceService.getInstance().sendDirectMessage(newMsg)
    }
    setInputMessage('')
    setPendingAttachment(null)
    setUploadError(null)
  }

  const handleReact = (msgId: string, emoji: string) => {
    addReactionToMessage(msgId, emoji, localPlayer.id)
  }

  return (
    <div
      style={isMobile ? undefined : { width: `${drawerWidth}px` }}
      onDragOver={(e) => {
        if (isResizingDrawer || isResizingChannels) return
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragging(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragging(false)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleFileSelect(e.dataTransfer.files[0])
        }
      }}
      className={`fixed left-0 bottom-0 ${
        isMobile ? 'w-full max-w-full right-0' : 'max-w-[92vw]'
      } bg-[#12151d] border-r border-[#2a3142] flex flex-col shadow-2xl animate-in slide-in-from-left duration-200 ${
        isResizingDrawer ? '' : 'transition-[width] duration-150 ease-out'
      } ${
        isGridCallOpen ? 'top-0 z-[60]' : 'top-14 z-50'
      }`}
    >
      {!isMobile && (isResizingDrawer || isResizingChannels) && (
        <div className="fixed inset-0 z-[9999] cursor-col-resize select-none bg-transparent" />
      )}

      {!isMobile && (
        <div
          onPointerDown={handleDrawerResizeStart}
          onDoubleClick={() => {
            setDrawerWidth(DEFAULT_DRAWER_WIDTH)
            try {
              localStorage.setItem(DRAWER_STORAGE_KEY, String(DEFAULT_DRAWER_WIDTH))
            } catch {}
          }}
          className={`absolute top-0 -right-2 w-4 h-full cursor-col-resize z-50 select-none group flex items-center justify-center transition-colors ${
            isResizingDrawer ? 'bg-indigo-500/20' : 'hover:bg-indigo-500/10'
          }`}
          title="Arraste para redimensionar o chat (duplo clique para restaurar 440px)"
        >
          <div
            className={`w-1 rounded-full transition-all duration-150 relative flex items-center justify-center ${
              isResizingDrawer
                ? 'h-16 bg-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.9)]'
                : 'h-8 bg-slate-600/40 group-hover:h-12 group-hover:bg-indigo-400 group-hover:shadow-[0_0_8px_rgba(99,102,241,0.6)]'
            }`}
          >
            <div
              className={`absolute pointer-events-none transition-opacity duration-150 ${
                isResizingDrawer ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <div className="p-0.5 rounded-full bg-indigo-600 text-white shadow-md border border-indigo-400/50">
                <GripVertical className="w-3 h-3" />
              </div>
            </div>
          </div>
        </div>
      )}

      {isDragging && (
        <div className="absolute inset-0 z-50 bg-indigo-950/85 backdrop-blur-sm border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center gap-2 text-indigo-200 pointer-events-none animate-in fade-in duration-150">
          <Paperclip className="w-10 h-10 text-indigo-400 animate-bounce" />
          <span className="font-bold text-sm">Solte o arquivo para anexar ao chat</span>
          <span className="text-xs text-indigo-300/70">Imagens, PDFs, documentos até 15MB</span>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a3142] bg-[#1a1f2c] shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-indigo-400" />
          <span className="font-bold text-sm text-slate-100">Chat & Canais</span>
        </div>

        {isMobile && (
          <div className="flex gap-1 bg-[#12151d] p-0.5 rounded-xl border border-[#2a3142]">
            <button
              onClick={() => setMobileTab('channels')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors ${
                mobileTab === 'channels'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Canais
            </button>
            <button
              onClick={() => setMobileTab('chat')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors flex items-center gap-1 ${
                mobileTab === 'chat'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span>Chat</span>
              <span className="text-[10px] text-slate-300 max-w-[65px] truncate font-normal">
                ({activeChannel.name})
              </span>
            </button>
          </div>
        )}

        <div className="flex items-center gap-1">
          {!isMobile && (
            <button
              type="button"
              onClick={() => {
                if (drawerWidth > 580) {
                  setDrawerWidth(DEFAULT_DRAWER_WIDTH)
                  try {
                    localStorage.setItem(DRAWER_STORAGE_KEY, String(DEFAULT_DRAWER_WIDTH))
                  } catch {}
                } else {
                  const expanded = Math.min(760, Math.floor(window.innerWidth * 0.85))
                  setDrawerWidth(expanded)
                  try {
                    localStorage.setItem(DRAWER_STORAGE_KEY, String(expanded))
                  } catch {}
                }
              }}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title={drawerWidth > 580 ? 'Restaurar largura padrão (440px)' : 'Expandir largura do chat'}
            >
              {drawerWidth > 580 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => setChatOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Fechar chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div
          style={isMobile ? undefined : { width: `${channelsWidth}px` }}
          className={`${
            isMobile
              ? mobileTab === 'channels'
                ? 'w-full flex-1 flex'
                : 'hidden'
              : 'flex shrink-0'
          } bg-[#0d1017] border-r border-[#2a3142] flex-col p-2 space-y-4 overflow-y-auto relative ${
            isResizingChannels ? '' : 'transition-[width] duration-150 ease-out'
          }`}
        >
          <ChatChannelList
            channels={channels.filter((c) => c.type !== 'dm')}
            activeChannelId={activeChannelId}
            canManage={canManageChannels}
            editing={channelEditing}
            error={channelError}
            onSelect={(id) => {
              setActiveChannel(id)
              if (isMobile) setMobileTab('chat')
            }}
            onContextMenu={(e, channel) => {
              e.preventDefault()
              setChannelMenu({ x: e.clientX, y: e.clientY, channel })
            }}
            onStartCreate={() => startChannelEdit({ mode: 'create' })}
            onSubmitName={submitChannelName}
            onCancelEdit={() => startChannelEdit(null)}
          />

          <ChatPeopleList
            people={people}
            onOpen={(person) => {
              openChatPerson(person, { setActiveChannel, openDirectMessage })
              if (isMobile) setMobileTab('chat')
            }}
            onContextMenu={(e, person) => {
              e.preventDefault()
              setPersonMenu({ x: e.clientX, y: e.clientY, person })
            }}
          />
        </div>

        {!isMobile && (
          <div
            onPointerDown={handleChannelsResizeStart}
            onDoubleClick={() => {
              setChannelsWidth(DEFAULT_CHANNELS_WIDTH)
              try {
                localStorage.setItem(CHANNELS_STORAGE_KEY, String(DEFAULT_CHANNELS_WIDTH))
              } catch {}
            }}
            className={`relative -ml-1 -mr-1 w-2 h-full cursor-col-resize z-20 select-none group flex items-center justify-center transition-colors ${
              isResizingChannels ? 'bg-indigo-500/30' : 'hover:bg-indigo-500/20'
            }`}
            title="Arraste para redimensionar canais (duplo clique para restaurar 144px)"
          >
            <div
              className={`w-0.5 rounded-full transition-all duration-150 ${
                isResizingChannels
                  ? 'h-10 bg-indigo-400 shadow-[0_0_6px_rgba(99,102,241,0.8)]'
                  : 'h-6 bg-transparent group-hover:bg-indigo-400/80 group-hover:h-8'
              }`}
            />
          </div>
        )}

        <div
          className={`${
            isMobile
              ? mobileTab === 'chat'
                ? 'w-full flex-1 flex'
                : 'hidden'
              : 'flex-1 flex'
          } flex-col bg-[#12151d] overflow-hidden`}
        >
          <div className="px-3 py-2 border-b border-[#2a3142] flex items-center justify-between bg-[#161a24] shrink-0">
            <div className="flex items-center gap-1.5 truncate">
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setMobileTab('channels')}
                  className="px-2 py-0.5 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold flex items-center gap-1 mr-1 shrink-0"
                >
                  ← Canais
                </button>
              )}
              {activeChannel.type === 'dm' ? (
                <div className="w-4 h-4 rounded-full bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-[10px] font-bold text-indigo-300 shrink-0">
                  @
                </div>
              ) : activeChannel.type === 'zone' ? (
                <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Hash className="w-4 h-4 text-slate-400 shrink-0" />
              )}
              <span className="text-xs font-bold text-slate-200 truncate">{activeChannel.name}</span>
            </div>
            <span className="text-[10px] text-slate-400 truncate max-w-[50%]">
              {activeChannel.type === 'dm'
                ? `Conversa privada com ${activeChannel.name}`
                : activeChannel.description}
            </span>
          </div>

          <div className="flex-1 p-3 overflow-y-auto space-y-3">
            {filteredMessages.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-8 space-y-1">
                <div className="font-semibold text-slate-300">
                  {activeChannel.type === 'dm'
                    ? `Conversa direta com ${activeChannel.name}`
                    : 'Nenhuma mensagem enviada ainda.'}
                </div>
                <div className="text-[11px] text-slate-500">
                  {activeChannel.type === 'dm'
                    ? 'Envie uma mensagem ou arquivo para iniciar o papo!'
                    : 'Envie uma mensagem ou arquivo para todos no canal!'}
                </div>
              </div>
            ) : (() => {
              const seenRequestIds = new Set<string>()

              return filteredMessages.map((msg) => {
                const isMine =
                  msg.senderId === localPlayer.id ||
                  (localPlayer.gameId && msg.senderId === localPlayer.gameId)
                const hasAttachment = !!msg.attachment
                const isImage = hasAttachment && isImageAttachment(msg.attachment!)

                 if (msg.friendRequest) {
                  const rId = msg.friendRequest.requestId
                  if (seenRequestIds.has(rId)) {
                    if (!msg.content) return null
                    return (
                      <div key={msg.id} onContextMenu={(e) => openUserMenu(e, msg)} className="group relative flex flex-col space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className={`text-xs font-semibold ${isMine ? 'text-indigo-400' : 'text-slate-300'}`}>
                            {msg.senderName}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-slate-400">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {isMine && <MessageStatusIcon status={msg.status} />}
                          </div>
                        </div>
                        <div className="text-xs text-slate-200 bg-[#1b202c] p-2.5 rounded-xl border border-[#2a3142]/60 break-words">
                          {msg.content}
                        </div>
                      </div>
                    )
                  }
                  seenRequestIds.add(rId)

                  return (
                    <div key={msg.id} onContextMenu={(e) => openUserMenu(e, msg)} className="group relative flex flex-col space-y-1">
                      <div className="flex items-baseline justify-between">
                        <span className={`text-xs font-semibold ${isMine ? 'text-indigo-400' : 'text-slate-300'}`}>
                          {msg.senderName}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-slate-400">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isMine && <MessageStatusIcon status={msg.status} />}
                        </div>
                      </div>
                      <FriendRequestCard
                        message={msg}
                        onAccept={(reqId) => respondToFriendRequest(reqId, 'accepted')}
                        onDecline={(reqId) => respondToFriendRequest(reqId, 'declined')}
                      />
                    </div>
                  )
                }

                const invite = readRoomInvite(msg.roomInvite)
                const inviterKey = isMine ? undefined : findFriendKey(friends, friendProfiles, [msg.senderId])
                if (invite && (isMine || inviterKey)) {
                  const inviterPresence = inviterKey
                    ? FriendsPresenceService.getInstance().getFriendStatus(
                        friendProfiles[inviterKey] || { id: inviterKey, name: msg.senderName }
                      )
                    : null
                  return (
                    <div key={msg.id} onContextMenu={(e) => openUserMenu(e, msg)} className="group relative flex flex-col space-y-1">
                      <div className="flex items-baseline justify-between">
                        <span className={`text-xs font-semibold ${isMine ? 'text-indigo-400' : 'text-slate-300'}`}>
                          {msg.senderName}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-slate-400">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isMine && <MessageStatusIcon status={msg.status} />}
                        </div>
                      </div>
                      <RoomInviteCard
                        invite={invite}
                        state={getRoomInviteState({ invite, isMine: !!isMine, currentRoomId: roomId, inviterPresence })}
                        senderName={msg.senderName}
                        recipientName={msg.recipientName}
                        onJoin={() => setRoomToJoin({ code: invite.roomCode, name: invite.roomName })}
                      />
                    </div>
                  )
                }

                return (
                  <div key={msg.id} onContextMenu={(e) => openUserMenu(e, msg)} className="group relative flex flex-col space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayerAvatar
                          player={
                            isMine
                              ? localPlayer
                              : remotePlayers[msg.senderId] ||
                                Object.values(remotePlayers).find((p) => p.gameId === msg.senderId) ||
                                Object.values(remotePlayers).find((p) => p.name === msg.senderName) ||
                                Object.values(friendProfiles).find((f) => f.name === msg.senderName)
                          }
                          name={msg.senderName}
                          size="xs"
                          className="rounded-full"
                        />
                        <span className={`text-xs font-semibold truncate ${isMine ? 'text-indigo-400' : 'text-slate-300'}`}>
                          {msg.senderName}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-slate-400">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isMine && <MessageStatusIcon status={msg.status} />}
                      </div>
                    </div>

                    <div className="text-xs text-slate-200 bg-[#1b202c] p-2.5 rounded-xl border border-[#2a3142]/60 break-words space-y-2">
                      {msg.content && (
                        <div>
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                          {extractSpotifyLink(msg.content) && (
                            <SpotifyChatCard url={extractSpotifyLink(msg.content)!} />
                          )}
                        </div>
                      )}

                      {hasAttachment && msg.attachment && (
                        <div>
                          {isImage ? (
                            <div className="relative group/img rounded-lg overflow-hidden border border-[#2a3142] bg-black/40 max-w-[280px]">
                              <img
                                src={msg.attachment.dataUrl}
                                alt={msg.attachment.name}
                                className="max-h-48 w-auto object-cover rounded-lg cursor-pointer hover:opacity-95 transition-opacity"
                                onClick={() =>
                                  setLightboxImage({
                                    url: msg.attachment!.dataUrl,
                                    name: msg.attachment!.name,
                                  })
                                }
                              />
                              <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLightboxImage({
                                      url: msg.attachment!.dataUrl,
                                      name: msg.attachment!.name,
                                    })
                                  }
                                  className="p-1 rounded bg-black/70 hover:bg-black/90 text-white backdrop-blur-sm shadow"
                                  title="Expandir imagem"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => downloadAttachment(msg.attachment!)}
                                  className="p-1 rounded bg-black/70 hover:bg-black/90 text-white backdrop-blur-sm shadow"
                                  title="Baixar imagem"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="px-2 py-1 bg-black/60 text-[10px] text-slate-300 truncate">
                                {msg.attachment.name} • {formatFileSize(msg.attachment.size)}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between p-2 bg-[#12151d] hover:bg-[#151923] border border-[#2a3142] rounded-lg gap-2.5 transition-colors group/file">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                                  <FileText className="w-4 h-4" />
                                </div>
                                <div className="overflow-hidden">
                                  <div className="text-xs font-semibold text-slate-200 truncate max-w-[150px] group-hover/file:text-indigo-300 transition-colors">
                                    {msg.attachment.name}
                                  </div>
                                  <div className="text-[10px] text-slate-400">
                                    {formatFileSize(msg.attachment.size)}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => downloadAttachment(msg.attachment!)}
                                className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium rounded-lg flex items-center gap-1.5 shadow transition-all shrink-0 active:scale-95"
                                title="Baixar arquivo"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Baixar</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(msg.reactions).map(([emoji, users]) => (
                          <button
                            key={emoji}
                            onClick={() => handleReact(msg.id, emoji)}
                            className={`text-[11px] px-1.5 py-0.5 rounded-md border flex items-center gap-1 ${
                              users.includes(localPlayer.id)
                                ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                                : 'bg-[#1b202c] border-[#2a3142] text-slate-400'
                            }`}
                          >
                            <span>{emoji}</span>
                            <span>{users.length}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            })()}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSendMessage} className="p-3 border-t border-[#2a3142] bg-[#161a24] shrink-0">
            {uploadError && (
              <div className="mb-2 px-2.5 py-1.5 bg-rose-500/10 border border-rose-500/30 rounded-lg flex items-center justify-between text-xs text-rose-300 animate-in fade-in duration-150">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span>{uploadError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUploadError(null)}
                  className="text-rose-400 hover:text-rose-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {pendingAttachment && (
              <div className="mb-2 p-2 bg-[#1b202c] border border-indigo-500/40 rounded-xl flex items-center justify-between gap-2 shadow-lg animate-in slide-in-from-bottom-1 duration-150">
                <div className="flex items-center gap-2 overflow-hidden">
                  {isImageAttachment(pendingAttachment) ? (
                    <img
                      src={pendingAttachment.dataUrl}
                      alt={pendingAttachment.name}
                      className="w-9 h-9 object-cover rounded-lg border border-[#2a3142] shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 bg-indigo-500/20 border border-indigo-500/30 rounded-lg flex items-center justify-center text-indigo-400 shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                  )}
                  <div className="overflow-hidden">
                    <div className="text-xs font-semibold text-slate-100 truncate max-w-[200px]">
                      {pendingAttachment.name}
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {formatFileSize(pendingAttachment.size)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingAttachment(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                  title="Remover anexo"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 bg-[#12151d] border border-[#2a3142] rounded-xl px-2.5 py-1.5 focus-within:border-indigo-500 transition-colors">
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileSelect(e.target.files[0])
                    e.target.value = ''
                  }
                }}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 transition-colors"
                title="Anexar arquivo ou imagem (até 15MB)"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onPaste={(e) => {
                  if (e.clipboardData.files && e.clipboardData.files.length > 0) {
                    e.preventDefault()
                    handleFileSelect(e.clipboardData.files[0])
                  }
                }}
                placeholder={
                  pendingAttachment
                    ? 'Adicione uma legenda (opcional)...'
                    : activeChannel.type === 'dm'
                    ? `Mensagem para @${activeChannel.name}...`
                    : `Mensagem em #${activeChannel.name}...`
                }
                className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-400 focus:outline-none"
              />

              <button
                type="submit"
                disabled={!inputMessage.trim() && !pendingAttachment}
                className="p-1.5 rounded-lg text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 disabled:opacity-30 disabled:hover:bg-transparent transition-all active:scale-95"
                title="Enviar"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </div>
      </div>

      {lightboxImage && (
        <div
          className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[88vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between text-slate-200 mb-2 px-2">
              <span className="text-xs font-semibold truncate max-w-sm">{lightboxImage.name}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadAttachment({
                      id: '',
                      name: lightboxImage.name,
                      size: 0,
                      type: 'image/png',
                      dataUrl: lightboxImage.url,
                    })
                  }
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors flex items-center gap-1.5 text-xs font-medium"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.name}
              className="max-w-full max-h-[78vh] object-contain rounded-2xl border border-white/10 shadow-2xl"
            />
          </div>
        </div>
      )}

      {userMenu && (() => {
        const { state, target, friendKey } = getChatUserFriendState({
          senderId: userMenu.msg.senderId,
          senderName: userMenu.msg.senderName,
          localPlayer,
          remotePlayers,
          friends,
          friendProfiles,
          getRequestStatus: getFriendRequestStatus,
        })
        return (
          <ChatUserContextMenu
            x={userMenu.x}
            y={userMenu.y}
            name={target.name}
            friendState={state}
            onAddFriend={() => sendFriendRequest(target)}
            onRemoveFriend={() => friendKey && useGameStore.getState().removeFriend(friendKey)}
            onCopyName={() => {
              navigator.clipboard?.writeText(target.name).catch(() => {})
            }}
            onClose={closeUserMenu}
          />
        )
      })()}

      {personMenu && (
        <ChatContextMenu
          x={personMenu.x}
          y={personMenu.y}
          title={personMenu.person.name}
          items={getChatPersonMenu(personMenu.person, {
            roomId,
            requestPending: isRequestPending(personMenu.person),
          }).map((item) => ({
            id: item.action,
            label: item.label,
            tone: item.tone,
            disabled: item.disabled,
            icon: PERSON_ACTION_ICONS[item.action],
          }))}
          onSelect={(action) => runPersonAction(personMenu.person, action as ChatPersonAction)}
          onClose={closePersonMenu}
        />
      )}

      {channelMenu && (() => {
        const menu = getChannelMenu(channelMenu.channel, { canManage: canManageChannels })
        return (
          <ChatContextMenu
            x={channelMenu.x}
            y={channelMenu.y}
            title={channelMenu.channel ? `#${channelMenu.channel.name}` : 'Canais'}
            items={menu.items.map((item) => ({
              id: item.action,
              label: item.label,
              tone: item.tone,
              disabled: item.disabled,
              icon: CHANNEL_ACTION_ICONS[item.action],
            }))}
            note={menu.note}
            onSelect={(action) => runChannelAction(channelMenu.channel, action as ChannelAction)}
            onClose={closeChannelMenu}
          />
        )
      })()}

      <ConfirmModal
        isOpen={!!channelToDelete}
        title={`Excluir #${channelToDelete?.name || ''}?`}
        message="O canal e as mensagens dele somem para todos neste espaço."
        confirmText="Excluir canal"
        cancelText="Cancelar"
        variant="danger"
        icon="alert"
        onConfirm={() => {
          if (channelToDelete) deleteRoomChannel(channelToDelete.id)
          setChannelToDelete(null)
        }}
        onCancel={() => setChannelToDelete(null)}
      />

      <ConfirmModal
        isOpen={!!roomToJoin}
        title="Trocar de espaço?"
        message={`Você sai deste espaço, suas chamadas são encerradas e você entra em ${roomToJoin?.name || 'outro espaço'}.`}
        confirmText="Sair e entrar"
        cancelText="Ficar aqui"
        variant="primary"
        icon="logout"
        onConfirm={() => {
          if (roomToJoin) useRoomJoinStore.getState().requestJoin(roomToJoin.code)
          setRoomToJoin(null)
        }}
        onCancel={() => setRoomToJoin(null)}
      />
    </div>
  )
}
