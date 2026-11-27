import React, { useState, useEffect, useRef } from 'react'
import {
  Monitor,
  AppWindow,
  X,
  Check,
  ScreenShare,
  Volume2,
  Sliders,
  RefreshCw,
  StopCircle,
  Sparkles,
  Zap,
} from 'lucide-react'
import { MediaManager, ScreenShareConfig } from '../media/MediaManager'
import { useMediaStore } from '../store/useMediaStore'

interface DesktopSource {
  id: string
  name: string
  thumbnail: string
  appIcon?: string | null
}

interface Props {
  isOpen: boolean
  onClose: () => void
}

export const ScreenShareModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [sources, setSources] = useState<DesktopSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [selectedAudioSourceId, setSelectedAudioSourceId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'screen' | 'window'>('screen')
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [audioCapabilityError, setAudioCapabilityError] = useState<string | null>(null)
  const startingRef = useRef(false)
  const closedByUserRef = useRef(false)

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.getSources

  const isScreenSharing = useMediaStore((s) => s.isScreenSharing)
  const screenShareAudioVolume = useMediaStore((s) => s.screenShareAudioVolume)
  const setScreenShareAudioVolume = useMediaStore((s) => s.setScreenShareAudioVolume)
  const duckingEnabled = useMediaStore((s) => s.duckingEnabled)
  const setDuckingEnabled = useMediaStore((s) => s.setDuckingEnabled)
  const isHardwareAccelerationEnabled = useMediaStore((s) => s.isHardwareAccelerationEnabled)
  const toggleHardwareAcceleration = useMediaStore((s) => s.toggleHardwareAcceleration)
  const optimizationMode = useMediaStore((s) => s.screenShareOptimizationMode)
  const setScreenShareOptimizationMode = useMediaStore((s) => s.setScreenShareOptimizationMode)

  const includeAudio = true
  const resolution = useMediaStore((s) => s.screenShareResolution)
  const setResolution = useMediaStore((s) => s.setScreenShareResolution)
  const fps = useMediaStore((s) => s.screenShareFps)
  const setFps = useMediaStore((s) => s.setScreenShareFps)
  const captureMethod = 'auto'

  const fetchSources = async () => {
    setLoading(true)
    setFetchError(null)
    const electronAPI = (window as any).electronAPI
    if (electronAPI && electronAPI.getSources) {
      try {
        const items = (await Promise.race([
          electronAPI.getSources(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Tempo esgotado ao listar telas')), 9000)
          ),
        ])) as DesktopSource[]
        setSources(items || [])
        if (items && items.length > 0) {
          const firstScreen = items.find((item) => item.id.startsWith('screen:'))
          setSelectedSourceId((prev) => prev ?? firstScreen?.id ?? items[0].id)
        }
      } catch (err) {
        console.error('Failed to get desktop sources:', err)
        setFetchError('Não foi possível listar telas e janelas automaticamente. Tente recarregar a lista.')
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!isOpen) {
      startingRef.current = false
      setStarting(false)
      return
    }
    closedByUserRef.current = false
    fetchSources()
    const getAudioInfo = (window as any).electronAPI?.getProcessAudioCaptureInfo
    if (isElectron && getAudioInfo) {
      getAudioInfo()
        .then((info: { supported: boolean; error?: string }) => {
          setAudioCapabilityError(info.supported ? null : info.error || 'A captura isolada de áudio não está disponível neste computador.')
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error)
          setAudioCapabilityError(`Não foi possível verificar a captura de áudio isolada: ${detail}`)
        })
    } else {
      setAudioCapabilityError(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  const screens = sources.filter((s) => s.id.startsWith('screen:'))
  const windows = sources.filter((s) => s.id.startsWith('window:'))

  const currentList = activeTab === 'screen' ? (screens.length > 0 ? screens : sources) : windows
  const selectedSource = sources.find((s) => s.id === selectedSourceId)
  const isSharingWholeScreen = selectedSource?.id.startsWith('screen:')
  const effectiveAudioSourceId = isSharingWholeScreen ? selectedSourceId : (selectedAudioSourceId || selectedSourceId)

  const handleClose = () => {
    closedByUserRef.current = true
    if (startingRef.current) {
      MediaManager.getInstance().cancelPendingScreenShare?.()
      startingRef.current = false
      setStarting(false)
    }
    onClose()
  }

  const handleConfirm = async () => {
    if (startingRef.current) return
    if (isElectron && (!effectiveAudioSourceId || audioCapabilityError)) return
    startingRef.current = true
    closedByUserRef.current = false
    setStarting(true)
    const config: ScreenShareConfig = {
      sourceId: selectedSourceId || undefined,
      sourceName: selectedSource?.name,
      audioSourceId: effectiveAudioSourceId || undefined,
      captureMethod,
      includeAudio,
      resolution,
      fps,
      optimizationMode,
    }
    try {
      await MediaManager.getInstance().startScreenShare(config)
    } catch (err) {
      console.error('Falha ao iniciar compartilhamento de tela:', err)
    } finally {
      startingRef.current = false
      setStarting(false)
      if (!closedByUserRef.current) onClose()
    }
  }

  const handleNativePicker = async () => {
    if (startingRef.current) return
    startingRef.current = true
    closedByUserRef.current = false
    setStarting(true)
    const config: ScreenShareConfig = {
      sourceId: undefined,
      sourceName: undefined,
      includeAudio,
      resolution,
      fps,
      optimizationMode,
    }
    try {
      await MediaManager.getInstance().startScreenShare(config)
    } catch (err) {
      console.error('Falha ao iniciar compartilhamento nativo de tela:', err)
    } finally {
      startingRef.current = false
      setStarting(false)
      if (!closedByUserRef.current) onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-lira-ground/80 p-4 select-none font-mono">
      <div className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dashed border-lira-rule/60 bg-lira-surface/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[8px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent">
              <ScreenShare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-lira-accent">[ transmissão ]</span>
                <h2 className="font-display text-lg font-bold text-lira-ink">
                  {isScreenSharing ? 'Configurações da Transmissão' : 'Compartilhar Tela & Áudio'}
                </h2>
                {isScreenSharing && (
                  <span className="px-2 py-0.5 rounded-[6px] text-[10px] font-mono font-extrabold uppercase tracking-wide bg-lira-error/15 text-lira-error border border-lira-error/40">
                    Ao Vivo
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-lira-muted">
                {isScreenSharing
                  ? 'Ajuste a resolução, FPS, volume ou selecione outra tela/janela em tempo real'
                  : 'Escolha uma tela inteira ou janela para transmitir para o espaço'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchSources}
              disabled={starting}
              className="p-2 rounded-[8px] border border-lira-rule bg-lira-surface text-lira-muted hover:text-lira-ink hover:border-lira-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Recarregar Janelas"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-lira-accent' : ''}`} />
            </button>
            <button
              onClick={handleClose}
              aria-label="Fechar"
              className="p-2 rounded-[8px] border border-lira-rule bg-lira-surface text-lira-muted hover:text-lira-ink hover:border-lira-accent transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex gap-2 px-6 pt-3 border-b border-dashed border-lira-rule/60 bg-lira-panel">
          <button
            onClick={() => {
              setActiveTab('screen')
              if (screens.length > 0 && (!selectedSourceId || selectedSourceId.startsWith('window:'))) {
                setSelectedSourceId(screens[0].id)
              }
            }}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-mono font-bold border-b-2 transition-colors ${
              activeTab === 'screen'
                ? 'border-lira-accent text-lira-accent'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <Monitor className="w-4 h-4" />
            Telas Inteiras ({screens.length || 1})
          </button>
          <button
            onClick={() => {
              setActiveTab('window')
              if (windows.length > 0 && (!selectedSourceId || selectedSourceId.startsWith('screen:'))) {
                setSelectedSourceId(windows[0].id)
                setSelectedAudioSourceId(windows[0].id)
              }
            }}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-mono font-bold border-b-2 transition-colors ${
              activeTab === 'window'
                ? 'border-lira-accent text-lira-accent'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <AppWindow className="w-4 h-4" />
            Janelas de Aplicativos ({windows.length})
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-lira-ink">
                {activeTab === 'screen' ? 'Selecione o Monitor' : 'Selecione a Janela do Aplicativo (ex: Chrome)'}
              </span>
              {!isElectron && (
                <button
                  type="button"
                  onClick={handleNativePicker}
                  disabled={starting}
                  className="text-[11px] font-semibold text-lira-accent hover:text-lira-ink disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 underline"
                >
                  <span>Usar Seletor do Sistema / Navegador</span>
                </button>
              )}
            </div>

            {activeTab === 'window' && (
              <div className="mb-4 px-3.5 py-2.5 bg-lira-surface border border-dashed border-lira-rule/60 rounded-[8px] text-xs text-lira-ink">
                <p className="text-[11px] text-lira-muted leading-relaxed">
                  Para remover a borda o aplicativo precisa estar em tela cheia - ou utilize compartilhar a tela inteira
                </p>
              </div>
            )}

            {loading ? (
              <div className="text-center py-10 text-sm text-lira-muted border border-dashed border-lira-rule/60 rounded-[8px]">Detectando telas disponíveis...</div>
            ) : !isElectron ? (
              <div className="p-6 text-center bg-lira-ground rounded-[12px] border border-dashed border-lira-rule/60 space-y-3">
                <p className="text-xs text-lira-muted">
                  Você está no navegador: a lista de miniaturas só existe no app desktop. Use o seletor
                  nativo do sistema para escolher a tela ou janela.
                </p>
                <button
                  type="button"
                  onClick={handleNativePicker}
                  className="px-4 py-2 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground text-xs font-mono font-bold transition-colors inline-flex items-center gap-2"
                >
                  <ScreenShare className="w-4 h-4" />
                  Abrir Seletor de Telas do Sistema
                </button>
              </div>
            ) : fetchError ? (
              <div className="p-6 text-center bg-lira-error/10 rounded-[12px] border border-dashed border-lira-error/40 space-y-3">
                <p className="text-xs text-lira-error">{fetchError}</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={fetchSources}
                    className="px-4 py-2 rounded-[8px] bg-lira-surface border border-lira-rule hover:border-lira-accent text-lira-ink text-xs font-mono font-bold transition-colors inline-flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Tentar Novamente
                  </button>
                  {!isElectron && (
                    <button
                      type="button"
                      onClick={handleNativePicker}
                      className="px-4 py-2 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground text-xs font-mono font-bold transition-colors inline-flex items-center gap-2"
                    >
                      <ScreenShare className="w-4 h-4" />
                      Usar Seletor do Sistema
                    </button>
                  )}
                </div>
              </div>
            ) : currentList.length === 0 ? (
              <div className="p-6 text-center bg-lira-ground rounded-[12px] border border-dashed border-lira-rule/60 space-y-3">
                <p className="text-xs text-lira-muted">
                  {isElectron
                    ? 'Nenhuma fonte foi encontrada. Recarregue a lista para manter o áudio isolado da fonte selecionada.'
                    : 'Nenhuma miniatura capturada automaticamente. Você pode usar o seletor nativo do sistema com 1 clique!'}
                </p>
                {!isElectron && (
                  <button
                    type="button"
                    onClick={handleNativePicker}
                    className="px-4 py-2 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground text-xs font-mono font-bold transition-colors inline-flex items-center gap-2"
                  >
                    <ScreenShare className="w-4 h-4" />
                    Abrir Seletor de Telas do Sistema
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-52 overflow-y-auto p-1">
                {currentList.map((source) => {
                  const isSelected = selectedSourceId === source.id
                  return (
                    <button
                      key={source.id}
                      onClick={() => {
                        setSelectedSourceId(source.id)
                        if (source.id.startsWith('window:')) {
                          setSelectedAudioSourceId(source.id)
                        }
                      }}
                      className={`flex flex-col rounded-[8px] border overflow-hidden text-left transition-colors group ${
                        isSelected
                          ? 'border-lira-accent ring-1 ring-lira-accent/40 bg-lira-surface'
                          : 'border-lira-quiet bg-lira-ground hover:border-lira-rule'
                      }`}
                    >
                      <div className="h-28 bg-lira-ground overflow-hidden flex items-center justify-center p-2 relative">
                        {source.thumbnail && source.thumbnail.length > 30 ? (
                          <img
                            src={source.thumbnail}
                            alt={source.name}
                            className="w-full h-full object-contain rounded-[4px]"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-2 text-lira-muted">
                            {source.id.startsWith('screen:') ? (
                              <Monitor className="w-10 h-10 text-lira-accent/80" />
                            ) : (
                              <AppWindow className="w-10 h-10 text-lira-accent/80" />
                            )}
                            <span className="text-[10px] text-lira-muted font-medium text-center px-1 truncate max-w-[150px]">
                              {source.name}
                            </span>
                          </div>
                        )}
                        {source.appIcon && (
                          <img
                            src={source.appIcon}
                            alt="App Icon"
                            className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-[4px] bg-lira-panel border border-lira-quiet p-0.5"
                          />
                        )}
                      </div>

                      <div className="p-2.5 bg-lira-surface border-t border-lira-quiet flex items-center justify-between gap-1.5">
                        <span className="text-[11px] font-medium text-lira-ink truncate">{source.name}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-lira-accent shrink-0" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {selectedSource && (
            <div className="flex items-center gap-2 px-3.5 py-2 bg-lira-surface border border-lira-rule rounded-[8px] text-xs text-lira-ink">
              <AppWindow className="w-4 h-4 text-lira-accent shrink-0" />
              <span className="truncate">
                Transmitindo: <strong className="text-lira-accent">{selectedSource.name}</strong>
              </span>
            </div>
          )}

          {isElectron && audioCapabilityError && (
            <div className="rounded-[8px] border border-lira-error/40 bg-lira-error/10 px-3.5 py-3 text-xs text-lira-error">
              <div className="font-semibold text-lira-ink">Áudio isolado indisponível neste computador</div>
              <div className="mt-1 leading-relaxed">{audioCapabilityError}</div>
              <div className="mt-1 text-[10px] text-lira-error/80">
                A apresentação fica bloqueada para evitar iniciar uma live sem o som selecionado.
              </div>
            </div>
          )}

          <div className="bg-lira-ground rounded-[12px] p-4 border border-dashed border-lira-rule/60 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-display text-sm font-bold text-lira-accent">
                <Sliders className="w-4 h-4 text-lira-accent" />
                <span>Qualidade & Taxa de Quadros</span>
              </div>
              <button
                type="button"
                onClick={toggleHardwareAcceleration}
                title={
                  isHardwareAccelerationEnabled
                    ? 'Aceleração por GPU ativada (H.264). Clique para alternar para CPU (VP8).'
                    : 'Aceleração por GPU desativada (CPU/VP8). Clique para ativar aceleração por hardware H.264.'
                }
                className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] border transition-colors text-[10px] font-mono font-bold cursor-pointer ${
                  isHardwareAccelerationEnabled
                    ? 'bg-lira-online/15 border-lira-online/40 text-lira-online hover:bg-lira-online/25'
                    : 'bg-lira-surface border-lira-quiet text-lira-muted hover:border-lira-rule hover:text-lira-ink'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    isHardwareAccelerationEnabled
                      ? 'bg-lira-online animate-pulse'
                      : 'bg-lira-muted'
                  }`}
                />
                <span>{isHardwareAccelerationEnabled ? 'GPU / H.264 Acelerado' : 'CPU / Software (VP8)'}</span>
                <span
                  className={`text-[9px] px-1 py-0.2 rounded-[4px] font-mono tabular-nums font-bold transition-colors ${
                    isHardwareAccelerationEnabled
                      ? 'bg-lira-online/20 text-lira-online'
                      : 'bg-lira-panel text-lira-muted'
                  }`}
                >
                  {isHardwareAccelerationEnabled ? 'ON' : 'OFF'}
                </span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-lira-ink">Prioridade da Transmissão</label>
                  <span className="text-[10px] text-lira-muted">
                    {optimizationMode === 'quality'
                      ? 'Foco em resolução nítida e texto legível'
                      : 'Foco em taxa de quadros (FPS) estável'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setScreenShareOptimizationMode('quality')}
                    className={`p-3 rounded-[8px] border text-left flex items-start gap-3 transition-colors ${
                      optimizationMode === 'quality'
                        ? 'border-lira-accent bg-lira-surface text-lira-ink'
                        : 'border-lira-quiet bg-lira-panel text-lira-muted hover:text-lira-ink hover:border-lira-rule'
                    }`}
                  >
                    <div
                      className={`p-2 rounded-[6px] mt-0.5 shrink-0 transition-colors ${
                        optimizationMode === 'quality'
                          ? 'bg-lira-accent/20 text-lira-accent'
                          : 'bg-lira-surface text-lira-muted'
                      }`}
                    >
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-lira-ink">Priorizar Qualidade</span>
                        {optimizationMode === 'quality' && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-lira-accent bg-lira-accent/15 px-1.5 py-0.5 rounded-[4px] border border-lira-accent/40">
                            <Check className="w-3 h-3" /> Ativo
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-lira-muted mt-1 leading-snug">
                        Mantém a resolução alta e texto nítido, ideal para leitura, código e trabalho.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScreenShareOptimizationMode('smoothness')}
                    className={`p-3 rounded-[8px] border text-left flex items-start gap-3 transition-colors ${
                      optimizationMode === 'smoothness'
                        ? 'border-lira-accent bg-lira-surface text-lira-ink'
                        : 'border-lira-quiet bg-lira-panel text-lira-muted hover:text-lira-ink hover:border-lira-rule'
                    }`}
                  >
                    <div
                      className={`p-2 rounded-[6px] mt-0.5 shrink-0 transition-colors ${
                        optimizationMode === 'smoothness'
                          ? 'bg-lira-accent/20 text-lira-accent'
                          : 'bg-lira-surface text-lira-muted'
                      }`}
                    >
                      <Zap className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-lira-ink">Priorizar Fluidez</span>
                        {optimizationMode === 'smoothness' && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-lira-accent bg-lira-accent/15 px-1.5 py-0.5 rounded-[4px] border border-lira-accent/40">
                            <Check className="w-3 h-3" /> Ativo
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-lira-muted mt-1 leading-snug">
                        Prioriza movimento fluido (60 FPS) estável, ideal para jogos dinâmicos e ação.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-1.5">
                  <label className="text-[11px] font-semibold text-lira-ink">Resolução de Vídeo</label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'auto', label: 'Automático', desc: 'IA / Dinâmico' },
                    { id: '1080p', label: '1080p FHD', desc: 'Nítido' },
                    { id: '720p', label: '720p HD', desc: 'Equilibrado' },
                    { id: '480p', label: '480p SD', desc: 'Econômico' },
                  ].map((res) => (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => setResolution(res.id as any)}
                      className={`py-2 px-2 rounded-[8px] text-center border font-mono tabular-nums transition-colors ${
                        resolution === res.id
                          ? 'border-lira-accent bg-lira-surface text-lira-accent'
                          : 'border-lira-quiet bg-lira-panel text-lira-muted hover:text-lira-ink hover:border-lira-rule'
                      }`}
                    >
                      <div className="text-xs font-bold">{res.label}</div>
                      <div className="text-[9px] opacity-70">{res.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5">
                  <label className="text-[11px] font-semibold text-lira-ink">Taxa de Quadros (FPS)</label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'auto', label: 'Automático', desc: 'Ajuste Inteligente' },
                    { id: 60, label: '60 FPS', desc: 'Ultra Fluido (Jogos / Vídeo)' },
                    { id: 30, label: '30 FPS', desc: 'Padrão (Trabalho / Slides)' },
                  ].map((f) => (
                    <button
                      key={String(f.id)}
                      type="button"
                      onClick={() => setFps(f.id as any)}
                      className={`py-2 px-2 rounded-[8px] text-center border font-mono tabular-nums transition-colors ${
                        fps === f.id
                          ? 'border-lira-accent bg-lira-surface text-lira-accent'
                          : 'border-lira-quiet bg-lira-panel text-lira-muted hover:text-lira-ink hover:border-lira-rule'
                      }`}
                    >
                      <div className="text-xs font-bold">{f.label}</div>
                      <div className="text-[9px] opacity-70">{f.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-dashed border-lira-rule/60">
              <div className="bg-lira-panel p-3.5 rounded-[8px] border border-lira-quiet space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-lira-ink">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <Volume2 className="w-3.5 h-3.5 text-lira-accent" />
                      <span>Volume da Transmissão</span>
                    </div>
                    <span className="font-mono tabular-nums font-bold text-lira-accent">{screenShareAudioVolume}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    step={1}
                    value={screenShareAudioVolume}
                    onChange={(e) => {
                      const val = Number(e.target.value)
                      setScreenShareAudioVolume(val)
                      MediaManager.getInstance().updateScreenShareAudioVolume(val)
                    }}
                    className="w-full h-2 bg-lira-surface rounded-[4px] appearance-none cursor-pointer accent-lira-accent"
                  />
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-dashed border-lira-rule/60">
                  <div className="space-y-0.5 pr-2">
                    <div className="text-xs font-semibold text-lira-ink">Ducking de Voz Inteligente</div>
                    <div className="text-[10px] text-lira-muted leading-tight">
                      Reduz automaticamente o áudio da tela em 75% enquanto você estiver falando
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={duckingEnabled}
                      onChange={(e) => setDuckingEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-lira-surface border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lira-accent peer-checked:border-lira-accent"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-dashed border-lira-rule/60 bg-lira-surface/50 flex items-center justify-between">
          <div className="text-xs font-mono tabular-nums text-lira-muted">
            Transmissão:{' '}
            <strong className="text-lira-accent">
              {resolution === 'auto' ? 'Resolução Automática' : resolution} @{' '}
              {fps === 'auto' ? 'FPS Dinâmico' : `${fps} FPS`} •{' '}
              {optimizationMode === 'quality' ? 'Foco em Qualidade' : 'Foco em Fluidez'}
            </strong>
          </div>

          <div className="flex items-center gap-2.5">
            {isScreenSharing && (
              <button
                type="button"
                disabled={starting}
                onClick={() => {
                  MediaManager.getInstance().stopScreenShare()
                  onClose()
                }}
                className="px-3.5 py-2 rounded-[8px] text-xs font-mono font-bold bg-lira-error/15 hover:bg-lira-error text-lira-error hover:text-lira-ground border border-lira-error/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                title="Parar de transmitir agora"
              >
                <StopCircle className="w-4 h-4" />
                Encerrar Live
              </button>
            )}
            <button
              onClick={handleClose}
              className="px-4 py-2 rounded-[8px] text-xs font-mono font-semibold text-lira-muted hover:text-lira-ink bg-lira-surface border border-lira-rule hover:border-lira-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={starting || !selectedSourceId || !!audioCapabilityError}
              aria-busy={starting}
              className="px-5 py-2 rounded-[8px] text-xs font-mono font-bold bg-lira-accent hover:bg-lira-ink border border-lira-accent hover:border-lira-ink disabled:cursor-not-allowed disabled:bg-lira-surface disabled:border-lira-quiet disabled:text-lira-muted text-lira-ground flex items-center gap-2 transition-colors"
            >
              {starting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ScreenShare className="w-4 h-4" />}
              {starting
                ? (isScreenSharing ? 'Atualizando...' : 'Iniciando...')
                : (isScreenSharing ? 'Atualizar Transmissão' : 'Iniciar Apresentação')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
