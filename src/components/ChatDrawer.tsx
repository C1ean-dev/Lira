import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
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
  AlertCircle,
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

const DEFAULT_CHANNELS_WIDTH = 240
const MIN_CHANNELS_WIDTH = 160

const CHANNELS_STORAGE_KEY = 'lira_chat_channels_width'
import { useChatStore, getLocalDmChannelId } from '../store/useChatStore'
import { useGameStore } from '../store/useGameStore'
import { useLocalPlayerDetails, useRemotePlayerDetails } from '../hooks/usePlayerDetails'
import { useMediaStore } from '../store/useMediaStore'
import { PeerManager } from '../p2p/PeerManager'
import { FriendsPresenceService } from '../services/friendsPresenceService'
import { Channel, ChatMessage, ChatAttachment, ChatMention } from '../types/chat'
import { FriendRequestCard } from './chat/FriendRequestCard'
import { PlayerAvatar } from './common/PlayerAvatar'
import { buildProfileTargetFromFriend, buildProfileTargetFromPlayer, useProfileModalStore } from '../store/useProfileModalStore'
import { MessageStatusIcon } from './chat/MessageStatusIcon'
import { ChatUserContextMenu } from './chat/ChatUserContextMenu'
import { ChatPeopleList } from './chat/ChatPeopleList'
import { DmHeaderStatus } from './chat/DmHeaderStatus'
import { requestPetFromChat } from '../services/petNetwork'
import { prepareTtsCommand } from '../services/callTtsCore'
import { sendCallTts } from '../services/callTts'
import { MentionSuggestions } from './chat/MentionSuggestions'
import { findMentionQuery, insertMention, updateMentions, prepareMentionMessage, mentionSegments, type MentionCandidate } from '../utils/chatMentions'
import { linkifyText } from '../utils/chatLinks'
import { copyChatMessage, isImageAttachment } from '../utils/chatClipboard'
import { buildMentionCandidates } from '../utils/mentionCandidates'
import { ChatChannelList, ChannelEditing } from './chat/ChatChannelList'
import { SpotifyIcon } from './common/SpotifyIcon'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { toSpotifyDeepLink } from '../types/spotifyJam'
import { MediaManager } from '../media/MediaManager'
import { ChatContextMenu } from './chat/ChatContextMenu'
import { RoomInviteCard } from './chat/RoomInviteCard'
import { ConfirmModal } from './ConfirmModal'
import { getPlayerUserId, findFriendKey, isSameParticipant } from '../utils/userId'
import { getChatUserFriendState } from '../utils/chatUserActions'
import { buildChatPeople, findActiveChatPerson, openChatPerson, ChatPerson } from '../utils/chatPeople'
import { ChatPersonAction, getChatPersonMenu } from '../utils/chatPersonMenu'
import { ChannelAction, getChannelMenu } from '../utils/roomChannels'
import { getRoomInviteState, readRoomInvite } from '../utils/roomInvite'
import { goToPlayer } from '../utils/goToPlayer'
import { createRoomChannel, deleteRoomChannel, renameRoomChannel } from '../services/roomChannelsService'
import { useRoomJoinStore } from '../store/useRoomJoinStore'
import { useChatPagination } from '../hooks/useChatPagination'
import {
  aggregatePeersSecurity,
  resolvePeerSecurity,
  useSecurityStore,
  type PeerSecurityStatus,
} from '../store/useSecurityStore'
import { SecurityBadge } from './security/SecurityBadge'

const MENU_ICON = 'w-4 h-4 shrink-0'

function renderChatContent(content: string, mentions?: ChatMention[]): React.ReactNode {
  if (!content) return null
  const segments = mentionSegments(content, mentions)
  return segments.map((part, index) => {
    if (part.mention) {
      return (
        <span key={index} className="bg-lira-amber/15 text-lira-amber font-mono font-semibold rounded px-1">
          {part.text}
        </span>
      )
    }
    return <React.Fragment key={index}>{linkifyText(part.text)}</React.Fragment>
  })
}

const PERSON_ACTION_ICONS: Record<ChatPersonAction, React.ReactNode> = {
  message: <MessageSquare className={`${MENU_ICON} text-lira-accent`} />,
  goto: <Compass className={`${MENU_ICON} text-lira-accent`} />,
  invite: <DoorOpen className={`${MENU_ICON} text-lira-online`} />,
  join: <LogIn className={`${MENU_ICON} text-lira-online`} />,
  'add-friend': <UserPlus className={`${MENU_ICON} text-lira-accent`} />,
  'remove-friend': <UserMinus className={`${MENU_ICON} text-lira-error`} />,
  'close-conversation': <X className={`${MENU_ICON} text-lira-muted`} />,
  'copy-name': <Copy className={`${MENU_ICON} text-lira-muted`} />,
}

const CHANNEL_ACTION_ICONS: Record<ChannelAction, React.ReactNode> = {
  'mark-read': <CheckCheck className={`${MENU_ICON} text-lira-muted`} />,
  rename: <Pencil className={`${MENU_ICON} text-lira-accent`} />,
  delete: <Trash2 className={`${MENU_ICON} text-lira-error`} />,
  create: <Plus className={`${MENU_ICON} text-lira-online`} />,
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
    <div className="mt-2 p-2 bg-lira-ground rounded-lg border border-dashed border-lira-online/50 flex items-center justify-between gap-2 font-mono">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-6 h-6 rounded bg-lira-online/15 text-lira-online flex items-center justify-center shrink-0">
          <SpotifyIcon size={14} className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-display font-bold text-lira-ink truncate">
            {isJam ? 'Spotify Jam' : 'Spotify Music Link'}
          </div>
          <div className="text-[9px] text-lira-online font-mono truncate max-w-[200px]">
            {url}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={handleOpen}
          className="px-2 py-1 bg-lira-online hover:bg-lira-ink text-lira-ground rounded text-[10px] font-bold flex items-center gap-1 transition-colors"
          title="Abrir no Spotify App ou Navegador"
        >
          <SpotifyIcon size={10} className="w-2.5 h-2.5" />
          <span>Ouvir</span>
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="p-1 text-lira-muted hover:text-lira-ink bg-lira-surface border border-lira-quiet rounded text-[10px] transition-colors"
          title="Copiar Link"
        >
          {copied ? <CheckCheck className="w-3 h-3 text-lira-online" /> : <Copy className="w-3 h-3" />}
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
    roomSendNotices,
    dmHistoryNotice,
  } = useChatStore()

  const localPlayer = useLocalPlayerDetails()
  const remoteDetails = useRemotePlayerDetails()
  const remotePlayers = useMemo(() => Object.fromEntries(remoteDetails.map((peer) => [peer.id, peer])), [remoteDetails])
  const friends = useGameStore((s) => s.friends)
  const friendProfiles = useGameStore((s) => s.friendProfiles)
  const roomId = useGameStore((s) => s.roomId)
  const isOwner = useGameStore((s) => s.isOwner)
  const removeFriend = useGameStore((s) => s.removeFriend)
  const isGridCallOpen = useMediaStore((s) => s.isGridCallOpen)
  const securityPeers = useSecurityStore((s) => s.peers)
  const openSecurityInspection = useSecurityStore((s) => s.openInspection)

  const [inputMessage, setInputMessage] = useState('')
  const [selectedMentions, setSelectedMentions] = useState<ChatMention[]>([])
  const [mentionQuery, setMentionQuery] = useState<ReturnType<typeof findMentionQuery>>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const messageInputRef = useRef<HTMLInputElement>(null)
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

  const [isResizingChannels, setIsResizingChannels] = useState(false)

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640)
  const [mobileTab, setMobileTab] = useState<'chat' | 'channels'>('chat')

  const drawerRef = useRef<HTMLDivElement>(null)
  const channelsWidthRef = useRef(channelsWidth)
  channelsWidthRef.current = channelsWidth

  const getRailOffset = useCallback(() => {
    const left = drawerRef.current?.getBoundingClientRect().left
    if (typeof left === 'number' && left > 0) return left
    return typeof window !== 'undefined' && window.innerWidth < 640 ? 56 : 68
  }, [])

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640)
      const maxChannelsW = Math.min(400, Math.max(MIN_CHANNELS_WIDTH, window.innerWidth - getRailOffset() - 280))
      setChannelsWidth((prev) => (prev > maxChannelsW ? maxChannelsW : prev))
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [getRailOffset])

  useEffect(() => {
    if (isResizingChannels) {
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
  }, [isResizingChannels])

  const handleChannelsResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingChannels(true)

    const onPointerMove = (moveEv: PointerEvent) => {
      const railOffset = getRailOffset()
      const maxW = Math.min(400, Math.max(MIN_CHANNELS_WIDTH, window.innerWidth - railOffset - 280))
      const nextWidth = Math.min(maxW, Math.max(MIN_CHANNELS_WIDTH, moveEv.clientX - railOffset))
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
  }, [getRailOffset])

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const activeChannel = channels.find((c) => c.id === activeChannelId) || channels[0]
  const mentionCandidates = buildMentionCandidates(localPlayer, remoteDetails, activeChannel)
  const mentionSuggestions = mentionQuery
    ? mentionCandidates.filter(candidate => candidate.name.toLocaleLowerCase().includes(mentionQuery.query.trim().toLocaleLowerCase())).slice(0, 10)
    : []
  const chooseMention = (candidate: MentionCandidate) => {
    if (!mentionQuery) return
    const result = insertMention(inputMessage, mentionQuery, candidate, selectedMentions)
    setInputMessage(result.text)
    setSelectedMentions(result.mentions)
    setMentionQuery(null)
    setMentionIndex(0)
    setTimeout(() => { messageInputRef.current?.focus(); messageInputRef.current?.setSelectionRange(result.caret, result.caret) }, 0)
  }
  const filteredMessages = messages.filter((m) => {
    if (activeChannel?.type === 'zone') {
      if (!localPlayer.currentZoneId) return false
      return m.channelId === activeChannelId && (!m.zoneId || m.zoneId === localPlayer.currentZoneId)
    }
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
  const pagination = useChatPagination(filteredMessages, `${roomId}:${activeChannelId}`)
  const people = buildChatPeople({
    remotePlayers: Object.values(remotePlayers),
    friends,
    friendProfiles,
    channels,
    activeChannelId,
    dmChannelIdFor: getLocalDmChannelId,
    getFriendPresence: (friend) => FriendsPresenceService.getInstance().getFriendStatus(friend),
  })
  const activeDmPerson = findActiveChatPerson(people, activeChannel)

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
        if (person.playerId && goToPlayer(person.playerId) !== 'missing') {
          setChatOpen(false)
        }
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

    const prepared = prepareMentionMessage(inputMessage, mentionCandidates, selectedMentions, activeChannel?.type !== 'dm')
    const trimmedInput = prepared.text
    const lowerInput = trimmedInput.toLowerCase()
    const isDm = activeChannel?.type === 'dm'

    const tts = prepareTtsCommand(trimmedInput, localPlayer.currentZoneId, isDm)
    if (tts) {
      if ('error' in tts) {
        addMessage({ id: 'tts-error-' + Math.random().toString(36).slice(2), senderId: 'system', senderName: 'TTS', channelId: activeChannelId, content: tts.error, timestamp: Date.now() })
      } else if (sendCallTts(tts.text)) {
        const newMsg: ChatMessage = { id: 'tts-chat-' + Math.random().toString(36).slice(2), senderId: localPlayer.id, senderName: localPlayer.name, channelId: activeChannelId, content: `🔊 ${tts.text}`, timestamp: Date.now(), avatarConfig: localPlayer.avatar, status: 'sent' }
        addMessage(newMsg)
        PeerManager.getInstance().sendChatMessage(newMsg)
      }
      setInputMessage('')
      setSelectedMentions([])
      setMentionQuery(null)
      return
    }

    const sendChatMessageWithContent = (text: string) => {
      if (activeChannel?.type === 'zone' && !localPlayer.currentZoneId) return
      const newMsg: ChatMessage = {
        id: 'msg-' + Math.random().toString(36).substring(2, 9),
        senderId: isDm ? getPlayerUserId(localPlayer) : localPlayer.id,
        senderName: localPlayer.name,
        channelId: activeChannelId,
        content: text,
        timestamp: Date.now(),
        avatarConfig: localPlayer.avatar,
        recipientId: isDm ? activeChannel.recipientId : undefined,
        ...(activeChannel?.type === 'zone' && localPlayer.currentZoneId
          ? { zoneId: localPlayer.currentZoneId }
          : {}),
        status: 'sent',
      }
      addMessage(newMsg)
      PeerManager.getInstance().sendChatMessage(newMsg)
      if (isDm) {
        FriendsPresenceService.getInstance().sendDirectMessage(newMsg)
      }
    }

    if (lowerInput.startsWith('/spotify') || lowerInput.startsWith('/musica')) {
      setSelectedMentions([])
      setMentionQuery(null)
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

    if (activeChannel?.type === 'zone' && !localPlayer.currentZoneId) {
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
      ...(activeChannel?.type === 'zone' && localPlayer.currentZoneId
        ? { zoneId: localPlayer.currentZoneId }
        : {}),
      status: 'sent',
      mentions: prepared.mentions.length ? prepared.mentions : undefined,
    }

    addMessage(newMsg)
    PeerManager.getInstance().sendChatMessage(newMsg)
    if (isDm) {
      FriendsPresenceService.getInstance().sendDirectMessage(newMsg)
    }
    for (const pet of prepared.petRequests) requestPetFromChat(pet.id, pet.question, activeChannelId)
    setInputMessage('')
    setSelectedMentions([])
    setMentionQuery(null)
    setPendingAttachment(null)
    setUploadError(null)
  }

  const handleReact = (msgId: string, emoji: string) => {
    addReactionToMessage(msgId, emoji, localPlayer.id)
  }

  return (
    <div
      ref={drawerRef}
      onDragOver={(e) => {
        if (isResizingChannels) return
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
      className="fixed left-[var(--rail-width)] right-0 top-0 bottom-0 z-[70] bg-lira-panel flex flex-col font-mono"
    >
      {!isMobile && isResizingChannels && (
        <div className="fixed inset-0 z-[9999] cursor-col-resize select-none bg-transparent" />
      )}

      {isDragging && (
        <div className="absolute inset-0 z-50 bg-lira-ground/90 border-2 border-dashed border-lira-accent flex flex-col items-center justify-center gap-2 text-lira-ink pointer-events-none font-mono">
          <Paperclip className="w-10 h-10 text-lira-accent animate-bounce" />
          <span className="font-display font-bold text-base text-lira-accent">Solte o arquivo para anexar ao chat</span>
          <span className="text-xs text-lira-muted">Imagens, PDFs, documentos até 15MB</span>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-3 border-b border-dashed border-lira-rule/60 bg-lira-sidebar shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-lira-accent" />
          <span className="font-display font-bold text-base text-lira-accent">Chat & Canais</span>
        </div>

        {isMobile && (
          <div className="flex gap-1 bg-lira-ground p-0.5 rounded-lg border border-lira-rule">
            <button
              onClick={() => setMobileTab('channels')}
              className={`px-2.5 py-1 text-xs font-bold rounded transition-colors ${
                mobileTab === 'channels'
                  ? 'bg-lira-accent text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink'
              }`}
            >
              Canais
            </button>
            <button
              onClick={() => setMobileTab('chat')}
              className={`px-2.5 py-1 text-xs font-bold rounded transition-colors flex items-center gap-1 ${
                mobileTab === 'chat'
                  ? 'bg-lira-accent text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink'
              }`}
            >
              <span>Chat</span>
              <span className="text-[10px] opacity-80 max-w-[65px] truncate font-normal">
                ({activeChannel.name})
              </span>
            </button>
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            onClick={() => setChatOpen(false)}
            className="p-1.5 rounded-lg text-lira-muted hover:text-lira-ink hover:bg-lira-surface transition-colors"
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
          } bg-lira-sidebar border-r border-lira-quiet flex-col p-2 space-y-4 overflow-y-auto relative ${
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
              isResizingChannels ? 'bg-lira-accent/30' : 'hover:bg-lira-accent/20'
            }`}
            title="Arraste para redimensionar canais (duplo clique para restaurar 240px)"
          >
            <div
              className={`w-0.5 rounded-full transition-all duration-150 ${
                isResizingChannels
                  ? 'h-10 bg-lira-accent'
                  : 'h-6 bg-transparent group-hover:bg-lira-accent/80 group-hover:h-8'
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
          } flex-col bg-lira-panel overflow-hidden`}
        >
          <div className="px-3 py-2 border-b border-dashed border-lira-rule/60 flex items-center justify-between gap-2 bg-lira-sidebar shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setMobileTab('channels')}
                  className="px-2 py-0.5 rounded bg-lira-surface text-lira-accent border border-lira-rule text-[10px] font-bold flex items-center gap-1 mr-1 shrink-0"
                >
                  ← Canais
                </button>
              )}
              {activeChannel.type === 'dm' ? (
                <div className="w-4 h-4 rounded-[4px] bg-lira-surface border border-lira-rule flex items-center justify-center text-[10px] font-bold text-lira-accent shrink-0">
                  @
                </div>
              ) : activeChannel.type === 'zone' ? (
                <Lock className="w-4 h-4 text-lira-online shrink-0" />
              ) : (
                <Hash className="w-4 h-4 text-lira-muted shrink-0" />
              )}
              <span className="text-xs font-display font-bold text-lira-ink truncate">{activeChannel.name}</span>
            </div>
            {activeChannel.type === 'dm' ? (() => {
              const dmCandidateIds = [
                activeChannel.recipientId,
                activeDmPerson?.contactId,
                activeDmPerson?.playerId,
                activeDmPerson?.friendKey,
              ].filter((id): id is string => Boolean(id))
              const dmPeerSec = resolvePeerSecurity(securityPeers, dmCandidateIds)
              const matchedFriendKey = findFriendKey(friends, friendProfiles, dmCandidateIds)
              const matchedFriend = matchedFriendKey ? friendProfiles[matchedFriendKey] : undefined
              const dmSecStatus: PeerSecurityStatus = dmPeerSec
                ? dmPeerSec.status === 'encrypted' && matchedFriend?.identityKeyVerified
                  ? 'verified'
                  : dmPeerSec.status
                : matchedFriend?.identityKeyVerified
                ? 'verified'
                : matchedFriend?.identityKey
                ? 'encrypted'
                : 'pending'
              const inspectPeerId =
                dmPeerSec?.peerId ||
                activeChannel.recipientId ||
                activeDmPerson?.contactId ||
                activeDmPerson?.playerId ||
                activeChannel.name

              return (
                <div className="flex items-center gap-1.5 shrink-0 min-w-0">
                  <SecurityBadge
                    compact
                    status={dmSecStatus}
                    onClick={() =>
                      openSecurityInspection({
                        peerId: inspectPeerId,
                        displayName: activeChannel.name,
                        candidateIds: dmCandidateIds,
                      })
                    }
                  />
                  <DmHeaderStatus person={activeDmPerson} fallbackName={activeChannel.name} />
                </div>
              )
            })() : (() => {
              const roomPeerList = Object.values(remotePlayers)
                .filter((p) => !p.isDjBot && !p.id.startsWith('dj-'))
                .map((p) => ({ id: p.id, gameId: p.gameId, name: p.name }))
              const roomSec = aggregatePeersSecurity(securityPeers, roomPeerList)
              return (
                <div className="flex items-center gap-2 min-w-0 max-w-[60%]">
                  <span className="text-[10px] text-lira-muted truncate">
                    {activeChannel.description}
                  </span>
                  <SecurityBadge
                    compact
                    status={roomSec.status}
                    mediaEncrypted={roomSec.mediaEncryptedCount > 0}
                    onClick={() =>
                      openSecurityInspection(
                        roomSec.primaryPeer ?? {
                          peerId: localPlayer.id,
                          displayName: activeChannel.name,
                        }
                      )
                    }
                  />
                </div>
              )
            })()}
          </div>

          <div ref={pagination.messagesRef} onScroll={pagination.onScroll} onWheel={pagination.onWheel} onTouchStart={pagination.onTouchStart} onTouchMove={pagination.onTouchMove} className="flex-1 min-h-0 p-3 overflow-y-auto">
            <div ref={pagination.contentRef} className="space-y-3">
            {filteredMessages.length === 0 ? (
              <div className="text-center text-xs text-lira-muted py-8 px-4 m-2 rounded-xl border border-dashed border-lira-rule/60 bg-lira-ground/40 space-y-1">
                <div className="font-display font-bold text-sm text-lira-accent">
                  {activeChannel.type === 'dm'
                    ? `Conversa direta com ${activeChannel.name}`
                    : 'Nenhuma mensagem enviada ainda.'}
                </div>
                <div className="text-[11px] text-lira-muted">
                  {activeChannel.type === 'dm'
                    ? 'Envie uma mensagem ou arquivo para iniciar o papo!'
                    : 'Envie uma mensagem ou arquivo para todos no canal!'}
                </div>
              </div>
            ) : (() => {
              const seenRequestIds = new Set<string>()
              let seenAcceptedFriendCard = false

              return pagination.page.messages.map((msg) => {
                const isMine =
                  msg.senderId === localPlayer.id ||
                  (localPlayer.gameId && msg.senderId === localPlayer.gameId)
                const hasAttachment = !!msg.attachment
                const isImage = hasAttachment && isImageAttachment(msg.attachment!)
                const notice = isMine && (!msg.recipientId || !msg.status || msg.status === 'sent')
                  ? roomSendNotices[msg.id] : undefined
                const deliveryNotice = notice && (
                  <span className="text-xs text-lira-amber" role="status">
                    {notice.text}{' '}
                    {notice.retry && (
                      <button type="button" className="underline" onClick={() => PeerManager.getInstance().sendChatMessage(msg)}>
                        Tentar de novo
                      </button>
                    )}
                  </span>
                )

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
                      <div key={msg.id} onContextMenu={(e) => openUserMenu(e, msg)} className="group relative flex flex-col space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className={`text-xs font-semibold ${isMine ? 'text-lira-accent' : 'text-lira-ink'}`}>
                            {msg.senderName}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] font-mono text-lira-muted">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {deliveryNotice || (isMine && <MessageStatusIcon status={msg.status} />)}
                          </div>
                        </div>
                        <div className="text-xs text-lira-ink bg-lira-surface/60 p-2.5 rounded-lg border border-lira-quiet break-words">
                          {renderChatContent(msg.content)}
                        </div>
                      </div>
                    )
                  }
                  seenRequestIds.add(rId)
                  if (isAccepted) {
                    seenAcceptedFriendCard = true
                  }

                  return (
                    <div key={msg.id} onContextMenu={(e) => openUserMenu(e, msg)} className="group relative flex flex-col space-y-1">
                      <div className="flex items-baseline justify-between">
                        <span className={`text-xs font-semibold ${isMine ? 'text-lira-accent' : 'text-lira-ink'}`}>
                          {msg.senderName}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] font-mono text-lira-muted">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {deliveryNotice || (isMine && <MessageStatusIcon status={msg.status} />)}
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
                        <span className={`text-xs font-semibold ${isMine ? 'text-lira-accent' : 'text-lira-ink'}`}>
                          {msg.senderName}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] font-mono text-lira-muted">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {deliveryNotice || (isMine && <MessageStatusIcon status={msg.status} />)}
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

                const senderRemote = isMine
                  ? undefined
                  : remotePlayers[msg.senderId] ||
                    Object.values(remotePlayers).find((p) => p.gameId === msg.senderId) ||
                    Object.values(remotePlayers).find((p) => p.name === msg.senderName)
                const senderFriend =
                  !isMine && !senderRemote
                    ? Object.values(friendProfiles).find(
                        (f) => f.id === msg.senderId || f.actualUserId === msg.senderId || f.name === msg.senderName
                      )
                    : undefined
                const senderEntity = isMine ? localPlayer : senderRemote || senderFriend

                const handleOpenSenderProfile = () => {
                  if (isMine) {
                    useProfileModalStore.getState().openLocalProfile('view')
                  } else if (senderRemote) {
                    useProfileModalStore.getState().openProfile(buildProfileTargetFromPlayer(senderRemote, false), 'view')
                  } else if (senderFriend) {
                    useProfileModalStore.getState().openProfile(buildProfileTargetFromFriend(senderFriend), 'view')
                  } else {
                    useProfileModalStore.getState().openProfile({ userId: msg.senderId, name: msg.senderName }, 'view')
                  }
                }

                return (
                  <div key={msg.id} onContextMenu={(e) => openUserMenu(e, msg)} className="group relative flex flex-col space-y-1">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={handleOpenSenderProfile}
                        className="flex items-center gap-2 min-w-0 text-left hover:underline"
                        title={`Ver perfil de ${msg.senderName}`}
                      >
                        <PlayerAvatar
                          player={senderEntity}
                          name={msg.senderName}
                          size="xs"
                          className="rounded-[6px]"
                        />
                        <span className={`text-xs font-semibold truncate ${isMine ? 'text-lira-accent' : 'text-lira-ink'}`}>
                          {msg.senderName}
                        </span>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {msg.encrypted && (
                          <span
                            title="Mensagem criptografada ponta a ponta (E2EE)"
                            className="inline-flex items-center text-lira-online/80"
                          >
                            <Lock className="w-2.5 h-2.5" />
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-lira-muted">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {deliveryNotice || (isMine && <MessageStatusIcon status={msg.status} />)}
                      </div>
                    </div>

                    <div className="text-xs text-lira-ink bg-lira-surface/60 p-2.5 rounded-lg border border-lira-quiet break-words space-y-2">
                      {msg.content && (
                        <div>
                          <div className="whitespace-pre-wrap">{renderChatContent(msg.content, msg.mentions)}</div>
                          {extractSpotifyLink(msg.content) && (
                            <SpotifyChatCard url={extractSpotifyLink(msg.content)!} />
                          )}
                        </div>
                      )}

                      {hasAttachment && msg.attachment && (
                        <div>
                          {isImage ? (
                            <div className="relative group/img rounded-lg overflow-hidden border border-lira-quiet bg-lira-ground max-w-[280px]">
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
                                  className="p-1 rounded bg-lira-ground/90 hover:bg-lira-surface text-lira-ink border border-lira-rule"
                                  title="Expandir imagem"
                                >
                                  <Maximize2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copyChatMessage(msg).catch(() => {})}
                                  className="p-1 rounded bg-lira-ground/90 hover:bg-lira-surface text-lira-ink border border-lira-rule"
                                  title="Copiar imagem"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => downloadAttachment(msg.attachment!)}
                                  className="p-1 rounded bg-lira-ground/90 hover:bg-lira-surface text-lira-ink border border-lira-rule"
                                  title="Baixar imagem"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <div className="px-2 py-1 bg-lira-ground text-[10px] text-lira-muted truncate border-t border-lira-quiet">
                                {msg.attachment.name} • {formatFileSize(msg.attachment.size)}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between p-2 bg-lira-ground hover:bg-lira-surface border border-lira-quiet rounded-lg gap-2.5 transition-colors group/file">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-8 h-8 rounded bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent shrink-0">
                                  <FileText className="w-4 h-4" />
                                </div>
                                <div className="overflow-hidden">
                                  <div className="text-xs font-semibold text-lira-ink truncate max-w-[150px] group-hover/file:text-lira-accent transition-colors">
                                    {msg.attachment.name}
                                  </div>
                                  <div className="text-[10px] text-lira-muted">
                                    {formatFileSize(msg.attachment.size)}
                                  </div>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => downloadAttachment(msg.attachment!)}
                                className="px-2.5 py-1.5 bg-lira-accent hover:bg-lira-ink text-lira-ground text-[11px] font-bold rounded flex items-center gap-1.5 transition-colors shrink-0"
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
                            className={`text-[11px] px-1.5 py-0.5 rounded border flex items-center gap-1 font-mono ${
                              users.includes(localPlayer.id)
                                ? 'bg-lira-surface border-lira-accent text-lira-accent'
                                : 'bg-lira-ground border-lira-quiet text-lira-muted'
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
            </div>
          </div>

          <form onSubmit={handleSendMessage} className="p-3 border-t border-dashed border-lira-rule/60 bg-lira-sidebar shrink-0">
            <MentionSuggestions candidates={mentionSuggestions} selectedIndex={mentionIndex} onSelect={chooseMention} />
            {isDmOpen && dmHistoryNotice && (
              <p role="status" className="px-2 py-1 text-xs text-lira-amber">{dmHistoryNotice}</p>
            )}
            {uploadError && (
              <div className="mb-2 px-2.5 py-1.5 bg-lira-error/15 border border-lira-error/40 rounded-lg flex items-center justify-between text-xs text-lira-error">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-lira-error shrink-0" />
                  <span>{uploadError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setUploadError(null)}
                  className="text-lira-error hover:text-lira-ink"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {pendingAttachment && (
              <div className="mb-2 p-2 bg-lira-surface border border-dashed border-lira-rule rounded-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 overflow-hidden">
                  {isImageAttachment(pendingAttachment) ? (
                    <img
                      src={pendingAttachment.dataUrl}
                      alt={pendingAttachment.name}
                      className="w-9 h-9 object-cover rounded border border-lira-quiet shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 bg-lira-ground border border-lira-rule rounded flex items-center justify-center text-lira-accent shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                  )}
                  <div className="overflow-hidden">
                    <div className="text-xs font-semibold text-lira-ink truncate max-w-[200px]">
                      {pendingAttachment.name}
                    </div>
                    <div className="text-[10px] text-lira-muted">
                      {formatFileSize(pendingAttachment.size)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingAttachment(null)}
                  className="p-1.5 rounded-lg text-lira-muted hover:text-lira-error hover:bg-lira-error/15 transition-colors"
                  title="Remover anexo"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 bg-lira-ground border border-lira-rule rounded-lg px-2.5 py-1.5 focus-within:border-lira-accent transition-colors">
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
                className="p-1 rounded text-lira-muted hover:text-lira-accent hover:bg-lira-surface transition-colors"
                title="Anexar arquivo ou imagem (até 15MB)"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <input
                type="text"
                ref={messageInputRef}
                value={inputMessage}
                aria-autocomplete="list"
                aria-controls={mentionSuggestions.length ? 'chat-mention-suggestions' : undefined}
                onChange={(e) => {
                  const value = e.target.value
                  setSelectedMentions(updateMentions(inputMessage, value, selectedMentions))
                  setInputMessage(value)
                  setMentionQuery(findMentionQuery(value, e.target.selectionStart ?? value.length))
                  setMentionIndex(0)
                }}
                onClick={(e) => { setMentionQuery(findMentionQuery(inputMessage, e.currentTarget.selectionStart ?? inputMessage.length)); setMentionIndex(0) }}
                onKeyDown={(e) => {
                  if (!mentionSuggestions.length) return
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault()
                    setMentionIndex(index => (index + (e.key === 'ArrowDown' ? 1 : -1) + mentionSuggestions.length) % mentionSuggestions.length)
                  } else if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    chooseMention(mentionSuggestions[Math.min(mentionIndex, mentionSuggestions.length - 1)])
                  } else if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null) }
                }}
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
                className="flex-1 bg-transparent text-xs font-mono text-lira-ink placeholder-lira-muted/60 focus:outline-none"
              />

              <button
                type="submit"
                disabled={!inputMessage.trim() && !pendingAttachment}
                className="p-1.5 rounded text-lira-accent hover:text-lira-ink hover:bg-lira-surface disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
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
          className="fixed inset-0 z-[120] bg-lira-ground/90 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[88vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-full flex items-center justify-between text-lira-ink mb-2 px-2">
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
                  className="px-3 py-1.5 rounded-lg bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-ink transition-colors flex items-center gap-1.5 text-xs font-medium"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    copyChatMessage({
                      attachment: {
                        id: '',
                        name: lightboxImage.name,
                        size: 0,
                        type: 'image/png',
                        dataUrl: lightboxImage.url,
                      },
                    }).catch(() => {})
                  }
                  className="px-3 py-1.5 rounded-lg bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-ink transition-colors flex items-center gap-1.5 text-xs font-medium"
                  title="Copiar imagem"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  className="p-1.5 rounded-lg bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-ink transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.name}
              className="max-w-full max-h-[78vh] object-contain rounded-xl border border-dashed border-lira-rule"
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
            onViewProfile={() => {
              if (state === 'self') {
                useProfileModalStore.getState().openLocalProfile('view')
              } else {
                const remote =
                  remotePlayers[userMenu.msg.senderId] ||
                  Object.values(remotePlayers).find(
                    (p) => p.gameId === target.id || p.id === target.id || p.name === target.name
                  )
                const fp = friendKey ? friendProfiles[friendKey] : undefined
                if (remote) {
                  useProfileModalStore.getState().openProfile(buildProfileTargetFromPlayer(remote, false), 'view')
                } else if (fp) {
                  useProfileModalStore.getState().openProfile(buildProfileTargetFromFriend(fp), 'view')
                } else {
                  useProfileModalStore.getState().openProfile({ userId: target.id, name: target.name, avatar: target.avatar }, 'view')
                }
              }
            }}
            onAddFriend={() => sendFriendRequest(target)}
            onRemoveFriend={() => friendKey && useGameStore.getState().removeFriend(friendKey)}
            onCopyContent={() => {
              copyChatMessage(userMenu.msg).catch(() => {})
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
