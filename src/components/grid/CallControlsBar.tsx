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
  Sparkles,
  Cpu,
  Feather,
  Check,
  Power,
  AudioLines,
  Zap,
} from 'lucide-react'

const NOISE_ENGINES = [
  {
    id: 'rnnoise' as const,
    name: 'RNNoise Neural',
    badge: 'IA',
    desc: 'Rede neural treinada (Xiph)',
    icon: Cpu,
  },
  {
    id: 'soft' as const,
    name: 'DSP Suave',
    badge: 'Natural',
    desc: 'Preserva voz suave e consoantes',
    icon: Feather,
  },
  {
    id: 'classic' as const,
    name: 'DSP Clássico',
    badge: 'Leve',
    desc: 'Corte agressivo, menor uso de CPU',
    icon: Sliders,
  },
]
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
  const audioProcessorMode = useMediaStore((s) => s.audioProcessorMode)
  const toggleMute = useMediaStore((s) => s.toggleMute)
  const toggleDeafen = useMediaStore((s) => s.toggleDeafen)
  const toggleCamera = useMediaStore((s) => s.toggleCamera)
  const toggleNoiseSuppression = useMediaStore((s) => s.toggleNoiseSuppression)
  const setAudioProcessorMode = useMediaStore((s) => s.setAudioProcessorMode)
  const optimizationMode = useMediaStore((s) => s.screenShareOptimizationMode)
  const setScreenShareOptimizationMode = useMediaStore((s) => s.setScreenShareOptimizationMode)

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
  const [isNoiseMenuOpen, setIsNoiseMenuOpen] = React.useState(false)
  const streamMenuRef = React.useRef<HTMLDivElement>(null)
  const noiseMenuRef = React.useRef<HTMLDivElement>(null)

  // Fecha os mini-menus ao clicar fora ou pressionar ESC
  React.useEffect(() => {
    if (!isActiveStreamMenuOpen && !isNoiseMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (streamMenuRef.current && !streamMenuRef.current.contains(e.target as Node)) {
        setIsActiveStreamMenuOpen(false)
      }
      if (noiseMenuRef.current && !noiseMenuRef.current.contains(e.target as Node)) {
        setIsNoiseMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsActiveStreamMenuOpen(false)
        setIsNoiseMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActiveStreamMenuOpen, isNoiseMenuOpen])

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

        {/* Supressor de Ruído (Noise Suppression) com Menu Suspenso */}
        <div className="relative">
          <button
            onClick={() => setIsNoiseMenuOpen((prev) => !prev)}
            className={`p-3 rounded-xl flex items-center justify-center transition-all ${
              isNoiseSuppressionEnabled
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 shadow-lg shadow-emerald-500/10'
                : 'bg-[#1b202c] text-slate-400 border border-[#2a3142] hover:bg-slate-700 hover:text-slate-200'
            }`}
            title={
              isNoiseSuppressionEnabled
                ? `Supressor de Ruído Ativo (${
                    audioProcessorMode === 'rnnoise'
                      ? 'RNNoise Neural'
                      : audioProcessorMode === 'soft'
                      ? 'DSP Suave'
                      : 'DSP Clássico'
                  }) - Clique para alternar motor`
                : 'Ativar / Configurar Supressor de Ruído'
            }
          >
            <AudioLines className={`w-4 h-4 ${isNoiseSuppressionEnabled ? 'text-emerald-400' : ''}`} />
          </button>

          {/* Menu compacto para alternar entre os supressores de ruído */}
          {isNoiseMenuOpen && (
            <div
              ref={noiseMenuRef}
              className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-60 bg-[#12151d]/95 backdrop-blur-xl border border-[#2a3142] rounded-2xl shadow-2xl p-1.5 z-50 select-none animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2.5 py-1 text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center justify-between border-b border-[#2a3142]/60 mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isNoiseSuppressionEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-500'
                    }`}
                  />
                  <span>Supressor de Ruído</span>
                </div>
                <span
                  className={`text-[8.5px] px-1.5 py-0.5 rounded font-bold uppercase ${
                    isNoiseSuppressionEnabled
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-slate-700/60 text-slate-400'
                  }`}
                >
                  {isNoiseSuppressionEnabled ? 'Ativo' : 'Desligado'}
                </span>
              </div>

              <div className="space-y-0.5">
                {NOISE_ENGINES.map((engine) => {
                  const isSelected = isNoiseSuppressionEnabled && audioProcessorMode === engine.id
                  const Icon = engine.icon
                  return (
                    <button
                      key={engine.id}
                      type="button"
                      onClick={async () => {
                        setIsNoiseMenuOpen(false)
                        if (!isNoiseSuppressionEnabled) {
                          toggleNoiseSuppression()
                          MediaManager.getInstance().updateNoiseSuppression(true)
                        }
                        if (audioProcessorMode !== engine.id) {
                          setAudioProcessorMode(engine.id)
                          await MediaManager.getInstance().reprocessStream()
                        }
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-xl text-xs font-medium transition-all text-left ${
                        isSelected
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold'
                          : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? 'text-emerald-400' : 'text-slate-400'
                          }`}
                        />
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{engine.name}</span>
                            {engine.badge && (
                              <span className="text-[8px] px-1 py-0.2 rounded bg-slate-800 text-slate-400 font-normal">
                                {engine.badge}
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] text-slate-400 font-normal truncate">
                            {engine.desc}
                          </span>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-1.5" />
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="my-1 border-t border-[#2a3142]/60" />

                  <button
                    type="button"
                    onClick={() => {
                      setIsNoiseMenuOpen(false)
                      if (isNoiseSuppressionEnabled) {
                        toggleNoiseSuppression()
                        MediaManager.getInstance().updateNoiseSuppression(false)
                      }
                    }}
                    className={`w-full flex items-center justify-between px-2 py-1.5 rounded-xl text-xs font-medium transition-all text-left ${
                      !isNoiseSuppressionEnabled
                        ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 font-bold'
                        : 'text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Power
                        className={`w-3.5 h-3.5 shrink-0 ${
                          !isNoiseSuppressionEnabled ? 'text-rose-400' : 'text-slate-500'
                        }`}
                      />
                      <span>Supressor desligado</span>
                    </div>
                    {!isNoiseSuppressionEnabled && (
                      <Check className="w-3.5 h-3.5 text-rose-400 shrink-0 ml-1.5" />
                    )}
                  </button>
            </div>
          )}
        </div>

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
              <div className="px-2.5 py-1 text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center justify-between border-b border-[#2a3142]/60 mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                  <span>Ao Vivo</span>
                </div>
                <span className="text-[9px] font-semibold text-slate-400 normal-case">
                  {optimizationMode === 'quality' ? 'Qualidade' : 'Fluidez'}
                </span>
              </div>
              <div className="space-y-0.5 mb-1">
                <button
                  type="button"
                  onClick={() => {
                    setScreenShareOptimizationMode('quality')
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-xl text-xs font-medium transition-all text-left ${
                    optimizationMode === 'quality'
                      ? 'bg-indigo-500/15 text-indigo-300 font-bold border border-indigo-500/30'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className={`w-3.5 h-3.5 shrink-0 ${optimizationMode === 'quality' ? 'text-indigo-400' : 'text-slate-400'}`} />
                    <span className="truncate">Priorizar Qualidade</span>
                  </div>
                  {optimizationMode === 'quality' && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 ml-1.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScreenShareOptimizationMode('smoothness')
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-xl text-xs font-medium transition-all text-left ${
                    optimizationMode === 'smoothness'
                      ? 'bg-indigo-500/15 text-indigo-300 font-bold border border-indigo-500/30'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap className={`w-3.5 h-3.5 shrink-0 ${optimizationMode === 'smoothness' ? 'text-indigo-400' : 'text-slate-400'}`} />
                    <span className="truncate">Priorizar Fluidez</span>
                  </div>
                  {optimizationMode === 'smoothness' && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 ml-1.5" />}
                </button>
              </div>
              <div className="my-1 border-t border-[#2a3142]/60" />
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
