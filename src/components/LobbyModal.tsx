import React, { useState, useEffect, useMemo, useRef } from 'react'
import { DoorOpen, Globe, LayoutGrid, Users, MessageSquare, Download, RefreshCw } from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useChatStore } from '../store/useChatStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { useSavedSpacesStore } from '../store/useSavedSpacesStore'
import { PeerManager } from '../p2p/PeerManager'
import { MediaManager } from '../media/MediaManager'
import { createEmptyWorkspace } from '../editor/templates'
import { PublicRoomsService } from '../services/publicRoomsService'
import { FriendsPresenceService } from '../services/friendsPresenceService'
import { PublicRoomInfo, Player, FriendProfile } from '../types/game'
import { SavedSpace } from '../store/useSavedSpacesStore'
import { diagLog } from '../utils/diagnosticLogger'
import { createEnterGuard } from '../utils/enterGuard'
import { DirectConnectTab } from './lobby/DirectConnectTab'
import { PublicRoomsTab } from './lobby/PublicRoomsTab'
import { SavedSpacesTab } from './lobby/SavedSpacesTab'
import { FriendsTab } from './lobby/FriendsTab'
import { LobbyChatModal } from './lobby/LobbyChatModal'
import { LiraLogo } from './LiraLogo'
import { useUpdateStore } from '../store/useUpdateStore'
import { CURRENT_APP_VERSION } from '../services/updateService'

interface Props {
  onJoined: () => void
  onOpenAvatarCustomizer: () => void
  onApplyUpdate?: () => void
  hasUpdate?: boolean
  isUpdateReady?: boolean
  isUpdating?: boolean
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export const LobbyModal: React.FC<Props> = ({
  onJoined,
  onOpenAvatarCustomizer,
  onApplyUpdate,
  hasUpdate: hasUpdateProp,
  isUpdateReady,
  isUpdating,
}) => {
  const updateInfo = useUpdateStore((s) => s.updateInfo)
  const hasUpdate = hasUpdateProp ?? !!updateInfo?.hasUpdate
  const rawVersion = updateInfo?.currentVersion || CURRENT_APP_VERSION
  const currentVersion = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`

  const { localPlayer, setLocalPlayer, friends, friendProfiles } = useGameStore()
  const {
    savedSpaces,
    activeSpaceId,
    setActiveSpaceId,
    createSavedSpace,
    updateSavedSpace,
    deleteSavedSpace,
    duplicateSavedSpace,
  } = useSavedSpacesStore()

  const [activeTab, setActiveTab] = useState<'connect' | 'available_rooms' | 'friends' | 'saved_rooms'>('connect')
  const [userName, setUserName] = useState(localPlayer.name || '')
  const [roomInput, setRoomInput] = useState('')
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [createRoomName, setCreateRoomName] = useState(`Espaço de ${localPlayer.name || 'Trabalho'}`)
  const [createDescription, setCreateDescription] = useState('Espaço virtual e comunicação em tempo real')
  const [createIsPublic, setCreateIsPublic] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatFriend, setChatFriend] = useState<FriendProfile | null>(null)
  const [onlineFriendsCount, setOnlineFriendsCount] = useState(0)

  // Track online friends count in real time
  useEffect(() => {
    const updateOnlineCount = () => {
      const svc = FriendsPresenceService.getInstance()
      let count = 0
      friends.forEach((id) => {
        const p = friendProfiles[id] || { id, name: 'Amigo', lastSeen: 0 }
        if (svc.getFriendStatus(p).isOnline) {
          count++
        }
      })
      setOnlineFriendsCount(count)
    }

    updateOnlineCount()
    const unsub = FriendsPresenceService.getInstance().subscribe(updateOnlineCount)
    return () => unsub()
  }, [friends, friendProfiles])

  // Track total unread DMs for notification alert on Amigos tab
  const messages = useChatStore((s) => s.messages)
  const chatChannels = useChatStore((s) => s.channels)
  const lastReadByPeer = useChatStore((s) => s.lastReadByPeer)
  const getTotalUnreadDMs = useChatStore((s) => s.getTotalUnreadDMs)

  const totalUnreadDMs = useMemo(() => {
    return getTotalUnreadDMs()
  }, [messages, chatChannels, lastReadByPeer, friends, friendProfiles, getTotalUnreadDMs])

  // Real-time Toast notification for incoming direct messages in the lobby
  const [incomingToast, setIncomingToast] = useState<{
    friend: FriendProfile
    content: string
  } | null>(null)
  const prevMessagesCountRef = useRef(messages.length)

  useEffect(() => {
    if (messages.length > prevMessagesCountRef.current) {
      const newest = messages[messages.length - 1]
      const localId = localPlayer.id
      const localNameLower = (localPlayer.name || '').trim().toLowerCase()
      const isFromMe =
        newest.senderId === localId ||
        (localPlayer.gameId && newest.senderId === localPlayer.gameId) ||
        (localNameLower && (newest.senderName || '').trim().toLowerCase() === localNameLower)

      if (!isFromMe && (newest.channelId?.startsWith('dm-') || newest.recipientId)) {
        const senderNameLower = (newest.senderName || '').trim().toLowerCase()
        const matchedFriendId = friends.find((fid) => {
          const fp = friendProfiles[fid]
          return (
            fid === newest.senderId ||
            (fp?.actualUserId && fp.actualUserId === newest.senderId) ||
            (fp?.name && fp.name.trim().toLowerCase() === senderNameLower)
          )
        })

        if (matchedFriendId) {
          const profile = friendProfiles[matchedFriendId] || {
            id: matchedFriendId,
            name: newest.senderName,
            lastSeen: Date.now(),
          }
          if (chatFriend?.id !== profile.id && chatFriend?.actualUserId !== newest.senderId) {
            setIncomingToast({
              friend: profile,
              content: newest.content,
            })
          }
        }
      }
    }
    prevMessagesCountRef.current = messages.length
  }, [messages, localPlayer, friends, friendProfiles, chatFriend])

  useEffect(() => {
    if (incomingToast) {
      const timer = setTimeout(() => setIncomingToast(null), 6000)
      return () => clearTimeout(timer)
    }
  }, [incomingToast])

  // Selected space in saved rooms
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(activeSpaceId || savedSpaces[0]?.id || '')

  // Inline editing space name
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null)
  const [editingSpaceName, setEditingSpaceName] = useState('')

  // Public Rooms (Hub)
  const [publicRooms, setPublicRooms] = useState<PublicRoomInfo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [copiedRoomCode, setCopiedRoomCode] = useState<string | null>(null)

  // Re-entry guard: the saved-space card fires handleEnterSavedSpace on
  // double-click while the Entrar button only disables via `loading` state —
  // two concurrent runs create TWO host peers with the same id and destroy
  // each other ("entrar não vai"). One entry at a time, always.
  const enterGuardRef = useRef(createEnterGuard())

  useEffect(() => {
    if (activeTab === 'available_rooms') {
      const hub = PublicRoomsService.getInstance()
      setPublicRooms(hub.getRooms())
      hub.refresh()

      const interval = setInterval(() => {
        hub.refresh()
      }, 3000)
      return () => clearInterval(interval)
    }
  }, [activeTab])

  useEffect(() => {
    const unsubscribe = PublicRoomsService.getInstance().subscribe((rooms) => {
      setPublicRooms(rooms)
    })
    return () => unsubscribe()
  }, [])

  const handleManualRefresh = () => {
    setIsRefreshing(true)
    const hub = PublicRoomsService.getInstance()
    hub.refresh()
    setPublicRooms(hub.getRooms())
    setTimeout(() => setIsRefreshing(false), 500)
  }

  const filteredPublicRooms = useMemo(() => {
    let list = publicRooms
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.hostName.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          (r.description && r.description.toLowerCase().includes(q))
      )
    }
    return list.sort((a, b) => b.createdAt - a.createdAt)
  }, [publicRooms, searchQuery])

  const handleCopyCode = (e: React.MouseEvent, code: string) => {
    e.stopPropagation()
    navigator.clipboard.writeText(code)
    setCopiedRoomCode(code)
    setTimeout(() => setCopiedRoomCode(null), 2000)
  }

  const handleJoinPublicRoom = async (room: PublicRoomInfo) => {
    if (!userName.trim()) {
      setError('Por favor, informe seu nickname antes de entrar na sala.')
      setActiveTab('connect')
      return
    }
    if (!enterGuardRef.current.tryEnter()) return

    setLoading(true)
    setError(null)

    try {
      setLocalPlayer({ name: userName.trim() })
      // Parallel: mic/camera warm-up must NOT block the P2P handshake.
      // MediaManager.startMedia re-triggers zone-call eligibility when the
      // stream lands, so calls missed while the mic was initializing heal.
      await Promise.all([
        MediaManager.getInstance().startMedia(true, true),
        PeerManager.getInstance().joinRoom(room.code, {
          ...localPlayer,
          name: userName.trim(),
        }),
      ])
      onJoined()
    } catch (err: any) {
      console.error(err)
      setError(`Não foi possível conectar à sala "${room.name}". O host pode ter fechado o app.`)
    } finally {
      enterGuardRef.current.release()
      setLoading(false)
    }
  }

  const handleJoinByCode = async (code: string) => {
    if (!userName.trim()) {
      setError('Por favor, informe seu nickname antes de entrar na sala.')
      setActiveTab('connect')
      return
    }
    if (!enterGuardRef.current.tryEnter()) return

    setLoading(true)
    setError(null)

    try {
      setLocalPlayer({ name: userName.trim() })
      await Promise.all([
        MediaManager.getInstance().startMedia(true, true),
        PeerManager.getInstance().joinRoom(code, {
          ...localPlayer,
          name: userName.trim(),
        }),
      ])
      onJoined()
    } catch (err: any) {
      console.error(err)
      setError(`Não foi possível conectar à sala (${code}). O host pode ter fechado o app.`)
    } finally {
      enterGuardRef.current.release()
      setLoading(false)
    }
  }

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userName.trim()) {
      setError('Por favor, informe seu nickname.')
      return
    }
    if (!enterGuardRef.current.tryEnter()) return

    setLoading(true)
    setError(null)

    try {
      setLocalPlayer({ name: userName.trim() })
      useMediaStore.getState().setMuted(true)
      useMediaStore.getState().setCameraOff(true)

      // Validate BEFORE touching hardware so a typo'd code doesn't pop a
      // mic-permission prompt for nothing.
      if (mode === 'join' && !roomInput.trim()) {
        setError('Por favor, insira o código da sala.')
        setLoading(false)
        return
      }

      // Warm up mic/camera in parallel with everything below — the P2P
      // handshake no longer waits for getUserMedia / RNNoise WASM init.
      const mediaReady = MediaManager.getInstance().startMedia(true, true)

      if (mode === 'create') {
        const roomTitle = createRoomName.trim() || `Espaço de ${userName.trim()}`
        const newMap = createEmptyWorkspace()
        newMap.id = 'room-' + Math.random().toString(36).substring(2, 8)
        newMap.name = roomTitle

        const persistentRoomCode = generateUUID()

        const createdSpace = createSavedSpace(
          roomTitle,
          newMap,
          createDescription.trim() || 'Espaço criado via Conectar',
          persistentRoomCode
        )

        setActiveSpaceId(createdSpace.id)
        setSelectedSpaceId(createdSpace.id)
        useMapStore.getState().setMapData(newMap)

        setLocalPlayer({
          name: userName.trim(),
          x: newMap.spawnPoint.x,
          y: newMap.spawnPoint.y,
          currentZoneId: null,
        })

        const randomColors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4']
        const color = randomColors[Math.floor(Math.random() * randomColors.length)]

        const playerPayload: Player = {
          ...useGameStore.getState().localPlayer,
          name: userName.trim(),
          x: newMap.spawnPoint.x,
          y: newMap.spawnPoint.y,
          currentZoneId: null,
        }

        await Promise.all([
          mediaReady,
          PeerManager.getInstance().createRoom(
            persistentRoomCode,
            playerPayload,
            {
              roomName: createdSpace.name,
              roomDescription: createDescription.trim() || 'Espaço virtual público aberto para todos',
              isPublic: createIsPublic,
              maxPlayers: 25,
              color,
            }
          ),
        ])
      } else {
        const playerPayload: Player = {
          ...useGameStore.getState().localPlayer,
          name: userName.trim(),
        }

        const matchingSpace = savedSpaces.find(
          (s) => s.roomCode?.toUpperCase() === roomInput.trim().toUpperCase()
        )
        if (matchingSpace) {
          useMapStore.getState().setMapData(matchingSpace.mapData)
          setActiveSpaceId(matchingSpace.id)
          setSelectedSpaceId(matchingSpace.id)
          const spawnX = matchingSpace.mapData.spawnPoint?.x ?? 34
          const spawnY = matchingSpace.mapData.spawnPoint?.y ?? 20
          playerPayload.x = spawnX
          playerPayload.y = spawnY
        }

        await Promise.all([
          mediaReady,
          PeerManager.getInstance().joinRoom(roomInput.trim(), playerPayload),
        ])
      }

      onJoined()
    } catch (err: any) {
      console.error(err)
      setError('Não foi possível conectar. Verifique o código da sala e tente novamente.')
    } finally {
      enterGuardRef.current.release()
      setLoading(false)
    }
  }

  const handleEnterSavedSpace = async (targetSpaceId?: string) => {
    if (!userName.trim()) {
      setError('Por favor, informe seu nickname.')
      setActiveTab('connect')
      return
    }
    // The card double-click bypasses the disabled Entrar button — without
    // this, two runs race creating the same host peer id.
    if (!enterGuardRef.current.tryEnter()) return

    const spaceId = targetSpaceId || selectedSpaceId
    const targetSpace = savedSpaces.find((s) => s.id === spaceId) || savedSpaces[0]
    if (!targetSpace) {
      enterGuardRef.current.release()
      setError('Nenhum espaço salvo encontrado.')
      return
    }

    setLoading(true)
    setError(null)
    diagLog('room', 'enter-begin', {
      spaceId: targetSpace.id,
      spaceName: targetSpace.name,
      hasCode: !!targetSpace.roomCode,
    })

    try {
      useMapStore.getState().setMapData(targetSpace.mapData)
      setActiveSpaceId(targetSpace.id)

      const spawnX = targetSpace.mapData.spawnPoint?.x ?? 34
      const spawnY = targetSpace.mapData.spawnPoint?.y ?? 20

      setLocalPlayer({
        name: userName.trim(),
        x: spawnX,
        y: spawnY,
        currentZoneId: null,
      })

      useMediaStore.getState().setMuted(true)
      useMediaStore.getState().setCameraOff(true)
      // Parallel with room creation (see handleStart) — P2P handshake must
      // not wait for mic/RNNoise init.
      const mediaReady = MediaManager.getInstance().startMedia(true, true)

      let persistentCode = targetSpace.roomCode
      if (!persistentCode) {
        persistentCode = generateUUID()
        updateSavedSpace(targetSpace.id, { roomCode: persistentCode })
      }

      const playerPayload: Player = {
        ...useGameStore.getState().localPlayer,
        name: userName.trim(),
        x: spawnX,
        y: spawnY,
        currentZoneId: null,
      }

      try {
        await Promise.all([
          mediaReady,
          PeerManager.getInstance().createRoom(
            persistentCode,
            playerPayload,
            {
              roomName: targetSpace.name,
              isPublic: true,
            }
          ),
        ])
        onJoined()
        diagLog('room', 'enter-ok', { spaceId: targetSpace.id })
      } catch (firstErr: any) {
        // If roomCode is locked on the P2P server by a lingering/ghost session from a previous process:
        console.warn(`[Lobby] Host ID for code ${persistentCode} is unavailable or timed out. Auto-regenerating fresh roomCode...`, firstErr)
        const freshCode = generateUUID()
        updateSavedSpace(targetSpace.id, { roomCode: freshCode })

        await Promise.all([
          mediaReady,
          PeerManager.getInstance().createRoom(
            freshCode,
            playerPayload,
            {
              roomName: targetSpace.name,
              isPublic: true,
            }
          ),
        ])
        onJoined()
        diagLog('room', 'enter-ok-retry', { spaceId: targetSpace.id, freshCode })
      }
    } catch (err: any) {
      console.error(err)
      diagLog('room', 'enter-fail', {
        spaceId: targetSpace.id,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
      setError(err instanceof Error ? err.message : 'Não foi possível carregar o espaço.')
    } finally {
      enterGuardRef.current.release()
      setLoading(false)
    }
  }

  const handleCreateNewSpace = () => {
    const defaultName = `Espaço #${savedSpaces.length + 1}`
    const newMap = createEmptyWorkspace()
    newMap.name = defaultName
    const persistentCode = generateUUID()
    const newSpace = createSavedSpace(
      defaultName,
      newMap,
      'Novo espaço de trabalho virtual',
      persistentCode
    )
    setSelectedSpaceId(newSpace.id)
    handleEnterSavedSpace(newSpace.id)
  }

  const handleStartEditingSpace = (space: SavedSpace) => {
    setEditingSpaceId(space.id)
    setEditingSpaceName(space.name)
  }

  const handleSaveEditingSpace = (spaceId: string) => {
    if (editingSpaceName.trim()) {
      updateSavedSpace(spaceId, { name: editingSpaceName.trim() })
    }
    setEditingSpaceId(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0c0e14]/90 backdrop-blur-xl p-4 select-none animate-in fade-in duration-300">
      <div className="bg-[#1b202c] border border-[#2a3142] rounded-3xl w-full max-w-2xl sm:max-w-[740px] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Banner Header */}
        <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 p-5 text-center relative overflow-hidden shrink-0">
          <div className="absolute -top-12 -right-12 w-36 h-36 rounded-full bg-white/10 blur-2xl" />
          {hasUpdate && onApplyUpdate ? (
            <button
              type="button"
              onClick={onApplyUpdate}
              disabled={isUpdating}
              className="absolute top-4 right-4 z-20 p-2.5 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-300 hover:text-white transition-all hover:scale-105 active:scale-95 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-75 disabled:pointer-events-none"
              title="Nova versão disponível! Clique para atualizar agora."
            >
              {isUpdating ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
            </button>
          ) : (
            <div
              className="absolute top-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 backdrop-blur-md border border-white/20 text-white/90 text-xs font-bold shadow-sm transition-all"
              title={`Versão atual do Lira: ${currentVersion}`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-mono">{currentVersion}</span>
            </div>
          )}
          <div className="relative z-10 flex flex-col items-center">
            <div className="mb-2">
              <LiraLogo size={52} />
            </div>
            <h1 className="text-xl font-extrabold text-white tracking-wider">LIRA</h1>
            <p className="text-xs text-indigo-100 max-w-sm mt-0.5">
              Escritório virtual colaborativo com salas em tempo real, áudio P2P e zonas privadas
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#2a3142] bg-[#12151d]/80 px-6 pt-3 gap-2.5 shrink-0 overflow-x-auto justify-start sm:justify-center">
          <button
            type="button"
            onClick={() => setActiveTab('connect')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeTab === 'connect'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <DoorOpen className="w-3.5 h-3.5" />
            <span>Conectar</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('available_rooms')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 shrink-0 whitespace-nowrap relative ${
              activeTab === 'available_rooms'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
            <span>Salas Disponíveis (Hub)</span>
            <span className="bg-blue-500/20 text-blue-300 text-[10px] px-1.5 py-0.2 rounded-full font-bold border border-blue-500/30 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              {publicRooms.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('friends')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 shrink-0 whitespace-nowrap relative ${
              activeTab === 'friends'
                ? 'border-indigo-500 text-indigo-400'
                : totalUnreadDMs > 0
                ? 'border-rose-500 text-rose-300 font-extrabold bg-rose-500/10 rounded-t-xl animate-pulse'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="relative flex items-center">
              <Users className={`w-3.5 h-3.5 ${totalUnreadDMs > 0 ? 'text-rose-400' : ''}`} />
              {totalUnreadDMs > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-[#12151d] animate-ping" />
              )}
            </div>
            <span>Amigos</span>
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] px-1.5 py-0.2 rounded-full font-bold flex items-center gap-1">
              {onlineFriendsCount > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
              {friends.length}
            </span>
            {totalUnreadDMs > 0 && (
              <span
                className="bg-rose-600 text-white text-[10px] px-2 py-0.5 rounded-full font-extrabold shadow-lg shadow-rose-600/50 flex items-center gap-1 animate-pulse"
                title={`${totalUnreadDMs} nova(s) mensagem(ns)`}
              >
                <MessageSquare className="w-2.5 h-2.5 fill-white text-white" />
                <span>{totalUnreadDMs} nova{totalUnreadDMs > 1 ? 's' : ''}</span>
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('saved_rooms')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeTab === 'saved_rooms'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Salas Salvas</span>
            <span className="bg-indigo-500/20 text-indigo-300 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
              {savedSpaces.length}
            </span>
          </button>
        </div>

        {/* TAB 1: CONECTAR */}
        {activeTab === 'connect' && (
          <DirectConnectTab
            userName={userName}
            setUserName={(name) => {
              setUserName(name)
              setLocalPlayer({ name: name.trim() })
              FriendsPresenceService.getInstance().broadcastPresence()
              if (createRoomName === `Espaço de ${localPlayer.name || 'Trabalho'}`) {
                setCreateRoomName(`Espaço de ${name}`)
              }
            }}
            onOpenAvatarCustomizer={onOpenAvatarCustomizer}
            mode={mode}
            setMode={setMode}
            createRoomName={createRoomName}
            setCreateRoomName={setCreateRoomName}
            createIsPublic={createIsPublic}
            setCreateIsPublic={setCreateIsPublic}
            roomInput={roomInput}
            setRoomInput={setRoomInput}
            error={error}
            loading={loading}
            onSubmit={handleStart}
          />
        )}

        {/* TAB 2: SALAS DISPONÍVEIS */}
        {activeTab === 'available_rooms' && (
          <PublicRoomsTab
            publicRooms={publicRooms}
            filteredPublicRooms={filteredPublicRooms}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isRefreshing={isRefreshing}
            handleManualRefresh={handleManualRefresh}
            copiedRoomCode={copiedRoomCode}
            handleCopyCode={handleCopyCode}
            handleJoinPublicRoom={handleJoinPublicRoom}
            loading={loading}
            onOpenCreateMode={() => {
              setMode('create')
              setCreateIsPublic(true)
              setActiveTab('connect')
            }}
          />
        )}

        {/* TAB 3: AMIGOS */}
        {activeTab === 'friends' && (
          <FriendsTab
            onOpenChat={(friend) => setChatFriend(friend)}
            onJoinRoom={handleJoinByCode}
          />
        )}

        {/* TAB 4: SALAS SALVAS */}
        {activeTab === 'saved_rooms' && (
          <SavedSpacesTab
            savedSpaces={savedSpaces}
            selectedSpaceId={selectedSpaceId}
            setSelectedSpaceId={setSelectedSpaceId}
            editingSpaceId={editingSpaceId}
            editingSpaceName={editingSpaceName}
            setEditingSpaceName={setEditingSpaceName}
            handleStartEditingSpace={handleStartEditingSpace}
            handleSaveEditingSpace={handleSaveEditingSpace}
            setEditingSpaceId={setEditingSpaceId}
            handleEnterSavedSpace={handleEnterSavedSpace}
            handleCreateNewSpace={handleCreateNewSpace}
            duplicateSavedSpace={duplicateSavedSpace}
            deleteSavedSpace={deleteSavedSpace}
            copiedRoomCode={copiedRoomCode}
            handleCopyCode={handleCopyCode}
            loading={loading}
            error={error}
            handleRegenerateCode={(spaceId) => {
              const freshCode = generateUUID()
              updateSavedSpace(spaceId, { roomCode: freshCode })
              setError(null)
            }}
          />
        )}
      </div>

      {/* Lobby Friend Chat Modal */}
      {chatFriend && (
        <LobbyChatModal
          friend={chatFriend}
          onClose={() => setChatFriend(null)}
          onJoinRoom={handleJoinByCode}
        />
      )}

      {/* Real-time Incoming Message Toast */}
      {incomingToast && (
        <div className="fixed top-6 right-6 z-[60] bg-[#1b202c] border-2 border-rose-500 rounded-2xl p-3.5 shadow-2xl shadow-rose-950/80 max-w-sm w-full flex items-start gap-3 animate-in slide-in-from-top-4 fade-in duration-200">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-md border border-white/20"
            style={{
              backgroundColor:
                incomingToast.friend.avatar?.shirtColor ||
                incomingToast.friend.avatar?.topColor ||
                '#e11d48',
            }}
          >
            {incomingToast.friend.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-bold text-white truncate">
                {incomingToast.friend.name}
              </span>
              <span className="text-[10px] text-rose-400 font-extrabold flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                Nova mensagem
              </span>
            </div>
            <p className="text-xs text-slate-300 truncate mt-1 bg-[#12151d] p-1.5 rounded-lg border border-[#2a3142]">
              "{incomingToast.content}"
            </p>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => {
                  setChatFriend(incomingToast.friend)
                  setIncomingToast(null)
                }}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg shadow-md flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <MessageSquare className="w-3 h-3 fill-white" />
                <span>Responder</span>
              </button>
              <button
                type="button"
                onClick={() => setIncomingToast(null)}
                className="px-2 py-1 text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                Dispensar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
