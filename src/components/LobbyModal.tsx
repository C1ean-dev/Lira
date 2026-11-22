import { MeetingHistoryAccess } from './collaboration/MeetingHistoryAccess'
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { DoorOpen, Globe, LayoutGrid, Users, MessageSquare, RefreshCw } from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useChatStore } from '../store/useChatStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { useSavedSpacesStore } from '../store/useSavedSpacesStore'
import { useRoomJoinStore } from '../store/useRoomJoinStore'
import { PeerManager } from '../p2p/PeerManager'
import { ALL_INVITE_PREFIX, decodeAllInvite } from '../p2p/directInvite'
import { normalizeSpaceInvite } from '../utils/spaceInviteLink'
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
import { Button, Badge, Card } from './ui'
import { UpdateDownloadIndicator } from './common/UpdateDownloadIndicator'
import { UpdateChangelogHover } from './common/UpdateChangelogHover'
import { useUpdateStore, versionBadgeLabel } from '../store/useUpdateStore'
import { CURRENT_APP_VERSION } from '../services/updateService'
import { isAndroid } from '../utils/platform'
import { isSameParticipant } from '../utils/userId'

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
  const updateStatus = useUpdateStore((s) => s.status)
  const updateProgress = useUpdateStore((s) => s.progress)
  const hasUpdate = hasUpdateProp ?? !!updateInfo?.hasUpdate
  const readyFromStore = updateStatus === 'ready'
  const isAndroidPlatform = isAndroid()
  const isDownloadingUpdate = updateStatus === 'downloading'
  const updatePercent = Math.round(Math.max(0, Math.min(100, Number.isFinite(updateProgress.percent) ? updateProgress.percent : 0)))
  const isReadyToInstall = isUpdateReady ?? readyFromStore
  const showUpdateAction = hasUpdate && (isAndroidPlatform || isDownloadingUpdate || isReadyToInstall)
  const updateActionLabel = isDownloadingUpdate
    ? `Baixando atualização: ${updatePercent}%`
    : isAndroidPlatform
      ? 'Atualizar Lira'
      : 'Instalar atualização'
  const manualCheck = useUpdateStore((s) => s.manualCheck)
  const checkNow = useUpdateStore((s) => s.checkNow)
  const rawVersion = updateInfo?.currentVersion || CURRENT_APP_VERSION
  const currentVersion = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`

  const { localPlayer, setLocalPlayer, friends, friendProfiles } = useGameStore()
  const {
    savedSpaces,
    activeSpaceId,
    setActiveSpaceId,
    loadSpaceMap,
    createSavedSpace,
    updateSavedSpace,
    deleteSavedSpace,
    duplicateSavedSpace,
    exportSavedSpace,
    importSpacesFromBytes,
  } = useSavedSpacesStore()

  const [activeTab, setActiveTab] = useState<'connect' | 'available_rooms' | 'friends' | 'saved_rooms'>('connect')
  const [userName, setUserName] = useState(localPlayer.name || '')
  const [roomInput, setRoomInput] = useState('')
  const [directFallback, setDirectFallback] = useState<{ code: string; offer: string } | null>(null)
  const [createRoomName, setCreateRoomName] = useState(`Espaço de ${localPlayer.name || 'Trabalho'}`)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatFriend, setChatFriend] = useState<FriendProfile | null>(null)
  const [onlineFriendsCount, setOnlineFriendsCount] = useState(0)

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

  const messages = useChatStore((s) => s.messages)
  const chatChannels = useChatStore((s) => s.channels)
  const lastReadByPeer = useChatStore((s) => s.lastReadByPeer)
  const getTotalUnreadDMs = useChatStore((s) => s.getTotalUnreadDMs)

  const totalUnreadDMs = useMemo(() => {
    return getTotalUnreadDMs()
  }, [messages, chatChannels, lastReadByPeer, friends, friendProfiles, getTotalUnreadDMs])

  const [incomingToast, setIncomingToast] = useState<{
    friend: FriendProfile
    content: string
  } | null>(null)
  const prevMessagesCountRef = useRef(messages.length)

  useEffect(() => {
    if (messages.length > prevMessagesCountRef.current) {
      const newest = messages[messages.length - 1]
      const isFromMe = isSameParticipant(localPlayer, newest.senderId, newest.senderName)

      if (!isFromMe && (newest.channelId?.startsWith('dm-') || newest.recipientId)) {
        const matchedFriendId = friends.find((fid) =>
          isSameParticipant(friendProfiles[fid] || { id: fid }, newest.senderId, newest.senderName)
        )

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

  const [selectedSpaceId, setSelectedSpaceId] = useState<string>(activeSpaceId || savedSpaces[0]?.id || '')

  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null)
  const [editingSpaceName, setEditingSpaceName] = useState('')

  const [publicRooms, setPublicRooms] = useState<PublicRoomInfo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedRoomCode, setCopiedRoomCode] = useState<string | null>(null)

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
    const hub = PublicRoomsService.getInstance()
    hub.refresh()
    setPublicRooms(hub.getRooms())
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
      useMediaStore.getState().setMuted(true)
      useMediaStore.getState().setCameraOff(true)
      setLocalPlayer({ name: userName.trim(), isCameraOff: true, isMuted: true })
      const playerPayload: Player = {
        ...useGameStore.getState().localPlayer,
        name: userName.trim(),
        isCameraOff: true,
        isMuted: true,
      }

      const matchingSpace = savedSpaces.find(
        (s) => s.roomCode?.toUpperCase() === room.code.trim().toUpperCase()
      )
      if (matchingSpace) {
        const loadedMap = (await loadSpaceMap(matchingSpace.id)) ?? matchingSpace.mapData
        useMapStore.getState().setMapData(loadedMap)
        setActiveSpaceId(matchingSpace.id)
        setSelectedSpaceId(matchingSpace.id)
        const spawnX = loadedMap.spawnPoint?.x ?? 34
        const spawnY = loadedMap.spawnPoint?.y ?? 20
        playerPayload.x = spawnX
        playerPayload.y = spawnY
      }

      await Promise.all([
        MediaManager.getInstance().startMedia(false, true),
        PeerManager.getInstance().joinRoom(room.code, playerPayload),
      ])
      onJoined()
    } catch (err: any) {
      console.error(err)
      setError(err?.message || `Não foi possível conectar à sala "${room.name}". Tente novamente em instantes.`)
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
      code = normalizeSpaceInvite(code)
      const invite = code.trim().startsWith(ALL_INVITE_PREFIX) ? decodeAllInvite(code) : undefined
      useMediaStore.getState().setMuted(true)
      useMediaStore.getState().setCameraOff(true)
      setLocalPlayer({ name: userName.trim(), isCameraOff: true, isMuted: true })
      const playerPayload: Player = {
        ...useGameStore.getState().localPlayer,
        name: userName.trim(),
        isCameraOff: true,
        isMuted: true,
      }

      const matchingSpace = savedSpaces.find(
        (s) => s.roomCode?.toUpperCase() === (invite?.room ?? code.trim().toUpperCase())
      )
      if (matchingSpace) {
        const loadedMap = (await loadSpaceMap(matchingSpace.id)) ?? matchingSpace.mapData
        useMapStore.getState().setMapData(loadedMap)
        setActiveSpaceId(matchingSpace.id)
        setSelectedSpaceId(matchingSpace.id)
        const spawnX = loadedMap.spawnPoint?.x ?? 34
        const spawnY = loadedMap.spawnPoint?.y ?? 20
        playerPayload.x = spawnX
        playerPayload.y = spawnY
      }

      const manager = PeerManager.getInstance()
      if (invite) {
        const offer = await manager.joinAllInvite(invite, playerPayload)
        if (offer) {
          setRoomInput(code.trim())
          setDirectFallback({ code: code.trim(), offer })
          setActiveTab('connect')
          return
        }
        await MediaManager.getInstance().startMedia(false, true)
      } else {
        await Promise.all([
          MediaManager.getInstance().startMedia(false, true),
          manager.joinRoom(code.trim(), playerPayload),
        ])
      }
      onJoined()
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Não foi possível conectar à sala. Tente novamente em instantes.')
    } finally {
      enterGuardRef.current.release()
      setLoading(false)
    }
  }

  const pendingRoomCode = useRoomJoinStore((s) => s.pendingRoomCode)
  useEffect(() => {
    if (!pendingRoomCode || loading) return
    useRoomJoinStore.getState().clear()
    setRoomInput(pendingRoomCode)
    setActiveTab('connect')
    setDirectFallback(null)
    if (pendingRoomCode.startsWith('LIRA-DIRECT:')) return
    handleJoinByCode(pendingRoomCode)
  }, [pendingRoomCode, loading])

  const beginDirectJoin = useCallback(() => {
    if (!enterGuardRef.current.tryEnter()) return false
    setLoading(true)
    setError(null)
    return true
  }, [])

  const endDirectJoin = useCallback(() => {
    enterGuardRef.current.release()
    setLoading(false)
  }, [])

  const handleCreateSpace = async () => {
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

      const mediaReady = MediaManager.getInstance().startMedia(false, true)
      const roomTitle = createRoomName.trim() || `Espaço de ${userName.trim()}`
      const description = 'Espaço virtual e comunicação em tempo real'
      const newMap = createEmptyWorkspace()
      newMap.id = 'room-' + Math.random().toString(36).substring(2, 8)
      newMap.name = roomTitle

      const persistentRoomCode = generateUUID()

      const createdSpace = createSavedSpace(
        roomTitle,
        newMap,
        description,
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
        isCameraOff: useMediaStore.getState().isCameraOff ?? true,
        isMuted: useMediaStore.getState().isMuted ?? true,
      }

      await Promise.all([
        mediaReady,
        PeerManager.getInstance().createRoom(
          persistentRoomCode,
          playerPayload,
          {
            roomName: createdSpace.name,
            roomDescription: description,
            isPublic: true,
            maxPlayers: 25,
            color,
          }
        ),
      ])

      onJoined()
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Não foi possível criar o espaço. Tente novamente em instantes.')
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
      const targetMapData = (await loadSpaceMap(targetSpace.id)) ?? targetSpace.mapData
      useMapStore.getState().setMapData(targetMapData)
      setActiveSpaceId(targetSpace.id)

      const spawnX = targetMapData.spawnPoint?.x ?? 34
      const spawnY = targetMapData.spawnPoint?.y ?? 20

      setLocalPlayer({
        name: userName.trim(),
        x: spawnX,
        y: spawnY,
        currentZoneId: null,
      })

      useMediaStore.getState().setMuted(true)
      useMediaStore.getState().setCameraOff(true)
      const mediaReady = MediaManager.getInstance().startMedia(false, true)

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
        isCameraOff: useMediaStore.getState().isCameraOff ?? true,
        isMuted: useMediaStore.getState().isMuted ?? true,
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
        const isIdCollision =
          firstErr?.message?.includes('is taken') ||
          firstErr?.message?.includes('unavailable-id') ||
          firstErr?.type === 'unavailable-id'

        if (isIdCollision) {
          console.warn(`[Lobby] Host ID for code ${persistentCode} is unavailable or taken. Auto-regenerating fresh roomCode...`, firstErr)
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
        } else {
          throw firstErr
        }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-lira-ground p-2 sm:p-4 select-none font-mono text-lira-ink">
      <Card variant="dashed" className="w-full max-w-2xl sm:max-w-[740px] overflow-hidden flex flex-col max-h-[96vh] sm:max-h-[92vh]">
        <div className="bg-lira-surface border-b border-dashed border-lira-rule/60 p-3.5 sm:p-5 text-center relative shrink-0 z-20">
          <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-30"><MeetingHistoryAccess /></div>
          <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-30 flex items-center gap-2">
            <UpdateChangelogHover
              updateInfo={updateInfo}
              isUpdateReady={isReadyToInstall}
              isDownloading={isDownloadingUpdate}
              downloadPercent={updatePercent}
              onApplyUpdate={showUpdateAction && onApplyUpdate ? onApplyUpdate : undefined}
            >
              {showUpdateAction && onApplyUpdate ? (
                <Button
                  variant="quiet"
                  size="icon"
                  disabled={isUpdating || isDownloadingUpdate}
                  className="border-lira-online/50 bg-lira-online/15 text-lira-online hover:bg-lira-online hover:text-lira-ground hover:border-lira-online cursor-pointer"
                  aria-label={updateActionLabel}
                  title={isDownloadingUpdate ? updateActionLabel : 'Nova versão disponível. Passe o mouse ou clique para ver novidades e instalar.'}
                >
                  {isUpdating ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <UpdateDownloadIndicator downloading={isDownloadingUpdate} percent={updatePercent} />
                  )}
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); checkNow() }}
                  disabled={manualCheck === 'checking'}
                  className="gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs font-bold cursor-pointer disabled:cursor-wait"
                  title={`Versão atual do Lira: ${currentVersion}. Clique para verificar atualizações.`}
                >
                  {manualCheck === 'checking' ? (
                    <RefreshCw className="w-3 h-3 animate-spin" />
                  ) : (
                    <span className={`w-2 h-2 rounded-full ${manualCheck === 'failed' ? 'bg-lira-error' : 'bg-lira-online'}`} />
                  )}
                  <span className="font-mono">{versionBadgeLabel(manualCheck, currentVersion)}</span>
                </Button>
              )}
            </UpdateChangelogHover>
          </div>
          <div className="relative z-10 flex flex-col items-center">
            <div className="mb-1 sm:mb-2 scale-90 sm:scale-100">
              <LiraLogo size={46} />
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold text-lira-accent tracking-tight">LIRA</h1>
            <p className="text-[11px] sm:text-xs font-mono text-lira-muted max-w-sm mt-0.5 px-2">
              Escritório virtual colaborativo com salas em tempo real, áudio P2P e zonas privadas
            </p>
          </div>
        </div>

        <div className="flex border-b border-dashed border-lira-rule/60 bg-lira-sidebar px-3 sm:px-6 pt-2.5 sm:pt-3 gap-1.5 sm:gap-2.5 shrink-0 overflow-x-auto justify-start sm:justify-center font-mono">
          <button
            type="button"
            onClick={() => setActiveTab('connect')}
            className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeTab === 'connect'
                ? 'border-lira-accent text-lira-accent'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <DoorOpen className="w-3.5 h-3.5" />
            <span>Conectar</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('available_rooms')}
            className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-2 shrink-0 whitespace-nowrap relative ${
              activeTab === 'available_rooms'
                ? 'border-lira-accent text-lira-accent'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-lira-accent" />
            <span>Salas Disponíveis (Hub)</span>
            <Badge variant="online" className="text-[10px] px-1.5 py-0">
              <span className="w-1.5 h-1.5 rounded-full bg-lira-online" />
              {publicRooms.length}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('friends')}
            className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-2 shrink-0 whitespace-nowrap relative ${
              activeTab === 'friends'
                ? 'border-lira-accent text-lira-accent'
                : totalUnreadDMs > 0
                ? 'border-lira-error text-lira-error font-extrabold bg-lira-error/10 rounded-t-[8px]'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <div className="relative flex items-center">
              <Users className={`w-3.5 h-3.5 ${totalUnreadDMs > 0 ? 'text-lira-error' : ''}`} />
              {totalUnreadDMs > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 rounded-full bg-lira-error ring-2 ring-lira-sidebar" />
              )}
            </div>
            <span>Amigos</span>
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
              {onlineFriendsCount > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-lira-online" />
              )}
              {friends.length}
            </Badge>
            {totalUnreadDMs > 0 && (
              <Badge
                variant="error"
                className="text-[10px] px-2 py-0.5 font-extrabold"
                title={`${totalUnreadDMs} nova(s) mensagem(ns)`}
              >
                <MessageSquare className="w-2.5 h-2.5 fill-current" />
                <span>{totalUnreadDMs} nova{totalUnreadDMs > 1 ? 's' : ''}</span>
              </Badge>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('saved_rooms')}
            className={`pb-2.5 px-3 text-xs font-bold transition-colors border-b-2 flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeTab === 'saved_rooms'
                ? 'border-lira-accent text-lira-accent'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Salas Salvas</span>
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
              {savedSpaces.length}
            </Badge>
          </button>
        </div>

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
            createRoomName={createRoomName}
            setCreateRoomName={setCreateRoomName}
            roomInput={roomInput}
            setRoomInput={code => { setRoomInput(code); setDirectFallback(null) }}
            directFallback={directFallback?.code === roomInput.trim() ? directFallback.offer : undefined}
            error={error}
            loading={loading}
            onCreate={handleCreateSpace}
            onJoin={handleJoinByCode}
            onJoined={onJoined}
            beginDirectJoin={beginDirectJoin}
            endDirectJoin={endDirectJoin}
          />
        )}

        {activeTab === 'available_rooms' && (
          <PublicRoomsTab
            publicRooms={publicRooms}
            filteredPublicRooms={filteredPublicRooms}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            handleManualRefresh={handleManualRefresh}
            copiedRoomCode={copiedRoomCode}
            handleCopyCode={handleCopyCode}
            handleJoinPublicRoom={handleJoinPublicRoom}
            handleJoinByCode={handleJoinByCode}
            loading={loading}
            error={error}
            setError={setError}
          />
        )}

        {activeTab === 'friends' && (
          <FriendsTab
            onOpenChat={(friend) => setChatFriend(friend)}
            onJoinRoom={handleJoinByCode}
          />
        )}

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
            onExportSpace={async (spaceId) => {
              try {
                const exported = await exportSavedSpace(spaceId)
                if (!exported) return
                const blob = new Blob([exported.bytes as BlobPart], { type: exported.mimeType })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = exported.filename
                document.body.appendChild(link)
                link.click()
                link.remove()
                URL.revokeObjectURL(url)
                setError(null)
              } catch (err: any) {
                setError(err?.message || 'Não foi possível exportar o espaço.')
              }
            }}
            onImportSpacesFile={async (file) => {
              try {
                const bytes = new Uint8Array(await file.arrayBuffer())
                const { imported } = await importSpacesFromBytes(bytes)
                if (imported.length === 0) {
                  setError('Nenhum espaço válido encontrado no arquivo selecionado.')
                  return
                }
                setSelectedSpaceId(imported[0].id)
                setError(null)
              } catch (err: any) {
                setError(err?.message || 'Arquivo de espaço inválido.')
              }
            }}
          />
        )}
      </Card>

      {chatFriend && (
        <LobbyChatModal
          friend={chatFriend}
          onClose={() => setChatFriend(null)}
          onJoinRoom={handleJoinByCode}
        />
      )}

      {incomingToast && (
        <Card
          variant="dashed"
          className="fixed top-6 right-6 z-[60] border-lira-error p-3.5 max-w-sm w-full flex items-start gap-3 font-mono"
        >
          <div
            className="w-10 h-10 rounded-[6px] flex items-center justify-center font-bold text-sm text-lira-ground shrink-0 border border-lira-rule"
            style={{
              backgroundColor:
                incomingToast.friend.avatar?.shirtColor ||
                incomingToast.friend.avatar?.topColor ||
                '#ffb0bd',
            }}
          >
            {incomingToast.friend.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-bold text-lira-ink truncate">
                {incomingToast.friend.name}
              </span>
              <span className="text-[10px] text-lira-error font-extrabold flex items-center gap-1 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-lira-error" />
                Nova mensagem
              </span>
            </div>
            <p className="text-xs text-lira-ink truncate mt-1 bg-lira-ground p-1.5 rounded-[8px] border border-lira-quiet">
              "{incomingToast.content}"
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="destructive"
                size="xs"
                onClick={() => {
                  setChatFriend(incomingToast.friend)
                  setIncomingToast(null)
                }}
                className="cursor-pointer"
              >
                <MessageSquare className="w-3 h-3 fill-current" />
                <span>Responder</span>
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setIncomingToast(null)}
                className="cursor-pointer"
              >
                Dispensar
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
