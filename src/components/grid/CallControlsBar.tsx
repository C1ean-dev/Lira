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
  Check,
  Power,
  AudioLines,
  Zap,
  Radio,
} from 'lucide-react'

const NOISE_ENGINES = [
  {
    id: 'deepfilter' as const,
    name: 'DeepFilterNet',
    badge: 'IA',
    desc: 'O melhor, porém mais lento, com fallback para RNNoise',
    icon: Sparkles,
  },
  {
    id: 'rnnoise' as const,
    name: 'RNNoise Neural',
    badge: 'IA',
    desc: 'Rápido e eficiente',
    icon: Cpu,
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
import { noiseSuppressionDisplay, resolveNoiseProcessorPreference } from '../../media/noiseSuppressionStatus'
import { NoiseSuppressionNotice } from '../common/NoiseSuppressionNotice'

interface Props {
  onToggleScreenShare: () => void
  onLeaveCall: () => void
}

export const CallControlsBar: React.FC<Props> = ({
  onToggleScreenShare,
  onLeaveCall,
}) => {
  const isMuted = useMediaStore((s) => s.isMuted)
  const isDeafened = useMediaStore((s) => s.isDeafened)
  const isCameraOff = useMediaStore((s) => s.isCameraOff)
  const isScreenSharing = useMediaStore((s) => s.isScreenSharing)
  const isNoiseSuppressionEnabled = useMediaStore((s) => s.isNoiseSuppressionEnabled)
  const audioProcessorMode = useMediaStore((s) => s.audioProcessorMode)
  const rnnoiseStatus = useMediaStore((s) => s.rnnoiseStatus)
  const processingMode = useMediaStore(resolveNoiseProcessorPreference)
  const deepFilterStatus = useMediaStore((s) => s.deepFilterStatus)
  const noiseDisplay = noiseSuppressionDisplay(isNoiseSuppressionEnabled, processingMode, rnnoiseStatus, deepFilterStatus)
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
      <div className="flex items-center justify-between px-6 py-2.5 bg-lira-panel rounded-[12px] border border-dashed border-lira-rule max-w-3xl mx-auto w-full shrink-0 mt-2 font-mono">
        <div className="flex items-center gap-2">
          <button
            onClick={() => useMediaStore.getState().setSettingsModalOpen(true)}
            className="p-2 rounded-[8px] bg-lira-surface border border-lira-rule text-lira-muted hover:text-lira-ink hover:border-lira-accent transition-colors"
            title="Configurações de Áudio e Voz"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          {localPlayer.currentZoneId && (
            <button
              onClick={() => setIsRoomSettingsOpen(true)}
              className="p-2 rounded-[8px] bg-lira-surface border border-lira-rule text-lira-muted hover:text-lira-ink hover:border-lira-accent transition-colors"
              title="Gerenciar Usuários com Permissão de Entrada"
            >
              <Shield className="w-4 h-4" />
            </button>
          )}
        </div>

      <div className="flex items-center gap-2.5">
        <button
          onClick={toggleMute}
          className={`p-3 rounded-[8px] flex items-center justify-center transition-colors ${
            localPlayer.isMutedByAdmin
              ? 'bg-lira-amber/15 text-lira-amber border border-lira-amber/50 hover:bg-lira-amber/25'
              : isMuted
              ? 'bg-lira-error/15 text-lira-error border border-lira-error/40 hover:bg-lira-error/25'
              : 'bg-lira-surface text-lira-ink border border-lira-rule hover:border-lira-accent hover:text-lira-accent'
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
            <MicOff className={`w-4 h-4 ${localPlayer.isMutedByAdmin ? 'text-lira-amber' : ''}`} />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>

        <button
          onClick={toggleDeafen}
          className={`p-3 rounded-[8px] flex items-center justify-center transition-colors ${
            isDeafened
              ? 'bg-lira-error/15 text-lira-error border border-lira-error/40 hover:bg-lira-error/25'
              : 'bg-lira-surface text-lira-ink border border-lira-rule hover:border-lira-accent hover:text-lira-accent'
          }`}
          title={
            isDeafened
              ? 'Som Desativado para Você (Clique para ouvir a chamada)'
              : 'Mutar o Som para Mim (Ensurdecer)'
          }
        >
          <Headphones className="w-4 h-4" />
        </button>

        <div className="relative">
          <button
            onClick={() => setIsNoiseMenuOpen((prev) => !prev)}
            className={`p-3 rounded-[8px] flex items-center justify-center transition-colors ${
              noiseDisplay.canRetry
                ? 'bg-lira-amber/15 text-lira-amber border border-lira-amber/40 hover:bg-lira-amber/25'
                : isNoiseSuppressionEnabled
                ? 'bg-lira-online/15 text-lira-online border border-lira-online/40 hover:bg-lira-online/25'
                : 'bg-lira-surface text-lira-muted border border-lira-rule hover:border-lira-accent hover:text-lira-ink'
            }`}
            title={noiseDisplay.title}
          >
            <AudioLines className={`w-4 h-4 ${noiseDisplay.canRetry ? 'text-lira-amber' : isNoiseSuppressionEnabled ? 'text-lira-online' : ''}`} />
          </button>

          {isNoiseMenuOpen && (
            <div
              ref={noiseMenuRef}
              className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-60 bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-1.5 z-50 select-none font-mono"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2.5 py-1 text-[10px] font-bold text-lira-online uppercase tracking-wider flex items-center justify-between border-b border-dashed border-lira-rule/60 mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      noiseDisplay.canRetry ? 'bg-lira-amber' : isNoiseSuppressionEnabled ? 'bg-lira-online animate-pulse' : 'bg-lira-muted'
                    }`}
                  />
                  <span>Supressor de Ruído</span>
                </div>
                <span
                  className={`text-[8.5px] font-mono tabular-nums px-1.5 py-0.5 rounded-[4px] font-bold uppercase ${
                    noiseDisplay.canRetry
                      ? 'bg-lira-amber/15 text-lira-amber'
                      : isNoiseSuppressionEnabled
                      ? 'bg-lira-online/15 text-lira-online'
                      : 'bg-lira-surface text-lira-muted'
                  }`}
                >
                  {noiseDisplay.badge}
                </span>
              </div>

              <NoiseSuppressionNotice message={noiseDisplay.notice} warning={noiseDisplay.canRetry} />
              <div className="space-y-0.5">
                {NOISE_ENGINES.map((engine) => {
                  const isSelected = noiseDisplay.activeMode === engine.id
                  const Icon = engine.icon
                  return (
                    <button
                      key={engine.id}
                      type="button"
                      aria-pressed={isSelected}
                      title={engine.id === processingMode && noiseDisplay.canRetry ? processingMode === 'deepfilter' ? 'Tentar DeepFilterNet novamente' : 'Tentar RNNoise novamente' : undefined}
                      onClick={async () => {
                        setIsNoiseMenuOpen(false)
                        if (!isNoiseSuppressionEnabled) {
                          toggleNoiseSuppression()
                          MediaManager.getInstance().updateNoiseSuppression(true)
                        }
                        if (audioProcessorMode !== engine.id || processingMode !== engine.id || (engine.id === processingMode && noiseDisplay.canRetry)) {
                          setAudioProcessorMode(engine.id)
                          await MediaManager.getInstance().reprocessStream()
                        }
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[8px] text-xs font-medium transition-colors text-left ${
                        isSelected
                          ? 'bg-lira-surface text-lira-online border border-lira-online/40 font-bold'
                          : 'text-lira-ink hover:text-lira-accent hover:bg-lira-surface border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isSelected ? 'text-lira-online' : 'text-lira-muted'
                          }`}
                        />
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{engine.name}</span>
                            {engine.badge && (
                              <span className="text-[8px] px-1 py-0.2 rounded-[4px] bg-lira-ground border border-lira-quiet text-lira-muted font-normal">
                                {engine.badge}
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] text-lira-muted font-normal whitespace-normal leading-snug">
                            {engine.id === processingMode && noiseDisplay.canRetry ? 'Indisponível · clique para tentar novamente' : engine.desc}
                          </span>
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-lira-online shrink-0 ml-1.5" />
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="my-1 border-t border-dashed border-lira-rule/60" />

              <button
                type="button"
                onClick={() => {
                  setIsNoiseMenuOpen(false)
                  if (isNoiseSuppressionEnabled) {
                    toggleNoiseSuppression()
                    MediaManager.getInstance().updateNoiseSuppression(false)
                  }
                }}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[8px] text-xs font-medium transition-colors text-left ${
                  !isNoiseSuppressionEnabled
                    ? 'bg-lira-error/15 text-lira-error border border-lira-error/40 font-bold'
                    : 'text-lira-muted hover:text-lira-error hover:bg-lira-surface border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Power
                    className={`w-3.5 h-3.5 shrink-0 ${
                      !isNoiseSuppressionEnabled ? 'text-lira-error' : 'text-lira-muted'
                    }`}
                  />
                  <span>Supressor desligado</span>
                </div>
                {!isNoiseSuppressionEnabled && (
                  <Check className="w-3.5 h-3.5 text-lira-error shrink-0 ml-1.5" />
                )}
              </button>
            </div>
          )}
        </div>

        <button
          onClick={toggleCamera}
          className={`p-3 rounded-[8px] flex items-center justify-center transition-colors ${
            isCameraOff
              ? 'bg-lira-error/15 text-lira-error border border-lira-error/40 hover:bg-lira-error/25'
              : 'bg-lira-surface text-lira-ink border border-lira-rule hover:border-lira-accent hover:text-lira-accent'
          }`}
          title={isCameraOff ? 'Ligar Câmera (V)' : 'Desligar Câmera (V)'}
        >
          {isCameraOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
        </button>

        <div className="relative">
          <button
            onClick={() => {
              if (isScreenSharing) {
                setIsActiveStreamMenuOpen((prev) => !prev)
              } else {
                onToggleScreenShare()
              }
            }}
            className={`p-3 rounded-[8px] flex items-center justify-center transition-colors ${
              isScreenSharing
                ? 'bg-lira-error text-lira-ground border border-lira-error font-bold animate-pulse'
                : 'bg-lira-surface text-lira-ink border border-lira-rule hover:border-lira-accent hover:text-lira-accent'
            }`}
            title={isScreenSharing ? 'Opções da Transmissão (Ao Vivo)' : 'Compartilhar Tela / Janela'}
          >
            <ScreenShare className="w-4 h-4" />
          </button>

          {isScreenSharing && isActiveStreamMenuOpen && (
            <div
              ref={streamMenuRef}
              className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-48 bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-1.5 z-50 select-none font-mono"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2.5 py-1 text-[10px] font-bold text-lira-error uppercase tracking-wider flex items-center justify-between border-b border-dashed border-lira-rule/60 mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-lira-error animate-pulse" />
                  <span>Ao Vivo</span>
                </div>
                <span className="text-[9px] font-semibold text-lira-muted normal-case">
                  {optimizationMode === 'quality' ? 'Qualidade' : 'Fluidez'}
                </span>
              </div>
              <div className="space-y-0.5 mb-1">
                <button
                  type="button"
                  onClick={() => {
                    setScreenShareOptimizationMode('quality')
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[8px] text-xs font-medium transition-colors text-left ${
                    optimizationMode === 'quality'
                      ? 'bg-lira-surface text-lira-accent font-bold border border-lira-accent'
                      : 'text-lira-ink hover:text-lira-accent hover:bg-lira-surface border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className={`w-3.5 h-3.5 shrink-0 ${optimizationMode === 'quality' ? 'text-lira-accent' : 'text-lira-muted'}`} />
                    <span className="truncate">Priorizar Qualidade</span>
                  </div>
                  {optimizationMode === 'quality' && <Check className="w-3.5 h-3.5 text-lira-accent shrink-0 ml-1.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setScreenShareOptimizationMode('smoothness')
                  }}
                  className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[8px] text-xs font-medium transition-colors text-left ${
                    optimizationMode === 'smoothness'
                      ? 'bg-lira-surface text-lira-accent font-bold border border-lira-accent'
                      : 'text-lira-ink hover:text-lira-accent hover:bg-lira-surface border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Zap className={`w-3.5 h-3.5 shrink-0 ${optimizationMode === 'smoothness' ? 'text-lira-accent' : 'text-lira-muted'}`} />
                    <span className="truncate">Priorizar Fluidez</span>
                  </div>
                  {optimizationMode === 'smoothness' && <Check className="w-3.5 h-3.5 text-lira-accent shrink-0 ml-1.5" />}
                </button>
              </div>
              <div className="my-1 border-t border-dashed border-lira-rule/60" />
              <button
                type="button"
                onClick={() => {
                  setIsActiveStreamMenuOpen(false)
                  onToggleScreenShare()
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-xs font-medium text-lira-ink hover:text-lira-accent hover:bg-lira-surface transition-colors text-left"
              >
                <Sliders className="w-3.5 h-3.5 text-lira-accent shrink-0" />
                <span>Trocar configurações</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsActiveStreamMenuOpen(false)
                  MediaManager.getInstance().stopScreenShare()
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[8px] text-xs font-medium text-lira-error hover:bg-lira-error/15 transition-colors text-left"
              >
                <StopCircle className="w-3.5 h-3.5 text-lira-error shrink-0" />
                <span>Encerrar transmissão</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleOpenRoomChat}
          className={`p-2.5 rounded-[8px] border transition-colors relative ${
            isChatOpen && activeChannelId === 'current-zone'
              ? 'bg-lira-accent text-lira-ground border-lira-accent'
              : 'bg-lira-surface border-lira-rule text-lira-ink hover:border-lira-accent hover:text-lira-accent'
          }`}
          title="Abrir Chat da Sala"
        >
          <MessageSquare className="w-4 h-4" />
          {unreadZoneCount > 0 && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-lira-amber border border-lira-ground flex items-center justify-center text-[8px] font-mono tabular-nums font-bold text-lira-ground">
              {unreadZoneCount > 9 ? '9+' : unreadZoneCount}
            </span>
          )}
        </button>

        <button
          onClick={onLeaveCall}
          className="px-3.5 py-2 rounded-[8px] bg-lira-error/15 border border-lira-error/40 hover:bg-lira-error text-lira-error hover:text-lira-ground text-xs font-mono font-bold flex items-center gap-1.5 transition-colors"
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

