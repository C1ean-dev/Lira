import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Copy,
  Check,
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
import { isAndroid } from '../utils/platform'
import { useRoomPublication } from '../hooks/useRoomPublication'

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

  const [copied, setCopied] = useState(false)
  const [autoSavedNotice, setAutoSavedNotice] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const prevEditorOpenRef = useRef(isEditorOpen)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

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
      if (event.key !== 'Escape') return
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

  const handleCopyCode = async () => {
    if (!roomId) return
    try {
      await navigator.clipboard.writeText(roomId.toUpperCase())
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch (e) {
      console.warn('Could not copy room ID:', e)
    }
  }

  return (
    <header className={`h-14 shrink-0 bg-[#12151d]/90 backdrop-blur-md border-b border-[#2a3142] px-3 sm:px-4 flex items-center justify-between gap-2 select-none relative ${isMobileMenuOpen ? 'z-[80]' : 'z-30'}`}>
      <div className="flex flex-1 min-w-0 items-center gap-1.5 sm:gap-3">
        <div className="flex shrink-0 items-center">
          <LiraLogo size={32} showText={true} className="hidden sm:inline-flex" />
          <LiraLogo size={28} showText={false} className="sm:hidden" />
        </div>

        {roomId && (
          <button
            onClick={handleCopyCode}
            className="flex flex-1 min-w-0 max-w-[360px] items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 bg-[#1b202c] hover:bg-slate-800 border border-[#2a3142] rounded-xl text-xs font-semibold text-slate-200 transition-all group cursor-pointer"
            title={`ID do Espaço: ${roomId}\n(Clique para copiar tudo)`}
          >
            {!isAndroidPlatform && <span className="text-slate-400 font-normal whitespace-nowrap shrink-0 hidden xl:inline 2xl:hidden min-[1800px]:inline">ID do Espaço:</span>}
            <span className="font-mono text-indigo-300 font-bold min-w-0 truncate">{displayRoomId}</span>
            {copied ? (
              <span className="flex shrink-0 items-center gap-1 text-emerald-400 font-bold text-[11px] animate-in fade-in">
                <Check className="w-3.5 h-3.5 shrink-0" />
                {!isAndroidPlatform && <span className="hidden sm:inline">Copiado!</span>}
              </span>
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 shrink-0" />
            )}
          </button>
        )}

        {roomId && (
          <button
            onClick={isHost ? toggleRoomPrivacy : undefined}
            disabled={!isHost}
            className={`flex shrink-0 min-w-0 max-w-[260px] whitespace-nowrap items-center justify-center gap-1.5 ${
              isAndroidPlatform ? 'p-2' : 'p-2 sm:px-3 sm:py-1.5'
            } rounded-xl border text-xs font-semibold transition-all ${
              isRoomPublic
                ? 'bg-blue-500/15 border-blue-500/40 text-blue-300 hover:bg-blue-500/25'
                : 'bg-[#1b202c] border-[#2a3142] text-slate-300 hover:bg-slate-800'
            } ${!isHost ? 'cursor-default opacity-80' : 'cursor-pointer hover:scale-105 active:scale-95'}`}
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
              <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
            {!isAndroidPlatform && (
              <>
                <span className="hidden sm:inline">{isRoomPublic ? 'Pública' : 'Privada'}</span>
                {isRoomPublic && publicationServers.map(server => (
                  <span
                    key={server.host}
                    className="hidden min-[1800px]:inline-block min-w-0 max-w-24 truncate text-[9px] border px-1.5 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                    aria-label={`Sala publicada em ${server.name}`}
                    title={server.host}
                  >
                    {server.name}
                  </span>
                ))}
                {isRoomPublic && publicationServers.length === 0 && (
                  <span className="hidden min-[1800px]:inline text-[9px] text-amber-300">Aguardando publicação</span>
                )}
              </>
            )}
          </button>
        )}

        {connectionStatus === 'reconnecting' && (
          <div
            className="flex shrink-0 items-center gap-1.5 px-2 sm:px-3 py-2 sm:py-1 bg-amber-500/15 border border-amber-500/40 rounded-xl text-xs font-semibold text-amber-300 animate-pulse"
            title="Conexão com a rede P2P instável. Tentando reconectar automaticamente..."
          >
            <span className="w-2 h-2 shrink-0 rounded-full bg-amber-400 animate-ping" />
            <span className="hidden md:inline whitespace-nowrap">Reconectando...</span>
          </div>
        )}

        {connectionStatus === 'disconnected' && roomId && (
          <button
            onClick={() => PeerManager.getInstance().scheduleSignalingReconnect()}
            className="flex shrink-0 items-center gap-1.5 px-2 sm:px-3 py-2 sm:py-1 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 rounded-xl text-xs font-semibold text-rose-300 transition-all cursor-pointer shadow-sm active:scale-95"
            title="Conexão com o servidor perdida. Clique para tentar reconectar agora."
          >
            <span className="w-2 h-2 shrink-0 rounded-full bg-rose-500" />
            <span className="hidden md:inline whitespace-nowrap">Desconectado</span>
            <span className="hidden md:inline underline ml-1 font-bold">Reconectar</span>
          </button>
        )}
      </div>

      <div className="hidden 2xl:flex shrink-0 min-w-0 max-w-[190px] items-center gap-2">
        <div className="flex min-w-0 max-w-full items-center gap-2 px-3 py-1.5 bg-[#1b202c]/60 border border-[#2a3142] rounded-full" title={currentZone ? currentZone.name : 'Corredor Geral'}>
          <div
            className="w-2.5 h-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: currentZone ? currentZone.color : '#6b7280' }}
          />
          <span className="min-w-0 truncate whitespace-nowrap text-xs font-semibold text-slate-200">
            {currentZone ? currentZone.name : 'Corredor Geral'}
          </span>
        </div>
      </div>

      <div className="hidden 2xl:flex shrink-0 items-center gap-2.5 whitespace-nowrap">
        {autoSavedNotice && (
          <div className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-xs font-semibold text-emerald-300 animate-in fade-in duration-200" role="status" title="Espaço Salvo!">
            <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
            <span className="hidden min-[1800px]:inline">Espaço Salvo!</span>
          </div>
        )}

        <button
          onClick={toggleEditor}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
            isEditorOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
              : 'bg-[#1b202c] text-slate-300 border-[#2a3142] hover:bg-slate-800'
          }`}
          title="Editar Mobília, Pisos e Zonas do Espaço"
        >
          <Edit3 className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden min-[1800px]:inline">{isEditorOpen ? 'Fechar Editor' : 'Editar Espaço'}</span>
        </button>

        <button
          onClick={toggleChat}
          className={`relative p-2 rounded-xl border transition-all ${
            isChatOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
              : 'bg-[#1b202c] text-slate-300 border-[#2a3142] hover:bg-slate-800'
          }`}
          title="Abrir Chat e Canais"
        >
          <MessageSquare className="w-4 h-4" />
          {totalUnread > 0 && !isChatOpen && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center animate-bounce">
              {totalUnread}
            </span>
          )}
        </button>

        <button
          onClick={toggleOnlineUsers}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all relative ${
            isOnlineUsersOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30 ring-2 ring-indigo-500/30'
              : totalUnreadDMs > 0
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 hover:bg-rose-500/30 animate-pulse'
              : 'bg-[#1b202c] hover:bg-slate-800 border-[#2a3142] text-slate-300 hover:text-white'
          }`}
          title={
            totalUnreadDMs > 0
              ? `Você tem ${totalUnreadDMs} nova(s) mensagem(ns) direta(s)!`
              : 'Ver Participantes Online, Amigos e Gerenciar Permissões'
          }
        >
          <Users className={`w-3.5 h-3.5 ${isOnlineUsersOpen ? 'text-white' : totalUnreadDMs > 0 ? 'text-rose-400' : 'text-emerald-400'}`} />
          <span>{remotePlayerCount + 1}</span>
          {totalUnreadDMs > 0 && !isOnlineUsersOpen && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-[#12151d] animate-ping" />
          )}
        </button>

        {showUpdateAction && onApplyUpdate ? (
          <button
            onClick={onApplyUpdate}
            disabled={isUpdating || isDownloadingUpdate}
            className="p-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 transition-all hover:scale-105 shadow-sm shadow-emerald-500/20 disabled:opacity-75 disabled:cursor-wait cursor-pointer"
            aria-label={updateActionLabel}
            title={isDownloadingUpdate ? updateActionLabel : isAndroidPlatform ? 'Nova atualização disponível! Clique para atualizar agora.' : 'Atualização pronta. Clique para instalar.'}
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
            onClick={() => checkNow()}
            disabled={manualCheck === 'checking'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#1b202c] hover:bg-[#232a3a] border border-[#2a3142] text-slate-300 text-xs font-semibold select-none transition-colors cursor-pointer disabled:cursor-wait"
            title={`Versão atual do Lira: ${currentVersion}. Clique para verificar atualizações.`}
          >
            {manualCheck === 'checking' ? (
              <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />
            ) : (
              <span className={`w-1.5 h-1.5 rounded-full ${manualCheck === 'failed' ? 'bg-rose-400' : 'bg-emerald-400'}`} />
            )}
            <span className="font-mono text-[11px] text-slate-400">{versionBadgeLabel(manualCheck, currentVersion)}</span>
          </button>
        )}

        <div
          className="flex items-center px-2.5 py-1.5 bg-[#1b202c] border border-[#2a3142] rounded-xl hover:bg-slate-800 transition-colors"
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
          className="p-2 rounded-xl bg-[#1b202c] hover:bg-slate-800 border border-[#2a3142] text-slate-300 hover:text-white transition-all group"
          title="Configurações de Áudio e Chamada"
        >
          <Settings className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 group-hover:rotate-45 transition-transform" />
        </button>

        <button
          onClick={onOpenAvatarModal}
          title={`Editar perfil: ${localPlayerName}`}
          className="flex shrink-0 items-center gap-2 px-2 min-[1800px]:pr-3 py-1 bg-[#1b202c] hover:bg-slate-800 border border-[#2a3142] rounded-xl transition-all group"
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
            <div className="truncate text-xs font-bold text-slate-200 group-hover:text-white leading-tight">
              {localPlayerName}
            </div>
            <div className="text-[10px] text-slate-400 leading-tight truncate max-w-[80px]">
              {localPlayerStatusText}
            </div>
          </div>
        </button>

        {onDisconnect && (
          <button
            onClick={onDisconnect}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/40 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 hover:text-rose-100 rounded-xl text-xs font-bold transition-all active:scale-95 group shadow-sm hover:shadow-rose-500/20"
            title="Sair / Desconectar deste espaço"
          >
            <LogOut className="w-3.5 h-3.5 text-rose-400 group-hover:text-rose-200 transition-colors" />
            <span className="hidden min-[1800px]:inline">Sair</span>
          </button>
        )}
      </div>

      <div className="flex 2xl:hidden shrink-0 items-center gap-1.5">
        <button
          onClick={() => { setIsMobileMenuOpen(false); toggleChat() }}
          className={`relative p-2 rounded-xl border transition-all ${
            isChatOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
              : 'bg-[#1b202c] text-slate-300 border-[#2a3142] hover:bg-slate-800'
          }`}
          title="Abrir Chat"
        >
          <MessageSquare className="w-4 h-4" />
          {totalUnread > 0 && !isChatOpen && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-indigo-500 text-white text-[10px] font-bold flex items-center justify-center animate-bounce">
              {totalUnread}
            </span>
          )}
        </button>

        <button
          onClick={() => { setIsMobileMenuOpen(false); toggleOnlineUsers() }}
          className={`flex items-center gap-1 p-2 rounded-xl border text-xs font-semibold transition-all relative ${
            isOnlineUsersOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
              : totalUnreadDMs > 0
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 animate-pulse'
              : 'bg-[#1b202c] border-[#2a3142] text-slate-300'
          }`}
          title="Participantes Online"
        >
          <Users className="w-4 h-4" />
          <span className="text-[11px] font-bold">{remotePlayerCount + 1}</span>
          {totalUnreadDMs > 0 && !isOnlineUsersOpen && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-[#12151d] animate-ping" />
          )}
        </button>

        <button
          ref={menuButtonRef}
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-expanded={isMobileMenuOpen}
          aria-controls="space-navigation-menu"
          className={`p-2 rounded-xl border transition-all relative ${
            isMobileMenuOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
              : 'bg-[#1b202c] border-[#2a3142] text-slate-300 hover:text-white'
          }`}
          title="Mais opções e menus"
        >
          {isMobileMenuOpen ? <X className="w-4 h-4 text-white" /> : <Menu className="w-4 h-4" />}
          {(showUpdateAction || totalUnreadDMs > 0) && !isMobileMenuOpen && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>
      </div>

      {isMobileMenuOpen && (
        <>
        <div className="absolute inset-x-0 top-14 h-[calc(100dvh-3.5rem)] bg-black/50 z-40 2xl:hidden" aria-hidden="true" onClick={() => setIsMobileMenuOpen(false)} />
        <div id="space-navigation-menu" role="region" aria-label="Menu do espaço" className="absolute inset-x-0 top-14 bg-[#12151d] border-b border-[#394359] p-3 sm:p-4 z-50 shadow-2xl flex flex-col gap-3 max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain select-none 2xl:hidden">
          <button type="button"
            onClick={() => {
              setIsMobileMenuOpen(false)
              onOpenAvatarModal()
            }}
            className="flex shrink-0 w-full items-center justify-between gap-3 p-3 rounded-2xl bg-[#1b202c] border border-[#475569] text-left cursor-pointer hover:border-indigo-400 transition-colors"
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
                <div className="truncate text-sm font-bold text-slate-100" title={localPlayerName}>{localPlayerName}</div>
                <div className="truncate text-xs text-slate-300">{localPlayerStatusText}</div>
              </div>
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs text-indigo-200 font-semibold px-2 py-1 rounded-lg bg-indigo-950 border border-indigo-700">
              Editar Perfil
            </span>
          </button>

          <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 rounded-xl bg-[#181d28] border border-[#394359] text-xs">
            <span className="shrink-0 text-slate-300">Local Atual:</span>
            <span className="min-w-0 font-bold text-slate-100 flex items-center justify-end gap-1.5" title={currentZone ? currentZone.name : 'Corredor Geral'}>
              <div
                className="w-2.5 h-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: currentZone ? currentZone.color : '#6b7280' }}
              />
              <span className="min-w-0 truncate">{currentZone ? currentZone.name : 'Corredor Geral'}</span>
            </span>
          </div>

          <div className="flex shrink-0 flex-col gap-2 pt-1">
            <button
              onClick={() => {
                setIsMobileMenuOpen(false)
                useMediaStore.getState().setSettingsModalOpen(true)
              }}
              className="flex items-center gap-2.5 w-full p-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-slate-100 transition-colors text-left"
            >
              <Settings className="w-4 h-4 shrink-0 text-indigo-300" />
              <span>Configurações de Áudio e Chamada</span>
            </button>

            <button
              onClick={() => {
                setIsMobileMenuOpen(false)
                toggleEditor()
              }}
              className={`flex items-center gap-2.5 w-full p-3 rounded-xl text-xs font-semibold border transition-colors text-left ${
                isEditorOpen
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-slate-800 text-slate-100 border-slate-600 hover:bg-slate-700'
              }`}
            >
              <Edit3 className={`w-4 h-4 shrink-0 ${isEditorOpen ? 'text-white' : 'text-indigo-300'}`} />
              <span>{isEditorOpen ? 'Fechar Editor do Espaço' : 'Editar Mobílias e Salas'}</span>
            </button>

            {roomId && isHost && (
              <button
                onClick={() => {
                  toggleRoomPrivacy()
                }}
                className="flex items-center justify-between gap-2 w-full p-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-slate-100 transition-colors text-left"
              >
                <span className="flex items-center gap-2.5">
                  {isRoomPublic ? <Globe className="w-4 h-4 shrink-0 text-blue-300" /> : <Lock className="w-4 h-4 shrink-0 text-slate-300" />}
                  <span>Privacidade da Sala: {isRoomPublic ? 'Pública' : 'Privada'}</span>
                </span>
                <span className="shrink-0 text-[10px] text-indigo-200 underline font-bold">Alternar</span>
              </button>
            )}

            <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#181d28] border border-[#394359] text-xs">
              <span className="text-slate-300">Qualidade da Conexão:</span>
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
                className="flex items-center justify-between gap-3 w-full p-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold text-slate-100 text-left disabled:cursor-wait">
                <span className="flex items-center gap-2.5">
                  <RefreshCw className={`w-4 h-4 shrink-0 text-indigo-300 ${manualCheck === 'checking' ? 'animate-spin' : ''}`} />
                  <span>Verificar atualizações</span>
                </span>
                <span className="shrink-0 text-[11px] font-mono text-slate-200">{versionBadgeLabel(manualCheck, currentVersion)}</span>
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
                className="flex items-center justify-between gap-3 w-full p-3 rounded-xl bg-emerald-700 hover:bg-emerald-600 border border-emerald-500 text-white font-bold text-xs transition-colors disabled:cursor-wait disabled:opacity-75"
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
                className="flex items-center justify-center gap-2 w-full p-3 mt-1 rounded-xl bg-rose-950 hover:bg-rose-900 border border-rose-500 text-rose-100 font-bold text-xs transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4 shrink-0 text-rose-200" />
                <span>Sair / Desconectar do Espaço</span>
              </button>
            )}
          </div>
        </div>
        </>
      )}
    </header>
  )
}
