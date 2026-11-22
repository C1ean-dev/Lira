import { CollaborationButtons } from './collaboration/CollaborationButtons'
import React, { useState, useEffect, useRef, useMemo } from 'react'
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
  Menu,
  X,
  Link2,
} from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useChatStore } from '../store/useChatStore'
import { useMediaStore } from '../store/useMediaStore'
import { PeerManager } from '../p2p/PeerManager'
import { LiraLogo } from './LiraLogo'
import { useUpdateStore, versionBadgeLabel } from '../store/useUpdateStore'
import { CURRENT_APP_VERSION } from '../services/updateService'
import { NetworkSignalIcon } from './NetworkSignalIcon'
import { useNetworkQualityStore } from '../store/useNetworkQualityStore'
import { STATUS_META } from '../types/game'
import { PlayerAvatar } from './common/PlayerAvatar'
import { UpdateDownloadIndicator } from './common/UpdateDownloadIndicator'
import { UpdateChangelogHover } from './common/UpdateChangelogHover'
import { isAndroid } from '../utils/platform'
import { useRoomPublication } from '../hooks/useRoomPublication'
import { useInlineContentFit } from '../hooks/useInlineContentFit'
import { useHeaderActionsFit } from '../hooks/useHeaderActionsFit'
import { DirectConnectionPanel } from './lobby/DirectConnectionPanel'
import { ReportIssueModal } from './ReportIssueModal'
import { createSpaceInviteLink } from '../utils/spaceInviteLink'
import { ThemeToggle } from './ui'

interface Props {
  onOpenAvatarModal: () => void
  onApplyUpdate?: () => void
  hasUpdate?: boolean
  isUpdateReady?: boolean
  isUpdating?: boolean
  onDisconnect?: () => void
}

export const TopNavBar: React.FC<Props> = ({
  onOpenAvatarModal,
  onApplyUpdate,
  hasUpdate,
  isUpdateReady,
  isUpdating,
  onDisconnect,
}) => {
  const localPlayerName = useGameStore((s) => s.localPlayer.name)
  const localPlayerProfilePicture = useGameStore((s) => s.localPlayer.profilePicture)
  const localPlayerAvatar = useGameStore((s) => s.localPlayer.avatar)
  const localPlayerStatus = useGameStore((s) => s.localPlayer.status)
  const localPlayerStatusText = useGameStore((s) => s.localPlayer.statusText)
  const localPlayerCurrentZoneId = useGameStore((s) => s.localPlayer.currentZoneId)
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
  const remotePlayerCount = useGameStore((s) => Object.values(s.remotePlayers).filter(p => !p.isDjBot && !p.id.startsWith('dj-')).length)
  const mapZones = useMapStore((s) => s.mapData.zones)
  const isEditorOpen = useMapStore((s) => s.isEditorOpen)
  const toggleEditor = useMapStore((s) => s.toggleEditor)
  const isChatOpen = useChatStore((s) => s.isChatOpen)
  const toggleChat = useChatStore((s) => s.toggleChat)
  const messages = useChatStore((s) => s.messages)
  const chatChannels = useChatStore((s) => s.channels)
  const lastReadByPeer = useChatStore((s) => s.lastReadByPeer)
  const getTotalUnreadDMs = useChatStore((s) => s.getTotalUnreadDMs)

  const totalUnread = useMemo(() => {
    const generalUnread = chatChannels.filter((c) => c.type !== 'dm').reduce((acc, c) => acc + c.unreadCount, 0)
    return generalUnread + getTotalUnreadDMs()
  }, [messages, chatChannels, lastReadByPeer, getTotalUnreadDMs])

  const totalUnreadDMs = useMemo(() => getTotalUnreadDMs(), [messages, chatChannels, lastReadByPeer, getTotalUnreadDMs])
  const isMuted = useMediaStore((s) => s.isMuted)
  const toggleMute = useMediaStore((s) => s.toggleMute)
  const connectionStatus = useGameStore((s) => s.connectionStatus)
  const localQuality = useNetworkQualityStore((s) => s.localQuality)

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const [linkStatus, setLinkStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const [linkError, setLinkError] = useState('')
  const [showDirectConnection, setShowDirectConnection] = useState(false)
  const [autoSavedNotice, setAutoSavedNotice] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isReportIssueOpen, setIsReportIssueOpen] = useState(false)
  const prevEditorOpenRef = useRef(isEditorOpen)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
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

  useEffect(() => {
    if (!isMobileMenuOpen) return
    const desktop = window.matchMedia('(min-width: 1536px)')
    const closeOnDesktop = () => { if (desktop.matches) setIsMobileMenuOpen(false) }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || directConnectionDialogRef.current?.open) return
      setIsMobileMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    closeOnDesktop()
    desktop.addEventListener('change', closeOnDesktop)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      desktop.removeEventListener('change', closeOnDesktop)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isMobileMenuOpen])

  const currentZone = mapZones.find((z) => z.id === localPlayerCurrentZoneId)
  const isAndroidPlatform = isAndroid()
  const isDownloadingUpdate = updateStatus === 'downloading'
  const updatePercent = Math.round(Math.max(0, Math.min(100, Number.isFinite(updateProgress.percent) ? updateProgress.percent : 0)))
  const isReadyToInstall = isUpdateReady ?? updateStatus === 'ready'
  const showUpdateAction = hasUpdate && (isAndroidPlatform || isDownloadingUpdate || isReadyToInstall)
  const updateActionLabel = isDownloadingUpdate
    ? `Baixando atualização: ${updatePercent}%`
    : isAndroidPlatform
      ? 'Atualizar Lira'
      : 'Instalar atualização'
  const displayRoomId = isAndroidPlatform && roomId ? roomId.slice(0, 8) : roomId
  const publicationFit = useInlineContentFit(
    !!roomId && isRoomPublic && !isAndroidPlatform,
    JSON.stringify([roomId, isHost, connectionStatus, publicationServers]),
  )

  const handleCopyCode = async () => {
    if (!roomId || copyStatus === 'copying') return
    setCopyStatus('copying')
    try {
      if (!isHost) {
        await navigator.clipboard.writeText(roomId.toUpperCase())
      } else if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
        const text = PeerManager.getInstance().createAllInvite()
        const item = new ClipboardItem({ 'text/plain': text.then(value => new Blob([value], { type: 'text/plain' })) })
        await navigator.clipboard.write([item])
      } else {
        await navigator.clipboard.writeText(await PeerManager.getInstance().createAllInvite())
      }
      setCopyStatus('copied')
    } catch {
      setCopyStatus('error')
    } finally {
      setTimeout(() => setCopyStatus(current => current === 'copying' ? current : 'idle'), 2500)
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
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': link.then(value => new Blob([value], { type: 'text/plain' })),
        })])
      } else await navigator.clipboard.writeText(await link)
      setLinkStatus('copied')
    } catch (error) {
      setLinkStatus('error')
      setLinkError(error instanceof Error ? error.message : 'Não foi possível copiar o link. Tente novamente.')
    } finally {
      setTimeout(() => setLinkStatus(current => current === 'copying' ? current : 'idle'), 3500)
    }
  }

  const openReportIssue = () => {
    setIsMobileMenuOpen(false)
    setIsReportIssueOpen(true)
  }

  const closeReportIssue = () => {
    setIsReportIssueOpen(false)
    const reportButton = reportIssueButtonRef.current
    if (reportButton?.getClientRects().length) reportButton.focus()
    else menuButtonRef.current?.focus()
  }

  return (
    <header className={`h-14 shrink-0 bg-lira-panel border-b border-dashed border-lira-rule/60 px-2 sm:px-4 flex items-center justify-between gap-1 sm:gap-2 select-none relative font-mono text-lira-ink ${isMobileMenuOpen ? 'z-[80]' : 'z-30'}`}>
      <div ref={publicationFit.containerRef} className="flex flex-1 min-w-0 items-center gap-1 sm:gap-2">
        <div className="flex shrink-0 items-center">
          <LiraLogo size={32} showText={true} className="hidden sm:inline-flex" />
          <LiraLogo size={28} showText={false} className="sm:hidden" />
        </div>

        {roomId && <button type="button" onClick={handleCopyLink} disabled={linkStatus === 'copying'}
          aria-busy={linkStatus === 'copying'}
          aria-label={linkStatus === 'copied' ? 'Link do convite copiado' : 'Copiar link do convite'}
          title={linkStatus === 'error' ? linkError : 'Copiar link para abrir o Lira e entrar no espaço'}
          className="flex shrink-0 items-center gap-1.5 rounded-[8px] border border-lira-quiet bg-lira-surface p-2 text-xs font-semibold text-lira-accent transition-colors enabled:hover:border-lira-accent enabled:hover:text-lira-ink disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-lira-accent">
          {linkStatus === 'copying' ? <LoaderCircle className="h-4 w-4 animate-spin" />
            : linkStatus === 'copied' ? <Check className="h-4 w-4 text-lira-online" />
            : linkStatus === 'error' ? <CircleAlert className="h-4 w-4 text-lira-error" />
            : <Link2 className="h-4 w-4" />}
          <span className="sr-only" role="status">{linkStatus === 'error' ? linkError : linkStatus === 'copied' ? 'Link copiado' : ''}</span>
        </button>}

        <CollaborationButtons onAction={() => setIsMobileMenuOpen(false)} />

        {roomId && (
          <button
            onClick={handleCopyCode}
            disabled={copyStatus === 'copying'}
            aria-busy={copyStatus === 'copying'}
            aria-label={copyStatus === 'copying' ? 'Preparando convite' : copyStatus === 'error' ? 'Falha ao copiar. Tente novamente.' : isHost ? 'Copiar convite completo' : 'Copiar ID do espaço'}
            className={`hidden min-[520px]:flex min-w-0 max-w-[360px] items-center gap-1.5 rounded-[8px] border px-2 py-2 text-xs font-semibold transition-colors sm:px-2.5 ${
              isHost ? 'shrink-0 border-lira-quiet bg-lira-surface text-lira-accent hover:border-lira-accent hover:text-lira-ink' : 'border-lira-quiet bg-lira-surface text-lira-ink hover:border-lira-rule'
            }`}
            title={isHost ? 'Copiar convite completo' : `ID do Espaço: ${roomId}\nClique para copiar o ID`}
          >
            {copyStatus === 'copied' ? (
              <Check className="h-4 w-4 shrink-0 text-lira-online" />
            ) : copyStatus === 'copying' ? (
              <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-lira-accent" />
            ) : copyStatus === 'error' ? (
              <CircleAlert className="h-3.5 w-3.5 shrink-0 text-lira-error" />
            ) : (
              <Copy className="h-4 w-4 shrink-0" />
            )}
            {isHost ? (
              <span className="hidden whitespace-nowrap lg:inline">{copyStatus === 'copied' ? 'Convite copiado' : 'Convite completo'}</span>
            ) : (
              <span className="min-w-0 truncate font-mono font-bold text-lira-accent">{displayRoomId}</span>
            )}
          </button>
        )}

        {roomId && isHost && <button type="button" onClick={() => setShowDirectConnection(true)}
          className="hidden min-[520px]:flex shrink-0 items-center gap-1.5 rounded-[8px] border border-lira-quiet bg-lira-surface p-2 text-xs font-semibold text-lira-accent transition-colors hover:border-lira-accent hover:text-lira-ink sm:px-2.5"
          aria-label="Convites individuais" title="Convites individuais">
          <Link2 className="h-4 w-4 shrink-0" />
          <span className="hidden whitespace-nowrap lg:inline">Convites individuais</span>
        </button>}

        {roomId && (
          <button
            onClick={isHost ? toggleRoomPrivacy : undefined}
            disabled={!isHost}
            className={`relative hidden sm:flex shrink-0 min-w-0 overflow-hidden whitespace-nowrap items-center justify-center gap-1.5 ${
              isAndroidPlatform ? 'p-2' : 'p-2 sm:px-2.5 sm:py-1.5'
            } rounded-[8px] border text-xs font-semibold transition-colors ${
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
            {isRoomPublic ? (
              <Globe className="w-3.5 h-3.5 text-lira-accent shrink-0" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-lira-muted shrink-0" />
            )}
            {!isAndroidPlatform && (
              <>
                <span className="hidden sm:inline">{isRoomPublic ? 'Pública' : 'Privada'}</span>
                {isRoomPublic && <span
                  ref={publicationFit.contentRef}
                  aria-label="Servidores de publicação"
                  aria-hidden={!publicationFit.fits}
                  className={`inline-flex w-max shrink-0 items-center gap-1.5 ${publicationFit.fits ? '' : 'absolute invisible pointer-events-none'}`}
                >
                  {publicationServers.map(server => (
                    <span
                      key={server.host}
                      className="inline-block min-w-0 max-w-24 truncate text-[9px] border px-1.5 py-0.5 rounded-[4px] font-bold bg-lira-online/15 text-lira-online border-lira-online/40"
                      aria-label={`Sala publicada em ${server.name}`}
                      title={server.host}
                    >
                      {server.name}
                    </span>
                  ))}
                  {publicationServers.length === 0 && (
                    <span className="text-[9px] text-lira-amber">Aguardando publicação</span>
                  )}
                </span>}
              </>
            )}
          </button>
        )}

        {connectionStatus === 'reconnecting' && (
          <div
            className="flex shrink-0 items-center gap-1.5 px-2 sm:px-2.5 py-2 sm:py-1 bg-lira-amber/15 border border-lira-amber/40 rounded-[8px] text-xs font-semibold text-lira-amber"
            title="Conexão com a rede P2P instável. Tentando reconectar automaticamente..."
          >
            <span className="w-2 h-2 shrink-0 rounded-full bg-lira-amber animate-ping" />
            <span className="hidden md:inline whitespace-nowrap">Reconectando...</span>
          </div>
        )}

        {connectionStatus === 'disconnected' && roomId && (
          <button
            onClick={() => PeerManager.getInstance().reconnect()}
            className="flex shrink-0 items-center gap-1.5 px-2 sm:px-2.5 py-2 sm:py-1 bg-lira-error/15 hover:bg-lira-error/25 border border-lira-error/40 rounded-[8px] text-xs font-semibold text-lira-error transition-colors cursor-pointer"
            title="Conexão com o servidor perdida. Clique para tentar reconectar agora."
          >
            <span className="w-2 h-2 shrink-0 rounded-full bg-lira-error" />
            <span className="hidden md:inline whitespace-nowrap">Desconectado</span>
            <span className="hidden md:inline underline ml-1 font-bold">Reconectar</span>
          </button>
        )}
      </div>

      <div className="hidden 2xl:flex shrink-0 min-w-0 max-w-[140px] min-[1800px]:max-w-[190px] items-center gap-2">
        <div className="flex min-w-0 max-w-full items-center gap-2 px-2.5 py-1.5 bg-lira-ground border border-dashed border-lira-rule/60 rounded-[8px]" title={currentZone ? currentZone.name : 'Corredor Geral'}>
          <div
            className="w-2.5 h-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: currentZone ? currentZone.color : '#6b7280' }}
          />
          <span className="min-w-0 truncate whitespace-nowrap text-xs font-semibold text-lira-ink">
            {currentZone ? currentZone.name : 'Corredor Geral'}
          </span>
        </div>
      </div>

      <div className="hidden 2xl:flex shrink-0 items-center gap-1.5 min-[1800px]:gap-2 whitespace-nowrap">
        {autoSavedNotice && (
          <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] bg-lira-online/15 border border-lira-online/40 text-xs font-semibold text-lira-online" role="status" title="Espaço Salvo!">
            <Check className="w-3.5 h-3.5 shrink-0 text-lira-online" />
            <span className="hidden min-[1800px]:inline">Espaço Salvo!</span>
          </div>
        )}

        <button
          onClick={toggleEditor}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-xs font-semibold border transition-colors ${
            isEditorOpen
              ? 'bg-lira-accent text-lira-ground border-lira-accent font-bold'
              : 'bg-lira-surface text-lira-ink border-lira-quiet hover:border-lira-accent hover:text-lira-accent'
          }`}
          title="Editar Mobília, Pisos e Zonas do Espaço"
        >
          <Edit3 className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden min-[1800px]:inline">{isEditorOpen ? 'Fechar Editor' : 'Editar Espaço'}</span>
        </button>

        <button
          onClick={toggleChat}
          className={`relative p-2 rounded-[8px] border transition-colors ${
            isChatOpen
              ? 'bg-lira-accent text-lira-ground border-lira-accent'
              : 'bg-lira-surface text-lira-ink border-lira-quiet hover:border-lira-accent hover:text-lira-accent'
          }`}
          title="Abrir Chat e Canais"
        >
          <MessageSquare className="w-4 h-4" />
          {totalUnread > 0 && !isChatOpen && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-lira-accent text-lira-ground text-[10px] font-bold flex items-center justify-center">
              {totalUnread}
            </span>
          )}
        </button>

        <button
          onClick={toggleOnlineUsers}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border text-xs font-semibold transition-colors relative ${
            isOnlineUsersOpen
              ? 'bg-lira-accent text-lira-ground border-lira-accent font-bold'
              : totalUnreadDMs > 0
              ? 'bg-lira-error/20 text-lira-error border-lira-error/50 hover:bg-lira-error/30'
              : 'bg-lira-surface hover:border-lira-accent border-lira-quiet text-lira-ink'
          }`}
          title={
            totalUnreadDMs > 0
              ? `Você tem ${totalUnreadDMs} nova(s) mensagem(ns) direta(s)!`
              : 'Ver Participantes Online, Amigos e Gerenciar Permissões'
          }
        >
          <Users className={`w-3.5 h-3.5 ${isOnlineUsersOpen ? 'text-lira-ground' : totalUnreadDMs > 0 ? 'text-lira-error' : 'text-lira-online'}`} />
          <span>{remotePlayerCount + 1}</span>
          {totalUnreadDMs > 0 && !isOnlineUsersOpen && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-lira-error ring-2 ring-lira-panel animate-ping" />
          )}
        </button>

        <UpdateChangelogHover
          updateInfo={updateInfo}
          isUpdateReady={isReadyToInstall}
          isDownloading={isDownloadingUpdate}
          downloadPercent={updatePercent}
          onApplyUpdate={showUpdateAction && onApplyUpdate ? onApplyUpdate : undefined}
        >
          {showUpdateAction && onApplyUpdate ? (
            <button
              type="button"
              disabled={isUpdating || isDownloadingUpdate}
              className="p-2 rounded-[8px] bg-lira-online/15 hover:bg-lira-online/25 border border-lira-online/40 text-lira-online transition-colors disabled:opacity-75 disabled:cursor-wait cursor-pointer"
              aria-label={updateActionLabel}
              title={isDownloadingUpdate ? updateActionLabel : 'Nova versão disponível. Passe o mouse ou clique para ver novidades e instalar.'}
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
              onClick={(e) => { e.stopPropagation(); checkNow() }}
              disabled={manualCheck === 'checking'}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-quiet text-lira-ink text-xs font-semibold select-none transition-colors cursor-pointer disabled:cursor-wait"
              title={`Versão atual do Lira: ${currentVersion}. Clique para verificar atualizações.`}
            >
              {manualCheck === 'checking' ? (
                <RefreshCw className="w-3 h-3 animate-spin text-lira-muted" />
              ) : (
                <span className={`w-1.5 h-1.5 rounded-full ${manualCheck === 'failed' ? 'bg-lira-error' : 'bg-lira-online'}`} />
              )}
              <span className="font-mono text-[11px] text-lira-muted">{versionBadgeLabel(manualCheck, currentVersion)}</span>
            </button>
          )}
        </UpdateChangelogHover>

        <div
          className="flex items-center px-2 py-1.5 bg-lira-surface border border-lira-quiet rounded-[8px] hover:border-lira-rule transition-colors"
          title={`Sua Conexão:\nPing: ${localQuality.pingMs > 0 ? `${localQuality.pingMs}ms` : '<10ms'}\nPerda de pacotes: ${localQuality.lossPct}%\nQualidade: ${localQuality.rating}`}
        >
          <NetworkSignalIcon
            rating={localQuality.rating}
            pingMs={localQuality.pingMs}
            lossPct={localQuality.lossPct}
            showPingText={true}
            size="sm"
          />
        </div>

        <button
          onClick={() => useMediaStore.getState().setSettingsModalOpen(true)}
          className="p-2 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-quiet text-lira-muted hover:text-lira-ink transition-colors group"
          title="Configurações de Áudio e Chamada"
        >
          <Settings className="w-4 h-4 text-lira-muted group-hover:text-lira-accent transition-colors" />
        </button>

        <ThemeToggle size="sm" className="h-8 w-8" />

        <button
          onClick={onOpenAvatarModal}
          title={`Editar perfil: ${localPlayerName}`}
          className="flex shrink-0 items-center gap-2 px-2 min-[1800px]:pr-3 py-1 bg-lira-surface hover:border-lira-accent border border-lira-quiet rounded-[8px] transition-colors group"
        >
          <PlayerAvatar
            name={localPlayerName}
            profilePicture={localPlayerProfilePicture}
            avatar={localPlayerAvatar}
            status={localPlayerStatus}
            showStatus={true}
            size="sm"
          />
          <div className="hidden min-[1800px]:block min-w-0 max-w-[80px] text-left">
            <div className="truncate font-display text-xs font-bold text-lira-ink group-hover:text-lira-accent leading-tight">
              {localPlayerName}
            </div>
            <div className="text-[10px] font-mono text-lira-muted leading-tight truncate max-w-[80px]">
              {localPlayerStatusText}
            </div>
          </div>
        </button>

        {onDisconnect && (
          <button
            onClick={onDisconnect}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-lira-surface hover:bg-lira-error hover:text-lira-ground border border-lira-error/40 text-lira-error rounded-[8px] text-xs font-bold transition-colors group"
            title="Sair / Desconectar deste espaço"
          >
            <LogOut className="w-3.5 h-3.5 text-current transition-colors" />
            <span className="hidden min-[1800px]:inline">Sair</span>
          </button>
        )}
      </div>

      <button
        ref={reportIssueButtonRef}
        type="button"
        aria-label="Reportar erro"
        aria-haspopup="dialog"
        title="Reportar erro"
        onClick={openReportIssue}
        className="hidden min-[520px]:flex shrink-0 items-center rounded-[8px] border border-lira-quiet bg-lira-surface p-2 text-lira-muted transition-colors hover:border-lira-accent hover:text-lira-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-lira-accent"
      >
        <Bug className="h-4 w-4 text-lira-error" aria-hidden="true" />
      </button>

      <div className="flex 2xl:hidden shrink-0 items-center gap-1 sm:gap-1.5">
        <button
          onClick={() => { setIsMobileMenuOpen(false); toggleChat() }}
          className={`relative p-2 rounded-[8px] border transition-colors ${
            isChatOpen
              ? 'bg-lira-accent text-lira-ground border-lira-accent'
              : 'bg-lira-surface text-lira-ink border-lira-quiet hover:border-lira-accent'
          }`}
          title="Abrir Chat"
        >
          <MessageSquare className="w-4 h-4" />
          {totalUnread > 0 && !isChatOpen && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-lira-accent text-lira-ground text-[10px] font-bold flex items-center justify-center">
              {totalUnread}
            </span>
          )}
        </button>

        <button
          onClick={() => { setIsMobileMenuOpen(false); toggleOnlineUsers() }}
          className={`flex items-center gap-1 p-2 rounded-[8px] border text-xs font-semibold transition-colors relative ${
            isOnlineUsersOpen
              ? 'bg-lira-accent text-lira-ground border-lira-accent'
              : totalUnreadDMs > 0
              ? 'bg-lira-error/20 text-lira-error border-lira-error/50'
              : 'bg-lira-surface border-lira-quiet text-lira-ink'
          }`}
          title="Participantes Online"
        >
          <Users className="w-4 h-4" />
          <span className="text-[11px] font-bold">{remotePlayerCount + 1}</span>
          {totalUnreadDMs > 0 && !isOnlineUsersOpen && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-lira-error ring-2 ring-lira-panel animate-ping" />
          )}
        </button>

        <button
          ref={menuButtonRef}
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-expanded={isMobileMenuOpen}
          aria-controls="space-navigation-menu"
          className={`p-2 rounded-[8px] border transition-colors relative ${
            isMobileMenuOpen
              ? 'bg-lira-accent text-lira-ground border-lira-accent'
              : 'bg-lira-surface border-lira-quiet text-lira-ink hover:border-lira-accent'
          }`}
          title="Mais opções e menus"
        >
          {isMobileMenuOpen ? <X className="w-4 h-4 text-lira-ground" /> : <Menu className="w-4 h-4" />}
          {(showUpdateAction || totalUnreadDMs > 0) && !isMobileMenuOpen && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-lira-online" />
          )}
        </button>
      </div>

      {isMobileMenuOpen && (
        <>
        <div className="absolute inset-x-0 top-14 h-[calc(100dvh-3.5rem)] bg-lira-ground/80 z-40 2xl:hidden" aria-hidden="true" onClick={() => setIsMobileMenuOpen(false)} />
        <div id="space-navigation-menu" role="region" aria-label="Menu do espaço" className="absolute inset-x-0 top-14 bg-lira-panel border-b border-dashed border-lira-rule p-3 sm:p-4 z-50 flex flex-col gap-3 max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain select-none 2xl:hidden">
          {roomId && <div className="flex flex-wrap items-center gap-2 min-[520px]:hidden">
            <button type="button" onClick={handleCopyCode} disabled={copyStatus === 'copying'} aria-busy={copyStatus === 'copying'}
              aria-label={isHost ? 'Copiar convite completo' : 'Copiar ID do espaço'}
              className="flex items-center gap-2 rounded-[8px] border border-lira-rule bg-lira-surface p-2 text-xs font-semibold text-lira-accent hover:border-lira-accent hover:text-lira-ink disabled:opacity-50">
              {copyStatus === 'copied' ? <Check size={16} /> : copyStatus === 'copying' ? <LoaderCircle size={16} className="animate-spin" /> : <Copy size={16} />}
              <span>{copyStatus === 'copied' ? 'Convite copiado' : isHost ? 'Convite completo' : 'Copiar ID do espaço'}</span>
            </button>
            {isHost && <button type="button" onClick={() => setShowDirectConnection(true)} aria-label="Convites individuais"
              className="flex items-center gap-2 rounded-[8px] border border-lira-rule bg-lira-surface p-2 text-xs font-semibold text-lira-accent hover:border-lira-accent hover:text-lira-ink">
              <Link2 size={16} /><span>Convites individuais</span>
            </button>}
            <span className="sr-only" role="status">{copyStatus === 'error' ? 'Falha ao copiar. Tente novamente.' : copyStatus === 'copied' ? 'Convite copiado' : ''}</span>
          </div>}
          <button type="button"
            onClick={() => {
              setIsMobileMenuOpen(false)
              onOpenAvatarModal()
            }}
            className="flex shrink-0 w-full items-center justify-between gap-3 p-3 rounded-[12px] bg-lira-surface border border-lira-rule text-left cursor-pointer hover:border-lira-accent transition-colors"
          >
            <div className="flex min-w-0 items-center gap-3">
              <PlayerAvatar
                name={localPlayerName}
                profilePicture={localPlayerProfilePicture}
                avatar={localPlayerAvatar}
                status={localPlayerStatus}
                showStatus={true}
                size="md"
              />
              <div className="min-w-0">
                <div className="truncate font-display text-sm font-bold text-lira-ink" title={localPlayerName}>{localPlayerName}</div>
                <div className="truncate text-xs text-lira-muted">{localPlayerStatusText}</div>
              </div>
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs text-lira-accent font-semibold px-2 py-1 rounded-[6px] bg-lira-ground border border-lira-rule">
              Editar Perfil
            </span>
          </button>

          <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 rounded-[8px] bg-lira-ground border border-dashed border-lira-rule/60 text-xs">
            <span className="shrink-0 text-lira-muted">Local Atual:</span>
            <span className="min-w-0 font-bold text-lira-ink flex items-center justify-end gap-1.5" title={currentZone ? currentZone.name : 'Corredor Geral'}>
              <div
                className="w-2.5 h-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: currentZone ? currentZone.color : '#6b7280' }}
              />
              <span className="min-w-0 truncate">{currentZone ? currentZone.name : 'Corredor Geral'}</span>
            </span>
          </div>

          <div className="flex shrink-0 flex-col gap-2 pt-1">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={openReportIssue}
              className="flex min-[520px]:hidden items-center gap-2.5 w-full p-3 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-quiet text-xs font-semibold text-lira-ink transition-colors text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-lira-accent"
            >
              <Bug className="h-4 w-4 shrink-0 text-lira-error" aria-hidden="true" />
              <span>Reportar erro</span>
            </button>

            <button
              onClick={() => {
                setIsMobileMenuOpen(false)
                useMediaStore.getState().setSettingsModalOpen(true)
              }}
              className="flex items-center gap-2.5 w-full p-3 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-quiet text-xs font-semibold text-lira-ink transition-colors text-left"
            >
              <Settings className="w-4 h-4 shrink-0 text-lira-accent" />
              <span>Configurações de Áudio e Chamada</span>
            </button>

            <button
              onClick={() => {
                setIsMobileMenuOpen(false)
                toggleEditor()
              }}
              className={`flex items-center gap-2.5 w-full p-3 rounded-[8px] text-xs font-semibold border transition-colors text-left ${
                isEditorOpen
                  ? 'bg-lira-accent text-lira-ground border-lira-accent font-bold'
                  : 'bg-lira-surface text-lira-ink border-lira-quiet hover:border-lira-accent'
              }`}
            >
              <Edit3 className={`w-4 h-4 shrink-0 ${isEditorOpen ? 'text-lira-ground' : 'text-lira-accent'}`} />
              <span>{isEditorOpen ? 'Fechar Editor do Espaço' : 'Editar Mobílias e Salas'}</span>
            </button>

            {roomId && isHost && (
              <button
                onClick={() => {
                  toggleRoomPrivacy()
                }}
                className="flex items-center justify-between gap-2 w-full p-3 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-quiet text-xs font-semibold text-lira-ink transition-colors text-left"
              >
                <span className="flex items-center gap-2.5">
                  {isRoomPublic ? <Globe className="w-4 h-4 shrink-0 text-lira-accent" /> : <Lock className="w-4 h-4 shrink-0 text-lira-muted" />}
                  <span>Privacidade da Sala: {isRoomPublic ? 'Pública' : 'Privada'}</span>
                </span>
                <span className="shrink-0 text-[10px] text-lira-accent underline font-bold">Alternar</span>
              </button>
            )}

            <ThemeToggle showLabel size="sm" className="w-full justify-between px-3 py-2.5 h-auto rounded-[8px]" />

            <div className="flex items-center justify-between gap-3 p-3 rounded-[8px] bg-lira-ground border border-dashed border-lira-rule/60 text-xs">
              <span className="text-lira-muted">Qualidade da Conexão:</span>
              <NetworkSignalIcon
                rating={localQuality.rating}
                pingMs={localQuality.pingMs}
                lossPct={localQuality.lossPct}
                showPingText={true}
                size="sm"
                className="shrink-0"
              />
            </div>

            {!(showUpdateAction && onApplyUpdate) && (
              <button type="button" onClick={() => checkNow()} disabled={manualCheck === 'checking'}
                className="flex items-center justify-between gap-3 w-full p-3 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-quiet text-xs font-semibold text-lira-ink text-left disabled:cursor-wait">
                <span className="flex items-center gap-2.5">
                  <RefreshCw className={`w-4 h-4 shrink-0 text-lira-accent ${manualCheck === 'checking' ? 'animate-spin' : ''}`} />
                  <span>Verificar atualizações</span>
                </span>
                <span className="shrink-0 text-[11px] font-mono text-lira-muted">{versionBadgeLabel(manualCheck, currentVersion)}</span>
              </button>
            )}

            {showUpdateAction && onApplyUpdate && (
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  onApplyUpdate()
                }}
                disabled={isUpdating || isDownloadingUpdate}
                aria-label={updateActionLabel}
                title={isDownloadingUpdate ? updateActionLabel : undefined}
                className="flex items-center justify-between gap-3 w-full p-3 rounded-[8px] bg-lira-online/20 hover:bg-lira-online/30 border border-lira-online text-lira-online font-bold text-xs transition-colors disabled:cursor-wait disabled:opacity-75"
              >
                <span className="flex items-center gap-2">
                  <UpdateDownloadIndicator downloading={isDownloadingUpdate} percent={updatePercent} />
                  <span>{isDownloadingUpdate ? 'Baixando atualização' : isAndroidPlatform ? 'Nova Atualização Disponível' : 'Atualização pronta para instalar'}</span>
                </span>
                <span className={isDownloadingUpdate ? 'tabular-nums' : 'underline'}>{isDownloadingUpdate ? `${updatePercent}%` : isAndroidPlatform ? 'Atualizar' : 'Instalar'}</span>
              </button>
            )}

            {onDisconnect && (
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  onDisconnect()
                }}
                className="flex items-center justify-center gap-2 w-full p-3 mt-1 rounded-[8px] bg-lira-surface hover:bg-lira-error hover:text-lira-ground border border-lira-error/50 text-lira-error font-bold text-xs transition-colors cursor-pointer group"
              >
                <LogOut className="w-4 h-4 shrink-0 text-current" />
                <span>Sair / Desconectar do Espaço</span>
              </button>
            )}
          </div>
        </div>
        </>
      )}
      {showDirectConnection && <dialog
        ref={directConnectionDialogRef}
        aria-labelledby="direct-connection-title"
        className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-xl select-text flex-col overflow-hidden rounded-[12px] border border-dashed border-lira-rule bg-lira-panel p-0 font-mono text-lira-ink open:flex backdrop:bg-lira-ground/80"
        onClose={() => setShowDirectConnection(false)}
        onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close() }}>
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-dashed border-lira-rule/60 px-4 py-2.5 sm:px-5">
          <h2 id="direct-connection-title" className="font-display text-lg font-bold text-lira-accent">Convites individuais</h2>
          <button type="button" aria-label="Fechar convites individuais" onClick={() => directConnectionDialogRef.current?.close()}
            className="rounded-[8px] border border-transparent p-2.5 text-lira-muted hover:border-lira-quiet hover:bg-lira-surface hover:text-lira-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-lira-accent">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
          <DirectConnectionPanel role="host" />
        </div>
      </dialog>}
      {isReportIssueOpen && typeof document !== 'undefined' && createPortal(<ReportIssueModal isOpen onClose={closeReportIssue} />, document.body)}
    </header>
  )
}
