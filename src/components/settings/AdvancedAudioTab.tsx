import React, { useState, useEffect, useRef } from 'react'
import { Mic, RotateCw, Check, Volume2 } from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'
import { MediaManager } from '../../media/MediaManager'
import { AudioProcessorMode, SensitivityMode } from '../../types/audio'
import { AudioSamplePlayer } from './AudioSamplePlayer'
import { MultiEngineAudioPlayer } from './MultiEngineAudioPlayer'
import { ProcessedSampleInfo } from '../../media/MicCalibrator'
import { MIN_RECOMMENDED_MANUAL_PERCENT } from '../../media/autoGate'
import { resolveNoiseProcessorPreference, noiseSuppressionDisplay } from '../../media/noiseSuppressionStatus'

export const AdvancedAudioTab: React.FC = () => {
  const echoCancellation = useMediaStore((s) => s.echoCancellation)
  const autoGainControl = useMediaStore((s) => s.autoGainControl)
  const isNoiseSuppressionEnabled = useMediaStore((s) => s.isNoiseSuppressionEnabled)
  const audioProcessorMode = useMediaStore((s) => s.audioProcessorMode)
  const processingMode = useMediaStore(resolveNoiseProcessorPreference)
  const selectedAudioInput = useMediaStore((s) => s.selectedAudioInput)
  const micCalibrations = useMediaStore((s) => s.micCalibrations)
  const isCalibrating = useMediaStore((s) => s.isCalibrating)
  const hasUserChosenProcessorMode = useMediaStore((s) => s.hasUserChosenProcessorMode)
  const manualSensitivityThreshold = useMediaStore((s) => s.manualSensitivityThreshold)
  const sensitivityMode = useMediaStore((s) => s.sensitivityMode)
  const setEchoCancellation = useMediaStore((s) => s.setEchoCancellation)
  const setAutoGainControl = useMediaStore((s) => s.setAutoGainControl)
  const toggleNoiseSuppression = useMediaStore((s) => s.toggleNoiseSuppression)
  const setAudioProcessorMode = useMediaStore((s) => s.setAudioProcessorMode)
  const setManualSensitivityThreshold = useMediaStore((s) => s.setManualSensitivityThreshold)
  const setIsCalibrating = useMediaStore((s) => s.setIsCalibrating)
  const clearMicCalibration = useMediaStore((s) => s.clearMicCalibration)
  const rnnoiseStatus = useMediaStore((s) => s.rnnoiseStatus)
  const deepFilterStatus = useMediaStore((s) => s.deepFilterStatus)
  const deepFilterError = useMediaStore((s) => s.deepFilterError)
  const rnnoiseError = useMediaStore((s) => s.rnnoiseError)

  const INITIAL_LIVE_BARS = 64
  const [calProgress, setCalProgress] = useState(0)
  const [calSecondsLeft, setCalSecondsLeft] = useState(0)
  const [liveWaveform, setLiveWaveform] = useState<number[]>(() =>
    Array.from({ length: INITIAL_LIVE_BARS }, (_, i) => {
      const wave =
        Math.sin(i * 0.28) * 0.04 +
        Math.cos(i * 0.55) * 0.03 +
        0.11
      return Math.max(0.08, wave)
    })
  )
  const [lastCalibration, setLastCalibration] = useState<{
    noiseFloorDb: number
    snrDb: number
    recommendedMode: AudioProcessorMode
    recommendedSensitivity: number
    gateMode: SensitivityMode
    rawAudioUrl?: string
    processedAudioUrl?: string
    rawWaveform?: number[]
    processedWaveform?: number[]
    processedSamples?: {
      classic: ProcessedSampleInfo
      deepfilter: ProcessedSampleInfo
      rnnoise: ProcessedSampleInfo
    }
  } | null>(null)
  const lastTickRef = useRef(0)
  const revokeCalibrationUrls = (cal: typeof lastCalibration) => {
    if (!cal) return
    if (cal.rawAudioUrl) {
      try { URL.revokeObjectURL(cal.rawAudioUrl) } catch {}
    }
    if (cal.processedAudioUrl) {
      try { URL.revokeObjectURL(cal.processedAudioUrl) } catch {}
    }
    if (cal.processedSamples) {
      try { URL.revokeObjectURL(cal.processedSamples.classic.audioUrl) } catch {}
      try { URL.revokeObjectURL(cal.processedSamples.deepfilter.audioUrl) } catch {}
      try { URL.revokeObjectURL(cal.processedSamples.rnnoise.audioUrl) } catch {}
    }
  }

  useEffect(() => {
    return () => {
      revokeCalibrationUrls(lastCalibration)
    }
  }, [lastCalibration])

  const currentCalibration = micCalibrations[selectedAudioInput] || null

  const handleCalibrate = async () => {
    revokeCalibrationUrls(lastCalibration)

    const mgr = MediaManager.getInstance()
    let rawStream: MediaStream
    try {
      rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId:
            selectedAudioInput && selectedAudioInput !== 'default'
              ? { exact: selectedAudioInput }
              : undefined,
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
        video: false,
      })
    } catch (err) {
      console.warn('[calibration] failed to open raw mic:', err)
      setIsCalibrating(false)
      return
    }

    setCalProgress(0)
    setCalSecondsLeft(5)
    setLiveWaveform(
      Array.from({ length: INITIAL_LIVE_BARS }, (_, i) => {
        const wave =
          Math.sin(i * 0.28) * 0.04 +
          Math.cos(i * 0.55) * 0.03 +
          0.11
        return Math.max(0.08, wave)
      })
    )
    lastTickRef.current = performance.now()

    try {
      const result = await mgr.calibrateMicrophone(
        rawStream,
        5000,
        (elapsed, total, currentDb, waveform) => {
          setCalProgress(Math.min(1, elapsed / total))
          setCalSecondsLeft(Math.max(0, Math.ceil((total - elapsed) / 1000)))
          if (waveform && waveform.length > 0) {
            setLiveWaveform(waveform)
          }
        }
      )
      setLastCalibration({
        noiseFloorDb: result.noiseFloorDb,
        snrDb: result.snrDb,
        recommendedMode: result.recommendedMode,
        recommendedSensitivity: result.recommendedSensitivity,
        gateMode: result.gateMode,
        rawAudioUrl: result.rawAudioUrl,
        processedAudioUrl: result.processedAudioUrl,
        rawWaveform: result.rawWaveform,
        processedWaveform: result.processedWaveform,
        processedSamples: result.processedSamples,
      })
      setCalProgress(1)
      setCalSecondsLeft(0)
    } catch (err) {
      console.warn('[calibration] failed:', err)
    } finally {
      rawStream.getTracks().forEach((t) => t.stop())
    }
  }

  const handleResetCalibration = () => {
    clearMicCalibration(selectedAudioInput)
    revokeCalibrationUrls(lastCalibration)
    setLastCalibration(null)
  }

  const engineLabel = hasUserChosenProcessorMode
    ? 'Escolha manual'
    : 'Padrão'

  const engineModeLabel = (mode: AudioProcessorMode): string => {
    if (mode === 'rnnoise') return 'RNNoise Neural'
    if (mode === 'deepfilter') return 'DeepFilterNet'
    return 'DSP Clássico'
  }

  const SuggestedActionRow: React.FC<{
    label: string
    current: React.ReactNode
    active: boolean
    onApply: () => void
    applyLabel: string
  }> = ({ label, current, active, onApply, applyLabel }) => (
    <div className="flex items-center gap-2 text-[10.5px] font-mono">
      <span className="text-lira-muted shrink-0">{label}</span>
      <span className="flex-1 truncate">{current}</span>
      {active ? (
        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-[4px] bg-lira-online/15 text-lira-online border border-lira-online/30">
          Aplicado
        </span>
      ) : (
        <button
          type="button"
          onClick={onApply}
          className="px-2 py-0.5 rounded-[6px] bg-lira-online hover:bg-lira-ink text-lira-ground text-[9.5px] font-mono font-bold uppercase tracking-wide transition-colors"
        >
          {applyLabel}
        </button>
      )}
    </div>
  )

  return (
    <div className="space-y-6 font-mono">
      <div className="bg-lira-ground rounded-[12px] p-4 border border-dashed border-lira-rule/60 space-y-3">
        <div className="font-display text-sm font-bold text-lira-accent mb-2">Processamento de Voz & Filtros</div>

        <div className="space-y-2 pb-3 border-b border-dashed border-lira-rule/60">
          <div className="flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5 text-lira-online" />
            <div className="text-xs font-semibold text-lira-ink">
              Análise de Microfone & Supressão
            </div>
            <span
              className={`ml-auto text-[9.5px] font-mono font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-[4px] border ${
                hasUserChosenProcessorMode
                  ? 'bg-lira-surface text-lira-ink border-lira-quiet'
                  : currentCalibration
                    ? 'bg-lira-online/15 text-lira-online border-lira-online/30'
                    : 'bg-lira-panel text-lira-muted border-lira-quiet'
              }`}
              title="Origem do motor ativo"
            >
              {engineLabel}
            </span>
          </div>
          <div className="text-[10px] text-lira-muted leading-snug">
            Deixe ~2 segundos em silêncio e fale uma frase normal (5 segundos).
            Medimos o ruído da sala, sugerimos o melhor motor e gravamos uma
            amostra para comparar os 3 motores. O RNNoise é o padrão até você
            escolher outro motor abaixo.
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isCalibrating}
              onClick={handleCalibrate}
              className={`flex-1 px-3 py-2 rounded-[8px] border font-mono font-bold text-xs transition-colors flex items-center justify-center gap-1.5 ${
                isCalibrating
                  ? 'bg-lira-surface border-lira-quiet text-lira-muted cursor-wait'
                  : 'bg-lira-accent hover:bg-lira-ink border-lira-accent hover:border-lira-ink text-lira-ground'
              }`}
            >
              {isCalibrating ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Medindo... {calSecondsLeft}s</span>
                </>
              ) : currentCalibration ? (
                <>
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Analisar Novamente</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>Analisar Microfone</span>
                </>
              )}
            </button>
            {currentCalibration && !isCalibrating && (
              <button
                type="button"
                onClick={handleResetCalibration}
                className="px-2.5 py-2 rounded-[8px] border border-lira-quiet bg-lira-surface text-[10px] text-lira-muted hover:text-lira-ink hover:border-lira-rule transition-colors"
                title="Limpar análise deste microfone"
              >
                Limpar
              </button>
            )}
          </div>

          {isCalibrating && (
            <div className="bg-lira-panel border border-dashed border-lira-error/40 rounded-[12px] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lira-error opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-lira-error" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-lira-ink">
                      Gravando amostra de áudio...
                    </div>
                    <div className="text-[10px] text-lira-muted">
                      Deixe ~2 segundos em silêncio e depois fale uma frase de teste
                    </div>
                  </div>
                </div>

                <div className="text-[10.5px] font-mono tabular-nums font-bold text-lira-error bg-lira-error/15 border border-lira-error/30 px-2 py-0.5 rounded-[6px]">
                  {calSecondsLeft}s restantes
                </div>
              </div>

              <div className="h-16 bg-lira-ground rounded-[8px] px-2.5 py-1.5 flex items-center relative border border-lira-quiet overflow-hidden">
                <svg
                  viewBox="0 0 640 56"
                  preserveAspectRatio="none"
                  className="w-full h-full select-none"
                >
                  <defs>
                    <linearGradient id="live-recording-neon-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ffb0bd" />
                      <stop offset="50%" stopColor="#d1b5ff" />
                      <stop offset="100%" stopColor="#b9e99f" />
                    </linearGradient>
                  </defs>

                  {liveWaveform.map((val, idx) => {
                    const step = 640 / liveWaveform.length
                    const barWidth = 3.2
                    const maxH = 50
                    const barHeight = Math.max(6, Math.min(maxH, Math.round(val * maxH)))
                    const y = 28 - barHeight / 2
                    const x = idx * step + (step - barWidth) / 2

                    return (
                      <rect
                        key={idx}
                        x={x}
                        y={y}
                        width={barWidth}
                        height={barHeight}
                        rx={1.6}
                        ry={1.6}
                        fill="url(#live-recording-neon-grad)"
                        className="transition-all duration-75"
                      />
                    )
                  })}
                </svg>
              </div>

              <div className="h-1 bg-lira-surface rounded-[4px] overflow-hidden">
                <div
                  className="h-full bg-lira-accent transition-all duration-100"
                  style={{ width: `${Math.round(calProgress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {(currentCalibration || lastCalibration) && (() => {
            const suggestedSensitivity =
              lastCalibration?.recommendedSensitivity ??
              currentCalibration?.recommendedSensitivity ??
              MIN_RECOMMENDED_MANUAL_PERCENT
            const isManualGate = sensitivityMode === 'manual'

            return (
              <div className="text-[10px] text-lira-ink bg-lira-panel rounded-[8px] p-2.5 border border-lira-quiet leading-snug space-y-2.5">
                <div className="flex items-center gap-1 text-lira-online font-bold">
                  <Check className="w-3 h-3" />
                  <span>Resultado da análise</span>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums">
                  <span className="text-lira-muted">Ruído ambiente:</span>
                  <span>
                    {(
                      lastCalibration?.noiseFloorDb ??
                      currentCalibration?.noiseFloorDb ??
                      0
                    ).toFixed(1)}{' '}
                    dBFS
                  </span>
                  <span className="text-lira-muted">SNR estimado:</span>
                  <span>
                    {(
                      lastCalibration?.snrDb ?? currentCalibration?.snrDb ?? 0
                    ).toFixed(1)}{' '}
                    dB
                  </span>
                </div>

                <SuggestedActionRow
                  label="Motor sugerido:"
                  current={
                    <span className="font-bold text-lira-accent">
                      {engineModeLabel(
                        lastCalibration?.recommendedMode ??
                          currentCalibration?.recommendedMode ??
                          'classic'
                      )}
                    </span>
                  }
                  active={audioProcessorMode === (lastCalibration?.recommendedMode ?? currentCalibration?.recommendedMode ?? 'classic')}
                  onApply={async () => {
                    const mode =
                      lastCalibration?.recommendedMode ??
                      currentCalibration?.recommendedMode ??
                      'classic'
                    if (audioProcessorMode === mode) return
                    setAudioProcessorMode(mode)
                    await MediaManager.getInstance().reprocessStream()
                  }}
                  applyLabel="Aplicar motor"
                />

                {isManualGate ? (
                  <SuggestedActionRow
                    label="Gate manual sugerido:"
                    current={<span className="font-mono tabular-nums">{suggestedSensitivity}%</span>}
                    active={manualSensitivityThreshold === suggestedSensitivity}
                    onApply={() => {
                      setManualSensitivityThreshold(suggestedSensitivity)
                      MediaManager.getInstance().updateSensitivity('manual', suggestedSensitivity)
                    }}
                    applyLabel="Aplicar no Gate"
                  />
                ) : (
                  <div className="flex items-center gap-2 text-[10.5px] font-mono">
                    <span className="text-lira-muted shrink-0">Sensibilidade (Gate):</span>
                    <span className="flex-1 truncate text-lira-ink">
                      Ajustada em tempo real pelo modo Automático
                    </span>
                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-[4px] bg-lira-online/15 text-lira-online border border-lira-online/30 shrink-0">
                      Automático
                    </span>
                  </div>
                )}

                {lastCalibration?.rawAudioUrl && (
                  <div className="space-y-2 pt-2 border-t border-dashed border-lira-rule/60">
                    <div className="text-[10.5px] font-bold text-lira-ink flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-lira-online" />
                      <span>Comparação da Amostra Gravada</span>
                    </div>

                    <AudioSamplePlayer
                      title="Amostra Original Gravada"
                      subtitle="Áudio bruto sem nenhum filtro aplicado"
                      badge="Original Bruto"
                      badgeVariant="raw"
                      audioUrl={lastCalibration.rawAudioUrl}
                      waveform={lastCalibration.rawWaveform}
                    />

                    {lastCalibration.processedSamples ? (
                      <MultiEngineAudioPlayer
                        recommendedMode={lastCalibration.recommendedMode}
                        recommendedSensitivity={lastCalibration.recommendedSensitivity}
                        gateMode={lastCalibration.gateMode}
                        activeMode={audioProcessorMode}
                        samples={lastCalibration.processedSamples}
                        onApplyEngine={async (mode) => {
                          setAudioProcessorMode(mode)
                          await MediaManager.getInstance().reprocessStream()
                        }}
                      />
                    ) : lastCalibration.processedAudioUrl ? (
                      <AudioSamplePlayer
                        title="Como vai ficar com as alterações"
                        subtitle={
                          lastCalibration.gateMode === 'manual'
                            ? `Processado com ${engineModeLabel(lastCalibration.recommendedMode)} + Gate Manual (${lastCalibration.recommendedSensitivity}%)`
                            : `Processado com ${engineModeLabel(lastCalibration.recommendedMode)} + Gate Automático`
                        }
                        badge="Com Alterações"
                        badgeVariant="processed"
                        audioUrl={lastCalibration.processedAudioUrl}
                        waveform={lastCalibration.processedWaveform}
                        applyLabel={isManualGate ? 'Aplicar Tudo' : 'Aplicar Motor'}
                        onApplySettings={async () => {
                          setAudioProcessorMode(lastCalibration.recommendedMode)
                          if (isManualGate) {
                            setManualSensitivityThreshold(lastCalibration.recommendedSensitivity)
                            MediaManager.getInstance().updateSensitivity('manual', lastCalibration.recommendedSensitivity)
                          }
                          await MediaManager.getInstance().reprocessStream()
                        }}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-lira-ink">
                <span>Motor de Supressão de Ruído</span>
              </div>
              <div className="text-[10px] text-lira-muted">
                Escolha entre DeepFilterNet, RNNoise e DSP clássico
              </div>
              {processingMode !== 'classic' && (
                <div className="mt-1.5 space-y-1" role="status" aria-live="polite">
                  <span className="text-[10px] text-lira-ink">
                    {!isNoiseSuppressionEnabled ? 'Supressão desativada'
                      : noiseSuppressionDisplay(true, processingMode, rnnoiseStatus, deepFilterStatus).notice
                        || 'Rede neural ativa'}
                  </span>
                  {isNoiseSuppressionEnabled && noiseSuppressionDisplay(true, processingMode, rnnoiseStatus, deepFilterStatus).canRetry && (
                    <button type="button" onClick={() => MediaManager.getInstance().reprocessStream()}
                      className="ml-2 text-[10px] text-lira-accent underline"
                      title={`Reinicializa o motor ${processingMode === 'deepfilter' ? 'DeepFilterNet' : 'RNNoise'} sem sair da chamada`}>
                      Tentar de novo
                    </button>
                  )}
                  {(processingMode === 'deepfilter' ? deepFilterError : rnnoiseError) && (
                    <div className="text-[9.5px] text-lira-error">Motivo: {processingMode === 'deepfilter' ? deepFilterError : rnnoiseError}</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                {
                  id: 'deepfilter',
                  title: 'DeepFilterNet',
                  desc: 'O melhor, porém mais lento, com fallback para RNNoise',
                },
                {
                  id: 'rnnoise',
                  title: 'RNNoise Neural',
                  desc: 'Rápido e eficiente',
                },
                {
                  id: 'classic',
                  title: 'DSP Clássico',
                  desc: 'Corte agressivo. Baixo CPU.',
                },
              ] as Array<{ id: AudioProcessorMode; title: string; desc: string }>
            ).map((opt) => {
              const selected = processingMode === opt.id
              const isRecommended =
                selected &&
                currentCalibration?.recommendedMode === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={async () => {
                    if (audioProcessorMode === opt.id) return
                    setAudioProcessorMode(opt.id)
                    await MediaManager.getInstance().reprocessStream()
                  }}
                  className={`text-left p-2 rounded-[8px] border transition-colors ${
                    selected
                      ? isRecommended
                        ? 'border-lira-online bg-lira-online/10'
                        : 'border-lira-accent bg-lira-surface'
                      : 'border-lira-quiet bg-lira-panel hover:border-lira-rule'
                  }`}
                >
                  <div
                    className={`text-[11px] font-bold flex items-center gap-1 ${
                      isRecommended
                        ? 'text-lira-online'
                        : selected
                          ? 'text-lira-accent'
                          : 'text-lira-ink'
                    }`}
                  >
                    {opt.title}
                    {isRecommended && (
                      <span
                        className="text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded-[4px] bg-lira-online/20 text-lira-online"
                        title="Recomendação da calibração"
                      >
                        Recomendado
                      </span>
                    )}
                  </div>
                  <div className="text-[9.5px] text-lira-muted mt-0.5 leading-tight">
                    {opt.desc}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between py-1 border-t border-dashed border-lira-rule/60 pt-3 mt-1">
          <div>
            <div className="text-xs font-semibold text-lira-ink">Supressor de Ruído DSP</div>
            <div className="text-[10px] text-lira-muted">
              Filtra ventiladores, cliques de teclado e zumbidos elétricos
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isNoiseSuppressionEnabled}
              onChange={() => {
                toggleNoiseSuppression()
                MediaManager.getInstance().updateNoiseSuppression(!isNoiseSuppressionEnabled)
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-lira-surface border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lira-accent peer-checked:border-lira-accent"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1 border-t border-dashed border-lira-rule/60">
          <div>
            <div className="text-xs font-semibold text-lira-ink">Cancelamento de Eco Acústico (AEC)</div>
            <div className="text-[10px] text-lira-muted">
              Evita que o som dos alto-falantes retorne para o microfone
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={echoCancellation}
              onChange={(e) => {
                setEchoCancellation(e.target.checked)
                void MediaManager.getInstance().updateCaptureProcessing()
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-lira-surface border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lira-accent peer-checked:border-lira-accent"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1 border-t border-dashed border-lira-rule/60">
          <div>
            <div className="text-xs font-semibold text-lira-ink">Controle Automático de Ganho (AGC)</div>
            <div className="text-[10px] text-lira-muted">
              Nivela vozes baixas e altas automaticamente para um volume confortável
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={autoGainControl}
              onChange={(e) => {
                setAutoGainControl(e.target.checked)
                void MediaManager.getInstance().updateCaptureProcessing()
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-lira-surface border border-lira-rule peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-lira-ground after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-lira-ink peer-checked:after:bg-lira-ground after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-lira-accent peer-checked:border-lira-accent"></div>
          </label>
        </div>
      </div>
    </div>
  )
}


