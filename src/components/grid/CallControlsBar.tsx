import React from 'react'
import {
  SlidersHorizontal,
  Mic,
  MicOff,
  Video,
  VideoOff,
  ScreenShare,
  MessageSquare,
  LogOut,
  Shield,
  Headphones,
  Sliders,
  StopCircle,
} from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { MediaManager } from '../../media/MediaManager'
import { useChatStore } from '../../store/useChatStore'
import { RoomSettingsModal } from '../RoomSettingsModal'

interface Props {
  onToggleScreenShare: () => void
  onLeaveCall: () => void
}

export const CallControlsBar: React.FC<Props> = ({
  onToggleScreenShare,
  onLeaveCall,
}) => {
  // Granular selectors — booleans/toggles only change on user action, but
  // whole-store would also re-render this bar on every VU-meter tick.
  const isMuted = useMediaStore((s) => s.isMuted)
  const isDeafened = useMediaStore((s) => s.isDeafened)
  const isCameraOff = useMediaStore((s) => s.isCameraOff)
  const isScreenSharing = useMediaStore((s) => s.isScreenSharing)
  const isNoiseSuppressionEnabled = useMediaStore((s) => s.isNoiseSuppressionEnabled)
  const toggleMute = useMediaStore((s) => s.toggleMute)
  const toggleDeafen = useMediaStore((s) => s.toggleDeafen)
  const toggleCamera = useMediaStore((s) => s.toggleCamera)
  const toggleNoiseSuppression = useMediaStore((s) => s.toggleNoiseSuppression)

  const isChatOpen = useChatStore((state) => state.isChatOpen)
  const activeChannelId = useChatStore((state) => state.activeChannelId)
  const zoneChannel = useChatStore((state) => state.channels.find((c) => c.id === 'current-zone'))
  const unreadZoneCount = zoneChannel?.unreadCount || 0

  const handleOpenRoomChat = () => {
    const chatStore = useChatStore.getState()
    if (chatStore.isChatOpen && chatStore.activeChannelId === 'current-zone') {
      chatStore.setChatOpen(false)
    } else {
      chatStore.setActiveChannel('current-zone')
      chatStore.setChatOpen(true)
    }
  }

  const localPlayer = useGameStore((s) => s.localPlayer)
  const zones = useMapStore((s) => s.mapData.zones)
  const currentZone = zones?.find((z) => z.id === localPlayer.currentZoneId)

  const [isRoomSettingsOpen, setIsRoomSettingsOpen] = React.useState(false)
  const [isActiveStreamMenuOpen, setIsActiveStreamMenuOpen] = React.useState(false)
  const streamMenuRef = React.useRef<HTMLDivElement>(null)

  // Fecha o mini-menu ao clicar fora ou pressionar ESC
  React.useEffect(() => {
    if (!isActiveStreamMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (streamMenuRef.current && !streamMenuRef.current.contains(e.target as Node)) {
        setIsActiveStreamMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsActiveStreamMenuOpen(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActiveStreamMenuOpen])

  return (
    <>
      <div className="flex items-center justify-between px-6 py-2.5 bg-[#12151d]/95 backdrop-blur-xl rounded-2xl border border-[#2a3142] max-w-3xl mx-auto w-full shadow-2xl shrink-0 mt-2">
        {/* Left Side: Audio Settings & Room Permissions Shield */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => useMediaStore.getState().setSettingsModalOpen(true)}
            className="p-2 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Configurações de Áudio e Voz"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          {localPlayer.currentZoneId && (
            <button
              onClick={() => setIsRoomSettingsOpen(true)}
              className="p-2 rounded-xl bg-slate-800/60 border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Gerenciar Usuários com Permissão de Entrada"
            >
              <Shield className="w-4 h-4" />
            </button>
          )}
        </div>

      {/* Center: Main Call Buttons */}
      <div className="flex items-center gap-2.5">
        {/* Mic */}
        <button
          onClick={toggleMute}
          className={`p-3 rounded-xl flex items-center justify-center transition-all ${
            localPlayer.isMutedByAdmin
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 hover:bg-amber-500/30 shadow-lg shadow-amber-500/20'
              : isMuted
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-[#1b202c] text-white border border-[#2a3142] hover:bg-slate-700'
          }`}
          title={
            localPlayer.isMutedByAdmin
              ? 'Microfone mutado pelo Administrador (Clique para desmutar)'
              : isMuted
              ? 'Desmutar Microfone (M)'
              : 'Mutar Microfone (M)'
          }
        >
          {isMuted ? (
            <MicOff className={`w-4 h-4 ${localPlayer.isMutedByAdmin ? 'text-amber-400' : ''}`} />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>

        {/* Mutar som para mim (Ensurdecer / Deafen) */}
        <button
          onClick={toggleDeafen}
          className={`p-3 rounded-xl flex items-center justify-center transition-all ${
            isDeafened
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30 shadow-lg shadow-rose-500/20'
              : 'bg-[#1b202c] text-slate-300 border border-[#2a3142] hover:bg-slate-700 hover:text-white'
          }`}
          title={
            isDeafened
              ? 'Som Desativado para Você (Clique para ouvir a chamada)'
              : 'Mutar o Som para Mim (Ensurdecer)'
          }
        >
          <Headphones className="w-4 h-4" />
        </button>

        {/* Camera */}
        <button
          onClick={toggleCamera}
          className={`p-3 rounded-xl flex items-center justify-center transition-all ${
            isCameraOff
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-[#1b202c] text-white border border-[#2a3142] hover:bg-slate-700'
          }`}
          title={isCameraOff ? 'Ligar Câmera (V)' : 'Desligar Câmera (V)'}
        >
          {isCameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
        </button>

        {/* Screen Share */}
        <div className="relative">
          <button
            onClick={() => {
              if (isScreenSharing) {
                setIsActiveStreamMenuOpen((prev) => !prev)
              } else {
                onToggleScreenShare()
              }
            }}
            className={`p-3 rounded-xl flex items-center justify-center transition-all ${
              isScreenSharing
                ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/40 animate-pulse'
                : 'bg-[#1b202c] text-slate-300 border border-[#2a3142] hover:bg-slate-700'
            }`}
            title={isScreenSharing ? 'Opções da Transmissão (Ao Vivo)' : 'Compartilhar Tela / Janela'}
          >
            <ScreenShare className="w-4 h-4" />
          </button>

          {/* Menu compacto em lista de opções da transmissão */}
          {isScreenSharing && isActiveStreamMenuOpen && (
            <div
              ref={streamMenuRef}
              className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-48 bg-[#12151d]/95 backdrop-blur-xl border border-[#2a3142] rounded-2xl shadow-2xl p-1.5 z-50 select-none animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2.5 py-1 text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-[#2a3142]/60 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                Ao Vivo
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsActiveStreamMenuOpen(false)
                  onToggleScreenShare()
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800/80 transition-colors text-left"
              >
                <Sliders className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Trocar configurações</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsActiveStreamMenuOpen(false)
                  MediaManager.getInstance().stopScreenShare()
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-200 hover:bg-rose-950/40 transition-colors text-left"
              >
                <StopCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                <span>Encerrar transmissão</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right Side: Chat & Leave */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleOpenRoomChat}
          className={`p-2.5 rounded-xl border transition-all relative ${
            isChatOpen && activeChannelId === 'current-zone'
              ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
              : 'bg-[#1b202c] border-[#2a3142] text-slate-300 hover:bg-slate-700 hover:text-white'
          }`}
          title="Abrir Chat da Sala"
        >
          <MessageSquare className="w-4 h-4" />
          {unreadZoneCount > 0 && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-400 ring-2 ring-[#12151d] animate-pulse flex items-center justify-center text-[8px] font-bold text-slate-950">
              {unreadZoneCount > 9 ? '9+' : unreadZoneCount}
            </span>
          )}
        </button>

        <button
          onClick={onLeaveCall}
          className="px-3.5 py-2 rounded-xl bg-rose-600/20 border border-rose-600/40 hover:bg-rose-600 text-rose-400 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-all"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Minimizar</span>
        </button>
      </div>
    </div>

    {currentZone && isRoomSettingsOpen && (
      <RoomSettingsModal
        zone={currentZone}
        isOpen={isRoomSettingsOpen}
        onClose={() => setIsRoomSettingsOpen(false)}
        initialTab="permissions"
      />
    )}
  </>
)
}
