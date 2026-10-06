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
  Download,
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
import { isAndroid } from '../utils/platform'

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
  // Granular selectors: subscribing to whole localPlayer/remotePlayers would
  // re-render this bar at 60Hz on every movement frame. Select only UI fields.
  const localPlayerName = useGameStore((s) => s.localPlayer.name)
  const localPlayerProfilePicture = useGameStore((s) => s.localPlayer.profilePicture)
  const localPlayerAvatar = useGameStore((s) => s.localPlayer.avatar)
  const localPlayerStatus = useGameStore((s) => s.localPlayer.status)
  const localPlayerStatusText = useGameStore((s) => s.localPlayer.statusText)
  const localPlayerCurrentZoneId = useGameStore((s) => s.localPlayer.currentZoneId)
  const roomId = useGameStore((s) => s.roomId)
  const updateInfo = useUpdateStore((s) => s.updateInfo)
  const manualCheck = useUpdateStore((s) => s.manualCheck)
  const checkNow = useUpdateStore((s) => s.checkNow)
  const rawVersion = updateInfo?.currentVersion || CURRENT_APP_VERSION
  const currentVersion = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`
  const isOwner = useGameStore((s) => s.isOwner)
  const isRoomPublic = useGameStore((s) => s.isRoomPublic)
  const toggleRoomPrivacy = useGameStore((s) => s.toggleRoomPrivacy)
  const isOnlineUsersOpen = useGameStore((s) => s.isOnlineUsersOpen)
  const toggleOnlineUsers = useGameStore((s) => s.toggleOnlineUsers)
  const remotePlayerCount = useGameStore((s) => Object.keys(s.remotePlayers).length)
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

  useEffect(() => {
    if (prevEditorOpenRef.current && !isEditorOpen) {
      setAutoSavedNotice(true)
      const t = setTimeout(() => setAutoSavedNotice(false), 2400)
      return () => clearTimeout(t)
    }
    prevEditorOpenRef.current = isEditorOpen
  }, [isEditorOpen])

  const currentZone = mapZones.find((z) => z.id === localPlayerCurrentZoneId)
  const isAndroidPlatform = isAndroid()
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
    <header className="h-14 bg-[#12151d]/90 backdrop-blur-md border-b border-[#2a3142] px-3 sm:px-4 flex items-center justify-between z-30 select-none relative">
      {/* Left: Brand + Room Code + Privacy Toggle */}
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="flex items-center">
          <LiraLogo size={32} showText={true} className="hidden sm:inline-flex" />
          <LiraLogo size={28} showText={false} className="sm:hidden" />
        </div>

        {/* Room ID Badge */}
        {roomId && (
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 bg-[#1b202c] hover:bg-slate-800 border border-[#2a3142] rounded-xl text-xs font-semibold text-slate-200 transition-all group cursor-pointer"
            title={`ID do Espaço: ${roomId}\n(Clique para copiar tudo)`}
          >
            {!isAndroidPlatform && <span className="text-slate-400 font-normal hidden sm:inline">ID do Espaço:</span>}
            <span className="font-mono text-indigo-400 font-bold max-w-[85px] sm:max-w-[220px] truncate">{displayRoomId}</span>
            {copied ? (
              <span className="flex items-center gap-1 text-emerald-400 font-bold text-[11px] animate-in fade-in">
                <Check className="w-3.5 h-3.5 shrink-0" />
                {!isAndroidPlatform && <span className="hidden sm:inline">Copiado!</span>}
              </span>
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 shrink-0" />
            )}
          </button>
        )}

        {/* Room Privacy Toggle Badge (Owner can switch Public / Private) */}
        {roomId && (
          <button
            onClick={isOwner ? toggleRoomPrivacy : undefined}
            disabled={!isOwner}
            className={`flex items-center justify-center ${
              isAndroidPlatform ? 'p-2' : 'hidden sm:flex items-center gap-1.5 px-3 py-1.5'
            } rounded-xl border text-xs font-semibold transition-all ${
              isRoomPublic
                ? 'bg-blue-500/15 border-blue-500/40 text-blue-300 hover:bg-blue-500/25'
                : 'bg-[#1b202c] border-[#2a3142] text-slate-300 hover:bg-slate-800'
            } ${!isOwner ? 'cursor-default opacity-80' : 'cursor-pointer hover:scale-105 active:scale-95'}`}
            title={
              isOwner
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
                <span>{isRoomPublic ? 'Pública' : 'Privada'}</span>
                {isOwner && (
                  <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1 py-0.2 rounded font-bold ml-0.5">
                    Dono
                  </span>
                )}
              </>
            )}
          </button>
        )}

        {/* Network / Connection Health Badge */}
        {connectionStatus === 'reconnecting' && (
          <div
            className="flex items-center gap-1.5 px-3 py-1 bg-amber-500/15 border border-amber-500/40 rounded-xl text-xs font-semibold text-amber-300 animate-pulse"
            title="Conexão com a rede P2P instável. Tentando reconectar automaticamente..."
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="hidden sm:inline">Reconectando...</span>
          </div>
        )}

        {connectionStatus === 'disconnected' && roomId && (
          <button
            onClick={() => PeerManager.getInstance().scheduleSignalingReconnect()}
            className="flex items-center gap-1.5 px-3 py-1 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 rounded-xl text-xs font-semibold text-rose-300 transition-all cursor-pointer shadow-sm active:scale-95"
            title="Conexão com o servidor perdida. Clique para tentar reconectar agora."
          >
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span className="hidden sm:inline">Desconectado</span>
            <span className="underline ml-1 font-bold">Reconectar</span>
          </button>
        )}
      </div>

      {/* Center: Current Zone indicator (Desktop/Tablet) */}
      <div className="hidden lg:flex items-center gap-2">
        <div className="flex items-center gap-2 px-4 py-1.5 bg-[#1b202c]/60 border border-[#2a3142] rounded-full">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: currentZone ? currentZone.color : '#6b7280' }}
          />
          <span className="text-xs font-semibold text-slate-200">
            {currentZone ? currentZone.name : 'Corredor Geral'}
          </span>
        </div>
      </div>

      {/* Desktop Right Controls (>= lg) */}
      <div className="hidden lg:flex items-center gap-2.5">
        {/* Auto-saved Feedback indicator */}
        {autoSavedNotice && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-xs font-semibold text-emerald-300 animate-in fade-in duration-200">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>Espaço Salvo!</span>
          </div>
        )}

        {/* Edit Space Toggle */}
        <button
          onClick={toggleEditor}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
            isEditorOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
              : 'bg-[#1b202c] text-slate-300 border-[#2a3142] hover:bg-slate-800'
          }`}
          title="Editar Mobília, Pisos e Zonas do Espaço"
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span>{isEditorOpen ? 'Fechar Editor' : 'Editar Espaço'}</span>
        </button>

        {/* Chat Drawer Toggle */}
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

        {/* Online People Toggle Button */}
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

        {/* Available Update Notification Download Icon OR Current Version Badge */}
        {hasUpdate && onApplyUpdate ? (
          <button
            onClick={onApplyUpdate}
            disabled={isUpdating}
            className="p-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-400 hover:text-emerald-300 transition-all hover:scale-105 shadow-sm shadow-emerald-500/20 disabled:opacity-75 cursor-pointer"
            title="Nova atualização disponível! Clique para atualizar agora."
          >
            {isUpdating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
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

        {/* Real-time Network Quality Indicator */}
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

        {/* Audio & Video Settings Button */}
        <button
          onClick={() => useMediaStore.getState().setSettingsModalOpen(true)}
          className="p-2 rounded-xl bg-[#1b202c] hover:bg-slate-800 border border-[#2a3142] text-slate-300 hover:text-white transition-all group"
          title="Configurações de Áudio e Chamada"
        >
          <Settings className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 group-hover:rotate-45 transition-transform" />
        </button>

        {/* User Profile / Avatar Button */}
        <button
          onClick={onOpenAvatarModal}
          className="flex items-center gap-2 pl-2 pr-3 py-1 bg-[#1b202c] hover:bg-slate-800 border border-[#2a3142] rounded-xl transition-all group"
        >
          <PlayerAvatar
            name={localPlayerName}
            profilePicture={localPlayerProfilePicture}
            avatar={localPlayerAvatar}
            status={localPlayerStatus}
            showStatus={true}
            size="sm"
          />
          <div className="text-left">
            <div className="text-xs font-bold text-slate-200 group-hover:text-white leading-tight">
              {localPlayerName}
            </div>
            <div className="text-[10px] text-slate-400 leading-tight truncate max-w-[80px]">
              {localPlayerStatusText}
            </div>
          </div>
        </button>

        {/* Disconnect / Leave Space Button */}
        {onDisconnect && (
          <button
            onClick={onDisconnect}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-950/40 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 hover:text-rose-100 rounded-xl text-xs font-bold transition-all active:scale-95 group shadow-sm hover:shadow-rose-500/20"
            title="Sair / Desconectar deste espaço"
          >
            <LogOut className="w-3.5 h-3.5 text-rose-400 group-hover:text-rose-200 transition-colors" />
            <span className="hidden sm:inline">Sair</span>
          </button>
        )}
      </div>

      {/* Mobile / Compact Controls (< lg) */}
      <div className="flex lg:hidden items-center gap-1.5">
        {/* Chat Drawer Toggle */}
        <button
          onClick={toggleChat}
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

        {/* Online People Toggle Button */}
        <button
          onClick={toggleOnlineUsers}
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

        {/* Mobile Menu Dropdown Toggle */}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className={`p-2 rounded-xl border transition-all relative ${
            isMobileMenuOpen
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md'
              : 'bg-[#1b202c] border-[#2a3142] text-slate-300 hover:text-white'
          }`}
          title="Mais opções e menus"
        >
          {isMobileMenuOpen ? <X className="w-4 h-4 text-white" /> : <Menu className="w-4 h-4" />}
          {(hasUpdate || totalUnreadDMs > 0) && !isMobileMenuOpen && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>
      </div>

      {/* Mobile Floating Drawer Menu (< lg) */}
      {isMobileMenuOpen && (
        <div className="absolute inset-x-0 top-14 bg-[#12151d]/98 backdrop-blur-2xl border-b border-[#2a3142] p-4 z-50 shadow-2xl flex flex-col gap-3 animate-in slide-in-from-top-2 duration-150 max-h-[calc(100vh-60px)] overflow-y-auto select-none lg:hidden">
          {/* User Profile Card */}
          <div
            onClick={() => {
              setIsMobileMenuOpen(false)
              onOpenAvatarModal()
            }}
            className="flex items-center justify-between p-3 rounded-2xl bg-[#1b202c] border border-[#2a3142] cursor-pointer hover:border-indigo-500/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <PlayerAvatar
                name={localPlayerName}
                profilePicture={localPlayerProfilePicture}
                avatar={localPlayerAvatar}
                status={localPlayerStatus}
                showStatus={true}
                size="md"
              />
              <div>
                <div className="text-sm font-bold text-slate-100">{localPlayerName}</div>
                <div className="text-xs text-slate-400">{localPlayerStatusText}</div>
              </div>
            </div>
            <span className="text-xs text-indigo-400 font-semibold px-2 py-1 rounded-lg bg-indigo-600/10 border border-indigo-500/20">
              Editar Perfil
            </span>
          </div>

          {/* Current Zone Info */}
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#181d28] border border-[#242b3d] text-xs">
            <span className="text-slate-400">Local Atual:</span>
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: currentZone ? currentZone.color : '#6b7280' }}
              />
              {currentZone ? currentZone.name : 'Corredor Geral'}
            </span>
          </div>

          {/* Actions List */}
          <div className="flex flex-col gap-1.5 pt-1">
            {/* Audio & Settings Button */}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false)
                useMediaStore.getState().setSettingsModalOpen(true)
              }}
              className="flex items-center gap-2.5 w-full p-2.5 rounded-xl bg-[#1b202c] hover:bg-slate-800 border border-[#2a3142] text-xs font-semibold text-slate-200 transition-colors text-left"
            >
              <Settings className="w-4 h-4 text-indigo-400" />
              <span>Configurações de Áudio e Chamada</span>
            </button>

            {/* Edit Space Toggle */}
            <button
              onClick={() => {
                setIsMobileMenuOpen(false)
                toggleEditor()
              }}
              className={`flex items-center gap-2.5 w-full p-2.5 rounded-xl text-xs font-semibold border transition-colors text-left ${
                isEditorOpen
                  ? 'bg-indigo-600 text-white border-indigo-500'
                  : 'bg-[#1b202c] text-slate-200 border-[#2a3142] hover:bg-slate-800'
              }`}
            >
              <Edit3 className="w-4 h-4 text-indigo-400" />
              <span>{isEditorOpen ? 'Fechar Editor do Espaço' : 'Editar Mobílias e Salas'}</span>
            </button>

            {/* Room Privacy Toggle (if Owner) */}
            {roomId && isOwner && (
              <button
                onClick={() => {
                  toggleRoomPrivacy()
                }}
                className="flex items-center justify-between w-full p-2.5 rounded-xl bg-[#1b202c] hover:bg-slate-800 border border-[#2a3142] text-xs font-semibold text-slate-200 transition-colors text-left"
              >
                <span className="flex items-center gap-2.5">
                  {isRoomPublic ? <Globe className="w-4 h-4 text-blue-400" /> : <Lock className="w-4 h-4 text-slate-400" />}
                  <span>Privacidade da Sala: {isRoomPublic ? 'Pública' : 'Privada'}</span>
                </span>
                <span className="text-[10px] text-indigo-400 underline font-bold">Alternar</span>
              </button>
            )}

            {/* Network Quality Badge */}
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#181d28] border border-[#242b3d] text-xs">
              <span className="text-slate-400">Qualidade da Conexão:</span>
              <NetworkSignalIcon
                rating={localQuality.rating}
                pingMs={localQuality.pingMs}
                lossPct={localQuality.lossPct}
                showPingText={true}
                size="sm"
              />
            </div>

            {/* Update Button */}
            {hasUpdate && onApplyUpdate && (
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  onApplyUpdate()
                }}
                disabled={isUpdating}
                className="flex items-center justify-between w-full p-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 font-bold text-xs transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-emerald-400" />
                  <span>Nova Atualização Disponível</span>
                </span>
                <span className="underline">Atualizar</span>
              </button>
            )}

            {/* Disconnect Button */}
            {onDisconnect && (
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  onDisconnect()
                }}
                className="flex items-center justify-center gap-2 w-full p-3 mt-1 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 font-bold text-xs transition-colors cursor-pointer"
              >
                <LogOut className="w-4 h-4 text-rose-400" />
                <span>Sair / Desconectar do Espaço</span>
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
