import React, { useState, useEffect, useRef } from 'react'
import { Mic, RotateCw, Check, Volume2 } from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'
import { MediaManager } from '../../media/MediaManager'
import { AudioProcessorMode } from '../../types/audio'
import { AudioSamplePlayer } from './AudioSamplePlayer'
import { MultiEngineAudioPlayer } from './MultiEngineAudioPlayer'
import { ProcessedSampleInfo } from '../../media/MicCalibrator'
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
  const setSensitivityMode = useMediaStore((s) => s.setSensitivityMode)
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
    <div className="flex items-center gap-2 text-[10.5px]">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span className="flex-1 truncate">{current}</span>
      {active ? (
        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
          Aplicado
        </span>
      ) : (
        <button
          type="button"
          onClick={onApply}
          className="px-2 py-0.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[9.5px] font-bold uppercase tracking-wide transition-colors active:scale-95"
        >
          {applyLabel}
        </button>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="bg-[#12151d]/70 rounded-2xl p-4 border border-[#2a3142] space-y-3">
        <div className="text-xs font-bold text-slate-200 mb-2">Processamento de Voz & Filtros</div>

        <div className="space-y-2 pb-3 border-b border-[#2a3142]">
          <div className="flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5 text-emerald-400" />
            <div className="text-xs font-semibold text-slate-200">
              Calibração Automática de Microfone
            </div>
            <span
              className={`ml-auto text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                hasUserChosenProcessorMode
                  ? 'bg-slate-700 text-slate-300'
                  : currentCalibration
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-slate-800 text-slate-400'
              }`}
              title="Origem do motor ativo"
            >
              {engineLabel}
            </span>
          </div>
          <div className="text-[10px] text-slate-400 leading-snug">
            Fique em silêncio por 3 segundos. Medimos o ruído ambiente e
            sugerimos o motor e a sensibilidade. O RNNoise é o padrão até você
            escolher outro motor abaixo.
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isCalibrating}
              onClick={handleCalibrate}
              className={`flex-1 px-3 py-2 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 ${
                isCalibrating
                  ? 'bg-slate-800 text-slate-400 cursor-wait'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-600/20 active:scale-95'
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
                  <span>Recalibrar</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>Calibrar Microfone</span>
                </>
              )}
            </button>
            {currentCalibration && !isCalibrating && (
              <button
                type="button"
                onClick={handleResetCalibration}
                className="px-2 py-2 rounded-xl text-[10px] text-slate-400 hover:text-slate-200 hover:bg-[#2b2d31]"
                title="Limpar calibração deste microfone"
              >
                Limpar
              </button>
            )}
          </div>

          {isCalibrating && (
            <div className="bg-[#121620] border border-rose-500/30 rounded-2xl p-3.5 space-y-2.5 shadow-lg shadow-rose-950/20 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-slate-200">
                      Gravando amostra de áudio...
                    </div>
                    <div className="text-[10px] text-slate-400">
                      Fale uma frase de teste ou faça barulhos comuns da sua sala
                    </div>
                  </div>
                </div>

                <div className="text-[10.5px] font-mono font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-lg">
                  {calSecondsLeft}s restantes
                </div>
              </div>

              <div className="h-16 bg-slate-950/95 rounded-xl px-2.5 py-1.5 flex items-center relative border border-slate-800/90 shadow-inner overflow-hidden">
                <svg
                  viewBox="0 0 640 56"
                  preserveAspectRatio="none"
                  className="w-full h-full select-none"
                >
                  <defs>
                    <linearGradient id="live-recording-neon-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ff0055" />
                      <stop offset="25%" stopColor="#d9008f" />
                      <stop offset="50%" stopColor="#9d00ff" />
                      <stop offset="75%" stopColor="#4f46e5" />
                      <stop offset="100%" stopColor="#00f2fe" />
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

              <div className="h-1 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 transition-all duration-100"
                  style={{ width: `${Math.round(calProgress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {(currentCalibration || lastCalibration) && (
            <div className="text-[10px] text-slate-300 bg-[#1b202c] rounded-xl p-2.5 border border-[#2a3142] leading-snug space-y-2.5">
              <div className="flex items-center gap-1 text-emerald-300 font-bold">
                <Check className="w-3 h-3" />
                <span>Resultado da calibração</span>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
                <span className="text-slate-400">Ruído ambiente:</span>
                <span>
                  {(
                    lastCalibration?.noiseFloorDb ??
                    currentCalibration?.noiseFloorDb ??
                    0
                  ).toFixed(1)}{' '}
                  dBFS
                </span>
                <span className="text-slate-400">SNR estimado:</span>
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
                  <span className="font-bold text-indigo-300">
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

              <SuggestedActionRow
                label="Sensibilidade (Gate):"
                current={
                  <span className="font-mono flex items-center gap-1.5">
                    <span>
                      {lastCalibration?.recommendedSensitivity ??
                        currentCalibration?.recommendedSensitivity ??
                        20}
                      %
                    </span>
                    {sensitivityMode === 'auto' && (
                      <span className="text-[9px] text-amber-400 font-sans font-normal">
                        (Gate em Automático)
                      </span>
                    )}
                  </span>
                }
                active={
                  sensitivityMode === 'manual' &&
                  manualSensitivityThreshold ===
                    (lastCalibration?.recommendedSensitivity ??
                      currentCalibration?.recommendedSensitivity ??
                      20)
                }
                onApply={() => {
                  const sens =
                    lastCalibration?.recommendedSensitivity ??
                    currentCalibration?.recommendedSensitivity ??
                    20
                  setSensitivityMode('manual')
                  setManualSensitivityThreshold(sens)
                  MediaManager.getInstance().updateSensitivity('manual', sens)
                }}
                applyLabel="Aplicar no Gate (Ativar Manual)"
              />

              {lastCalibration?.rawAudioUrl && (
                <div className="space-y-2 pt-2 border-t border-[#2a3142]/80">
                  <div className="text-[10.5px] font-bold text-slate-200 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
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
                      activeMode={audioProcessorMode}
                      samples={lastCalibration.processedSamples}
                      onApplyEngine={async (mode) => {
                        setAudioProcessorMode(mode)
                        setSensitivityMode('manual')
                        setManualSensitivityThreshold(lastCalibration.recommendedSensitivity)
                        MediaManager.getInstance().updateSensitivity('manual', lastCalibration.recommendedSensitivity)
                        await MediaManager.getInstance().reprocessStream()
                      }}
                    />
                  ) : lastCalibration.processedAudioUrl ? (
                    <AudioSamplePlayer
                      title="Como vai ficar com as alterações"
                      subtitle={`Processado com ${engineModeLabel(lastCalibration.recommendedMode)} + Noise Gate (${lastCalibration.recommendedSensitivity}%)`}
                      badge="Com Alterações"
                      badgeVariant="processed"
                      audioUrl={lastCalibration.processedAudioUrl}
                      waveform={lastCalibration.processedWaveform}
                      applyLabel="Aplicar Tudo"
                      onApplySettings={async () => {
                        setAudioProcessorMode(lastCalibration.recommendedMode)
                        setSensitivityMode('manual')
                        setManualSensitivityThreshold(lastCalibration.recommendedSensitivity)
                        MediaManager.getInstance().updateSensitivity('manual', lastCalibration.recommendedSensitivity)
                        await MediaManager.getInstance().reprocessStream()
                      }}
                    />
                  ) : null}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-200">
                <span>Motor de Supressão de Ruído</span>
              </div>
              <div className="text-[10px] text-slate-400">
                Escolha entre DeepFilterNet, RNNoise e DSP clássico
              </div>
              {processingMode !== 'classic' && (
                <div className="mt-1.5 space-y-1" role="status" aria-live="polite">
                  <span className="text-[10px] text-slate-300">
                    {!isNoiseSuppressionEnabled ? 'Supressão desativada'
                      : noiseSuppressionDisplay(true, processingMode, rnnoiseStatus, deepFilterStatus).notice
                        || 'Rede neural ativa'}
                  </span>
                  {isNoiseSuppressionEnabled && noiseSuppressionDisplay(true, processingMode, rnnoiseStatus, deepFilterStatus).canRetry && (
                    <button type="button" onClick={() => MediaManager.getInstance().reprocessStream()}
                      className="ml-2 text-[10px] text-indigo-300"
                      title={`Reinicializa o motor ${processingMode === 'deepfilter' ? 'DeepFilterNet' : 'RNNoise'} sem sair da chamada`}>
                      Tentar de novo
                    </button>
                  )}
                  {(processingMode === 'deepfilter' ? deepFilterError : rnnoiseError) && (
                    <div className="text-[9.5px] text-rose-300/80">Motivo: {processingMode === 'deepfilter' ? deepFilterError : rnnoiseError}</div>
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
                  className={`text-left p-2 rounded-xl border transition-colors ${
                    selected
                      ? isRecommended
                        ? 'border-emerald-500/70 bg-emerald-500/10'
                        : 'border-indigo-500 bg-indigo-500/15'
                      : 'border-[#2a3142] bg-[#1b202c] hover:border-indigo-400/60'
                  }`}
                >
                  <div
                    className={`text-[11px] font-bold flex items-center gap-1 ${
                      isRecommended
                        ? 'text-emerald-200'
                        : selected
                          ? 'text-indigo-200'
                          : 'text-slate-200'
                    }`}
                  >
                    {opt.title}
                    {isRecommended && (
                      <span
                        className="text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-emerald-500/30 text-emerald-200"
                        title="Recomendação da calibração"
                      >
                        Recomendado
                      </span>
                    )}
                  </div>
                  <div className="text-[9.5px] text-slate-400 mt-0.5 leading-tight">
                    {opt.desc}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between py-1 border-t border-[#2a3142] pt-3 mt-1">
          <div>
            <div className="text-xs font-semibold text-slate-200">Supressor de Ruído DSP</div>
            <div className="text-[10px] text-slate-400">
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
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1 border-t border-[#2a3142]">
          <div>
            <div className="text-xs font-semibold text-slate-200">Cancelamento de Eco Acústico (AEC)</div>
            <div className="text-[10px] text-slate-400">
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
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between py-1 border-t border-[#2a3142]">
          <div>
            <div className="text-xs font-semibold text-slate-200">Controle Automático de Ganho (AGC)</div>
            <div className="text-[10px] text-slate-400">
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
            <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>
      </div>
    </div>
  )
}


