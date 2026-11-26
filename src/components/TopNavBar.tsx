import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Bug,
  Copy,
  Check,
  CircleAlert,
  LoaderCircle,
  Edit3,
  MessageSquare,
  Users,
  Settings,
  Lock,
  Globe,
  LogOut,
  RefreshCw,
  X,
  Link2,
  Map,
  Share2,
  UserPlus,
  WifiOff,
} from 'lucide-react'
import { CollaborationButtons } from './collaboration/CollaborationButtons'
import { useGameStore } from '../store/useGameStore'
import { selectActiveMapData, useMapStore } from '../store/useMapStore'
import { useChatStore } from '../store/useChatStore'
import { useMediaStore } from '../store/useMediaStore'
import { PeerManager } from '../p2p/PeerManager'
import { LiraLogo } from './LiraLogo'
import { useUpdateStore, versionBadgeLabel } from '../store/useUpdateStore'
import { CURRENT_APP_VERSION } from '../services/updateService'
import { PlayerAvatar } from './common/PlayerAvatar'
import { resolveProfile } from '../utils/profileUtils'
import { useProfileModalStore } from '../store/useProfileModalStore'
import { UpdateDownloadIndicator } from './common/UpdateDownloadIndicator'
import { UpdateChangelogHover } from './common/UpdateChangelogHover'
import { isAndroid } from '../utils/platform'
import { useRoomPublication } from '../hooks/useRoomPublication'
import { DirectConnectionPanel } from './lobby/DirectConnectionPanel'
import { ReportIssueModal } from './ReportIssueModal'
import { createSpaceInviteLink } from '../utils/spaceInviteLink'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/Tooltip'

interface Props {
  onOpenAvatarModal: () => void
  onApplyUpdate?: () => void
  hasUpdate?: boolean
  isUpdateReady?: boolean
  isUpdating?: boolean
  onDisconnect?: () => void
}

const RAIL_ICON_BTN =
  'relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-[10px] border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lira-accent'

export const TopNavBar: React.FC<Props> = ({
  onOpenAvatarModal: _onOpenAvatarModal,
  onApplyUpdate,
  hasUpdate,
  isUpdateReady,
  isUpdating,
  onDisconnect,
}) => {
  const localPlayerName = useGameStore((s) => s.localPlayer.name)
  const localPlayerProfilePicture = useGameStore((s) => s.localPlayer.profilePicture)
  const localPlayerAvatar = useGameStore((s) => s.localPlayer.avatar)
  const localPlayerProfile = useGameStore((s) => s.localPlayer.profile)
  const localPlayerStatus = useGameStore((s) => s.localPlayer.status)
  const localPlayerStatusText = useGameStore((s) => s.localPlayer.statusText)
  const localPlayerCurrentZoneId = useGameStore((s) => s.localPlayer.currentZoneId)
  const resolvedLocalProfile = useMemo(() => resolveProfile(localPlayerProfile), [localPlayerProfile])
  const roomId = useGameStore((s) => s.roomId)
  const updateInfo = useUpdateStore((s) => s.updateInfo)
  const updateStatus = useUpdateStore((s) => s.status)
  const updateProgress = useUpdateStore((s) => s.progress)
  const manualCheck = useUpdateStore((s) => s.manualCheck)
  const checkNow = useUpdateStore((s) => s.checkNow)
  const rawVersion = updateInfo?.currentVersion || CURRENT_APP_VERSION
  const currentVersion = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`
  const isHost = useGameStore((s) => s.isHost)
  const isRoomPublic = useGameStore((s) => s.isRoomPublic)
  const toggleRoomPrivacy = useGameStore((s) => s.toggleRoomPrivacy)
  const publicationServers = useRoomPublication(isRoomPublic ? roomId : null)
  const isOnlineUsersOpen = useGameStore((s) => s.isOnlineUsersOpen)
  const toggleOnlineUsers = useGameStore((s) => s.toggleOnlineUsers)
  const setOnlineUsersOpen = useGameStore((s) => s.setOnlineUsersOpen)
  const remotePlayerCount = useGameStore(
    (s) => Object.values(s.remotePlayers).filter((p) => !p.isDjBot && !p.id.startsWith('dj-')).length
  )
  const mapZones = useMapStore((s) => selectActiveMapData(s).zones)
  const activeInterior = useMapStore((s) =>
    s.activeHouseId ? s.mapData.houseInteriors?.[s.activeHouseId] ?? null : null
  )
  const isEditorOpen = useMapStore((s) => s.isEditorOpen)
  const toggleEditor = useMapStore((s) => s.toggleEditor)
  const isChatOpen = useChatStore((s) => s.isChatOpen)
  const toggleChat = useChatStore((s) => s.toggleChat)
  const setChatOpen = useChatStore((s) => s.setChatOpen)
  const messages = useChatStore((s) => s.messages)
  const chatChannels = useChatStore((s) => s.channels)
  const lastReadByPeer = useChatStore((s) => s.lastReadByPeer)
  const getTotalUnreadDMs = useChatStore((s) => s.getTotalUnreadDMs)
  const isGridCallOpen = useMediaStore((s) => s.isGridCallOpen)
  const setGridCallOpen = useMediaStore((s) => s.setGridCallOpen)

  const totalUnread = useMemo(() => {
    const generalUnread = chatChannels.filter((c) => c.type !== 'dm').reduce((acc, c) => acc + c.unreadCount, 0)
    return generalUnread + getTotalUnreadDMs()
  }, [messages, chatChannels, lastReadByPeer, getTotalUnreadDMs])

  const totalUnreadDMs = useMemo(
    () => getTotalUnreadDMs(),
    [messages, chatChannels, lastReadByPeer, getTotalUnreadDMs]
  )
  const connectionStatus = useGameStore((s) => s.connectionStatus)

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const [linkStatus, setLinkStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const [linkError, setLinkError] = useState('')
  const [showDirectConnection, setShowDirectConnection] = useState(false)
  const [autoSavedNotice, setAutoSavedNotice] = useState(false)
  const [isRoomMenuOpen, setIsRoomMenuOpen] = useState(false)
  const [isReportIssueOpen, setIsReportIssueOpen] = useState(false)
  const [popoverTop, setPopoverTop] = useState<number>(12)

  const prevEditorOpenRef = useRef(isEditorOpen)
  const roomButtonRef = useRef<HTMLButtonElement>(null)
  const reportIssueButtonRef = useRef<HTMLButtonElement>(null)
  const directConnectionDialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (showDirectConnection) directConnectionDialogRef.current?.showModal()
  }, [showDirectConnection])

  useEffect(() => {
    if (prevEditorOpenRef.current && !isEditorOpen) {
      setAutoSavedNotice(true)
      const t = setTimeout(() => setAutoSavedNotice(false), 2400)
      return () => clearTimeout(t)
    }
    prevEditorOpenRef.current = isEditorOpen
  }, [isEditorOpen])

  const updatePopoverPosition = useCallback(() => {
    if (typeof window === 'undefined') return
    const anchorTop = roomButtonRef.current?.getBoundingClientRect().top ?? 12
    const maxTop = Math.max(12, window.innerHeight - 360)
    setPopoverTop(Math.min(Math.max(12, anchorTop), maxTop))
  }, [])

  useEffect(() => {
    if (!isRoomMenuOpen || typeof window === 'undefined') return
    updatePopoverPosition()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || directConnectionDialogRef.current?.open) return
      setIsRoomMenuOpen(false)
      roomButtonRef.current?.focus()
    }
    window.addEventListener('resize', updatePopoverPosition)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('resize', updatePopoverPosition)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isRoomMenuOpen, updatePopoverPosition])

  const currentZone = mapZones.find((z) => z.id === localPlayerCurrentZoneId)
  const currentZoneName = currentZone
    ? activeInterior
      ? `${activeInterior.name} · ${currentZone.name}`
      : currentZone.name
    : activeInterior
      ? `🏠 ${activeInterior.name}`
      : 'Corredor Geral'
  const currentZoneColor = currentZone?.color || activeInterior?.accentColor || '#6b7280'
  const isAndroidPlatform = isAndroid()
  const isDownloadingUpdate = updateStatus === 'downloading'
  const updatePercent = Math.round(
    Math.max(0, Math.min(100, Number.isFinite(updateProgress.percent) ? updateProgress.percent : 0))
  )
  const isReadyToInstall = isUpdateReady ?? updateStatus === 'ready'
  const showUpdateAction = hasUpdate && (isAndroidPlatform || isDownloadingUpdate || isReadyToInstall)
  const updateActionLabel = isDownloadingUpdate
    ? `Baixando atualização: ${updatePercent}%`
    : isAndroidPlatform
    ? 'Atualizar Lira'
    : 'Instalar atualização'
  const displayRoomId = isAndroidPlatform && roomId ? roomId.slice(0, 8) : roomId
  const isMapActive = !isGridCallOpen && !isChatOpen

  const handleGoToMap = () => {
    setIsRoomMenuOpen(false)
    setGridCallOpen(false)
    setChatOpen(false)
    setOnlineUsersOpen(false)
  }

  const handleCopyCode = async () => {
    if (!roomId || copyStatus === 'copying') return
    setCopyStatus('copying')
    try {
      await navigator.clipboard.writeText(roomId.toUpperCase())
      setCopyStatus('copied')
    } catch {
      setCopyStatus('error')
    } finally {
      setTimeout(() => setCopyStatus((current) => (current === 'copying' ? current : 'idle')), 2500)
    }
  }

  const handleCopyLink = async () => {
    if (!roomId || linkStatus === 'copying') return
    setLinkStatus('copying')
    setLinkError('')
    try {
      const link = isHost
        ? PeerManager.getInstance().createAllInvite().then(createSpaceInviteLink)
        : Promise.resolve(createSpaceInviteLink(roomId))
      if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': link.then((value) => new Blob([value], { type: 'text/plain' })),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(await link)
      }
      setLinkStatus('copied')
    } catch (error) {
      setLinkStatus('error')
      setLinkError(error instanceof Error ? error.message : 'Não foi possível copiar o link. Tente novamente.')
    } finally {
      setTimeout(() => setLinkStatus((current) => (current === 'copying' ? current : 'idle')), 3500)
    }
  }

  const openReportIssue = () => {
    setIsRoomMenuOpen(false)
    setIsReportIssueOpen(true)
  }

  const closeReportIssue = () => {
    setIsReportIssueOpen(false)
    reportIssueButtonRef.current?.focus()
  }

  const roomStatusDotClass = !isRoomPublic
    ? 'bg-lira-muted/70'
    : publicationServers.length > 0
    ? 'bg-lira-online'
    : 'bg-lira-amber'

  const roomPopover = isRoomMenuOpen ? (
    <>
      <div
        className="fixed inset-0 z-[84] bg-transparent"
        aria-hidden="true"
        onClick={() => setIsRoomMenuOpen(false)}
      />
      <div
        id="space-room-popover"
        role="region"
        aria-label="Sala e convites"
        style={{ top: `${popoverTop}px` }}
        className="fixed left-[calc(var(--rail-width)+8px)] z-[95] w-80 max-w-[calc(100vw-var(--rail-width)-16px)] max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-[12px] border border-dashed border-lira-rule bg-lira-panel p-3.5 flex flex-col gap-3 font-mono text-lira-ink shadow-xl select-none"
      >
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-dashed border-lira-rule/60">
          <div className="flex items-center gap-2 min-w-0">
            <Share2 className="w-4 h-4 text-lira-accent shrink-0" />
            <h2 className="font-display text-sm font-bold text-lira-accent truncate">Sala e Convites</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              setIsRoomMenuOpen(false)
              roomButtonRef.current?.focus()
            }}
            aria-label="Fechar sala e convites"
            className="p-1.5 rounded-[8px] border border-transparent text-lira-muted hover:border-lira-quiet hover:bg-lira-surface hover:text-lira-ink transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {roomId && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleCopyLink}
              disabled={linkStatus === 'copying'}
              aria-busy={linkStatus === 'copying'}
              aria-label={linkStatus === 'copied' ? 'Link do convite copiado' : 'Copiar link do convite'}
              title={linkStatus === 'error' ? linkError : 'Copiar link para abrir o Lira e entrar no espaço'}
              className="flex w-full items-center gap-2.5 rounded-[8px] border border-lira-quiet bg-lira-surface px-3 py-2 text-xs font-semibold text-lira-accent transition-colors enabled:hover:border-lira-accent enabled:hover:text-lira-ink disabled:opacity-50 text-left"
            >
              {linkStatus === 'copying' ? (
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
              ) : linkStatus === 'copied' ? (
                <Check className="h-4 w-4 shrink-0 text-lira-online" />
              ) : linkStatus === 'error' ? (
                <CircleAlert className="h-4 w-4 shrink-0 text-lira-error" />
              ) : (
                <Link2 className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">
                {linkStatus === 'copied'
                  ? 'Link do convite copiado'
                  : linkStatus === 'error'
                  ? 'Erro ao copiar link'
                  : 'Copiar link do convite'}
              </span>
              <span className="sr-only" role="status">
                {linkStatus === 'error' ? linkError : linkStatus === 'copied' ? 'Link copiado' : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={handleCopyCode}
              disabled={copyStatus === 'copying'}
              aria-busy={copyStatus === 'copying'}
              aria-label={
                copyStatus === 'copying'
                  ? 'Copiando ID'
                  : copyStatus === 'error'
                  ? 'Falha ao copiar. Tente novamente.'
                  : 'Copiar ID do espaço'
              }
              title={`ID do Espaço: ${roomId}\nClique para copiar o ID`}
              className="flex w-full items-center justify-between gap-2.5 rounded-[8px] border border-lira-quiet bg-lira-surface px-3 py-2 text-xs font-semibold text-lira-accent transition-colors enabled:hover:border-lira-accent enabled:hover:text-lira-ink disabled:opacity-50 text-left"
            >
              <span className="flex shrink-0 items-center gap-2">
                {copyStatus === 'copied' ? (
                  <Check className="h-4 w-4 shrink-0 text-lira-online" />
                ) : copyStatus === 'copying' ? (
                  <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-lira-accent" />
                ) : copyStatus === 'error' ? (
                  <CircleAlert className="h-4 w-4 shrink-0 text-lira-error" />
                ) : (
                  <Copy className="h-4 w-4 shrink-0" />
                )}
                <span className="whitespace-nowrap">
                  {copyStatus === 'copied' ? 'ID copiado!' : 'Convite por ID'}
                </span>
              </span>
              <span className="min-w-0 max-w-[80px] sm:max-w-[108px] truncate rounded-[4px] border border-lira-quiet bg-lira-ground px-1.5 py-0.5 font-mono text-[10px] text-lira-muted">
                {displayRoomId}
              </span>
              <span className="sr-only" role="status">
                {copyStatus === 'error'
                  ? 'Falha ao copiar. Tente novamente.'
                  : copyStatus === 'copied'
                  ? 'ID do espaço copiado'
                  : ''}
              </span>
            </button>

            {isHost && (
              <button
                type="button"
                onClick={() => setShowDirectConnection(true)}
                aria-label="Convites individuais"
                title="Convites individuais"
                className="flex w-full items-center gap-2.5 rounded-[8px] border border-lira-quiet bg-lira-surface px-3 py-2 text-xs font-semibold text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink text-left"
              >
                <UserPlus className="h-4 w-4 shrink-0" />
                <span className="truncate">Convites individuais</span>
              </button>
            )}
          </div>
        )}

        {roomId && (
          <div className="flex flex-col gap-2 pt-2 border-t border-dashed border-lira-rule/60">
            <button
              type="button"
              onClick={isHost ? toggleRoomPrivacy : undefined}
              disabled={!isHost}
              className={`flex items-center justify-between gap-2 w-full px-3 py-2 rounded-[8px] border text-xs font-semibold transition-colors text-left ${
                isRoomPublic
                  ? 'bg-lira-surface border-lira-rule text-lira-accent hover:border-lira-accent hover:text-lira-ink'
                  : 'bg-lira-ground border-lira-quiet text-lira-muted hover:border-lira-rule hover:text-lira-ink'
              } ${!isHost ? 'cursor-default opacity-80' : 'cursor-pointer'}`}
              title={
                isHost
                  ? isRoomPublic
                    ? 'Esta sala está Pública (visível na lista de Salas Disponíveis). Clique para torná-la Privada.'
                    : 'Esta sala está Privada (somente via código). Clique para torná-la Pública na lista de Salas Disponíveis.'
                  : isRoomPublic
                  ? 'Sala Pública'
                  : 'Sala Privada'
              }
            >
              <span className="flex items-center gap-2 min-w-0">
                {isRoomPublic ? (
                  <Globe className="w-4 h-4 shrink-0 text-lira-accent" />
                ) : (
                  <Lock className="w-4 h-4 shrink-0 text-lira-muted" />
                )}
                <span className="truncate">Sala {isRoomPublic ? 'Pública' : 'Privada'}</span>
              </span>
              {isHost && <span className="shrink-0 text-[10px] text-lira-accent underline font-bold">Alternar</span>}
            </button>

            {isRoomPublic && !isAndroidPlatform && (
              <div
                aria-label="Servidores de publicação"
                className="flex flex-wrap items-center gap-1.5 px-1"
              >
                {publicationServers.map((server) => (
                  <span
                    key={server.host}
                    className="inline-block min-w-0 max-w-28 truncate text-[9px] border px-1.5 py-0.5 rounded-[4px] font-bold bg-lira-online/15 text-lira-online border-lira-online/40"
                    aria-label={`Sala publicada em ${server.name}`}
                    title={server.host}
                  >
                    {server.name}
                  </span>
                ))}
                {publicationServers.length === 0 && (
                  <span className="text-[10px] text-lira-amber">Aguardando publicação</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  ) : null

  return (
    <TooltipProvider delayDuration={180} skipDelayDuration={100}>
      <aside
        aria-label="Barra de navegação lateral"
        className="w-[var(--rail-width)] shrink-0 h-full bg-lira-sidebar border-r border-dashed border-lira-rule/60 flex flex-col items-center py-2.5 select-none relative font-mono text-lira-ink z-[85]"
      >
        <div className="flex flex-col items-center w-full flex-1 min-h-0 overflow-y-auto overflow-x-hidden rail-scroll px-1.5 gap-1.5">
          <div className="mb-0.5 flex shrink-0 items-center justify-center">
            <LiraLogo size={34} showText={false} />
          </div>

          <div className="w-7 shrink-0 border-t border-dashed border-lira-rule/50 my-0.5" aria-hidden="true" />

          <nav aria-label="Navegação do espaço" className="flex flex-col items-center gap-1.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleGoToMap}
                  aria-label="Mapa 2D"
                  aria-current={isMapActive ? 'page' : undefined}
                  className={`${RAIL_ICON_BTN} ${
                    isMapActive
                      ? 'bg-lira-accent text-lira-ground border-lira-accent font-bold'
                      : 'bg-lira-surface text-lira-ink border-lira-quiet hover:border-lira-accent hover:text-lira-accent'
                  }`}
                >
                  <Map className="w-4 h-4" />
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-lira-sidebar"
                    style={{ backgroundColor: currentZoneColor }}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="flex flex-col">
                  <span className="font-bold">Mapa 2D</span>
                  <span className="text-[10px] text-lira-muted">{currentZoneName}</span>
                </div>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    setIsRoomMenuOpen(false)
                    setOnlineUsersOpen(false)
                    toggleChat()
                  }}
                  aria-label="Abrir Chat e Canais"
                  aria-pressed={isChatOpen}
                  className={`${RAIL_ICON_BTN} ${
                    isChatOpen
                      ? 'bg-lira-accent text-lira-ground border-lira-accent font-bold'
                      : 'bg-lira-surface text-lira-ink border-lira-quiet hover:border-lira-accent hover:text-lira-accent'
                  }`}
                >
                  <MessageSquare className="w-4 h-4" />
                  {totalUnread > 0 && !isChatOpen && (
                    <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-lira-accent text-lira-ground text-[10px] font-bold flex items-center justify-center leading-none">
                      {totalUnread}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Chat e Canais (C)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    setIsRoomMenuOpen(false)
                    toggleOnlineUsers()
                  }}
                  aria-label="Participantes Online"
                  aria-pressed={isOnlineUsersOpen}
                  className={`${RAIL_ICON_BTN} ${
                    isOnlineUsersOpen
                      ? 'bg-lira-accent text-lira-ground border-lira-accent font-bold'
                      : totalUnreadDMs > 0
                      ? 'bg-lira-error/20 text-lira-error border-lira-error/50 hover:bg-lira-error/30'
                      : 'bg-lira-surface border-lira-quiet text-lira-ink hover:border-lira-accent hover:text-lira-accent'
                  }`}
                >
                  <Users
                    className={`w-4 h-4 ${
                      isOnlineUsersOpen
                        ? 'text-lira-ground'
                        : totalUnreadDMs > 0
                        ? 'text-lira-error'
                        : 'text-lira-online'
                    }`}
                  />
                  <span
                    className={`absolute -bottom-1 -right-1 min-w-4 h-4 px-1 rounded-full border text-[9px] font-bold tabular-nums leading-none flex items-center justify-center ${
                      isOnlineUsersOpen
                        ? 'bg-lira-surface border-lira-accent text-lira-accent'
                        : 'bg-lira-panel border-lira-rule text-lira-ink'
                    }`}
                  >
                    {remotePlayerCount + 1}
                  </span>
                  {totalUnreadDMs > 0 && !isOnlineUsersOpen && (
                    <>
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-lira-error ring-2 ring-lira-sidebar animate-ping" />
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-lira-error ring-2 ring-lira-sidebar" />
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {totalUnreadDMs > 0
                  ? `Participantes (${remotePlayerCount + 1}) • ${totalUnreadDMs} DM(s) não lida(s)`
                  : `Participantes Online (${remotePlayerCount + 1})`}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    setIsRoomMenuOpen(false)
                    if (isGridCallOpen) setGridCallOpen(false)
                    if (isChatOpen) setChatOpen(false)
                    toggleEditor()
                  }}
                  aria-label={isEditorOpen ? 'Fechar Editor do Espaço' : 'Editar Espaço'}
                  aria-pressed={isEditorOpen}
                  className={`${RAIL_ICON_BTN} ${
                    isEditorOpen
                      ? 'bg-lira-accent text-lira-ground border-lira-accent font-bold'
                      : 'bg-lira-surface text-lira-ink border-lira-quiet hover:border-lira-accent hover:text-lira-accent'
                  }`}
                >
                  <Edit3 className="w-4 h-4" />
                  {autoSavedNotice && !isEditorOpen && (
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-lira-online text-lira-ground flex items-center justify-center"
                      >
                        <Check className="w-2.5 h-2.5" />
                      </span>
                      <span className="sr-only" role="status">
                        Espaço Salvo!
                      </span>
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {isEditorOpen ? 'Fechar Editor do Espaço (E)' : 'Editar Espaço (E)'}
              </TooltipContent>
            </Tooltip>
          </nav>

          <div className="w-7 shrink-0 border-t border-dashed border-lira-rule/50 my-0.5" aria-hidden="true" />

          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <CollaborationButtons orientation="vertical" onAction={() => setIsRoomMenuOpen(false)} />

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={roomButtonRef}
                  type="button"
                  onClick={() => {
                    updatePopoverPosition()
                    setIsRoomMenuOpen((open) => !open)
                  }}
                  aria-label="Sala e convites"
                  aria-expanded={isRoomMenuOpen}
                  aria-controls="space-room-popover"
                  className={`${RAIL_ICON_BTN} ${
                    isRoomMenuOpen
                      ? 'bg-lira-accent text-lira-ground border-lira-accent font-bold'
                      : 'bg-lira-surface border-lira-quiet text-lira-accent hover:border-lira-accent hover:text-lira-ink'
                  }`}
                >
                  <Share2 className="w-4 h-4" />
                  {roomId && (
                    <span
                      aria-hidden="true"
                      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-lira-sidebar ${roomStatusDotClass}`}
                    />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="flex flex-col">
                  <span className="font-bold">Sala e convites</span>
                  {roomId && (
                    <span className="text-[10px] text-lira-muted">
                      {isRoomPublic ? 'Sala Pública' : 'Sala Privada'}
                    </span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>

            {connectionStatus === 'reconnecting' && (
              <div
                className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-[10px] bg-lira-amber/15 border border-lira-amber/40 text-lira-amber"
                title="Conexão com a rede P2P instável. Tentando reconectar automaticamente..."
              >
                <LoaderCircle className="w-4 h-4 animate-spin" />
                <span className="sr-only">Reconectando...</span>
              </div>
            )}

            {connectionStatus === 'disconnected' && roomId && (
              <button
                type="button"
                onClick={() => PeerManager.getInstance().reconnect()}
                aria-label="Desconectado — Reconectar"
                className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-[10px] bg-lira-error/15 hover:bg-lira-error/25 border border-lira-error/40 text-lira-error transition-colors cursor-pointer"
                title="Conexão com o servidor perdida. Clique para tentar reconectar agora."
              >
                <WifiOff className="w-4 h-4" />
                <span className="sr-only">Desconectado. Reconectar</span>
              </button>
            )}
          </div>

          <div className="mt-auto w-7 shrink-0 border-t border-dashed border-lira-rule/50 pt-1.5" aria-hidden="true" />

          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <UpdateChangelogHover
              updateInfo={updateInfo}
              isUpdateReady={isReadyToInstall}
              isDownloading={isDownloadingUpdate}
              downloadPercent={updatePercent}
              onApplyUpdate={showUpdateAction && onApplyUpdate ? onApplyUpdate : undefined}
              placement="right"
            >
              {showUpdateAction && onApplyUpdate ? (
                <button
                  type="button"
                  disabled={isUpdating || isDownloadingUpdate}
                  className={`${RAIL_ICON_BTN} bg-lira-online/15 hover:bg-lira-online/25 border-lira-online/40 text-lira-online disabled:opacity-75 disabled:cursor-wait cursor-pointer`}
                  aria-label={updateActionLabel}
                >
                  {isUpdating ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <UpdateDownloadIndicator downloading={isDownloadingUpdate} percent={updatePercent} />
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    checkNow()
                  }}
                  disabled={manualCheck === 'checking'}
                  aria-label={`Verificar atualizações (${versionBadgeLabel(manualCheck, currentVersion)})`}
                  className={`${RAIL_ICON_BTN} bg-lira-surface hover:border-lira-accent border-lira-quiet text-lira-muted hover:text-lira-ink cursor-pointer disabled:cursor-wait`}
                >
                  <RefreshCw className={`w-4 h-4 ${manualCheck === 'checking' ? 'animate-spin' : ''}`} />
                  <span
                    aria-hidden="true"
                    className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${
                      manualCheck === 'failed' ? 'bg-lira-error' : 'bg-lira-online'
                    }`}
                  />
                </button>
              )}
            </UpdateChangelogHover>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    setIsRoomMenuOpen(false)
                    useMediaStore.getState().setSettingsModalOpen(true)
                  }}
                  aria-label="Configurações de Áudio e Chamada"
                  className={`${RAIL_ICON_BTN} bg-lira-surface hover:border-lira-accent border-lira-quiet text-lira-muted hover:text-lira-accent`}
                >
                  <Settings className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Configurações de Áudio e Chamada</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={reportIssueButtonRef}
                  type="button"
                  aria-label="Reportar erro"
                  aria-haspopup="dialog"
                  onClick={openReportIssue}
                  className={`${RAIL_ICON_BTN} border-lira-quiet bg-lira-surface text-lira-error hover:border-lira-accent`}
                >
                  <Bug className="w-4 h-4 text-lira-error" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">Reportar problemas</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    setIsRoomMenuOpen(false)
                    useProfileModalStore.getState().openLocalProfile('view')
                  }}
                  aria-label={`Ver / Editar perfil: ${localPlayerName}`}
                  className={`${RAIL_ICON_BTN} bg-lira-surface hover:border-lira-accent border-lira-quiet p-0`}
                >
                  <PlayerAvatar
                    name={localPlayerName}
                    profilePicture={localPlayerProfilePicture}
                    avatar={localPlayerAvatar}
                    avatarFrame={resolvedLocalProfile.avatarFrame}
                    status={localPlayerStatus}
                    showStatus={true}
                    size="sm"
                    customSizeClass="w-full h-full rounded-[9px] text-xs"
                    className="border-0"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <div className="flex flex-col max-w-48">
                  <span className="font-bold text-lira-ink truncate">{localPlayerName}</span>
                  {localPlayerStatusText && (
                    <span className="text-[10px] text-lira-muted truncate">{localPlayerStatusText}</span>
                  )}
                  <span className="text-[10px] text-lira-accent">Ver / Editar perfil</span>
                </div>
              </TooltipContent>
            </Tooltip>

            {onDisconnect && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      setIsRoomMenuOpen(false)
                      onDisconnect()
                    }}
                    aria-label="Sair / Desconectar deste espaço"
                    className={`${RAIL_ICON_BTN} bg-lira-surface hover:bg-lira-error hover:text-lira-ground hover:border-lira-error border-lira-error/40 text-lira-error`}
                  >
                    <LogOut className="w-4 h-4 text-current" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Sair / Desconectar do Espaço</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {roomPopover && (typeof document !== 'undefined' ? createPortal(roomPopover, document.body) : roomPopover)}

        {showDirectConnection && (
          <dialog
            ref={directConnectionDialogRef}
            aria-labelledby="direct-connection-title"
            className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-xl select-text flex-col overflow-hidden rounded-[12px] border border-dashed border-lira-rule bg-lira-panel p-0 font-mono text-lira-ink open:flex backdrop:bg-lira-ground/80"
            onClose={() => setShowDirectConnection(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) event.currentTarget.close()
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-dashed border-lira-rule/60 px-4 py-2.5 sm:px-5">
              <h2 id="direct-connection-title" className="font-display text-lg font-bold text-lira-accent">
                Convites individuais
              </h2>
              <button
                type="button"
                aria-label="Fechar convites individuais"
                onClick={() => directConnectionDialogRef.current?.close()}
                className="rounded-[8px] border border-transparent p-2.5 text-lira-muted hover:border-lira-quiet hover:bg-lira-surface hover:text-lira-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-lira-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
              <DirectConnectionPanel role="host" />
            </div>
          </dialog>
        )}

        {isReportIssueOpen &&
          typeof document !== 'undefined' &&
          createPortal(<ReportIssueModal isOpen onClose={closeReportIssue} />, document.body)}
      </aside>
    </TooltipProvider>
  )
}

export const SideNavRail = TopNavBar
