import React, { useState, useEffect, useRef } from 'react'
import {
  Mic,
  Headphones,
  Play,
  Activity,
  Radio,
  CheckCircle2,
  Video,
  VideoOff,
  Info,
  AlertTriangle,
  Volume2,
  Sparkles,
  Calendar,
} from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'
import {
  playSoundEffect,
  SoundEffectType,
  SOUND_EFFECT_LABELS,
  SOUND_THEMES,
  SoundTheme,
  resolveEffectiveSoundTheme,
} from '../../utils/soundEffects'
import { MediaManager } from '../../media/MediaManager'
import { attachStreamToVideo } from '../../media/attachVideoElement'
import { resolveNoiseProcessorPreference } from '../../media/noiseSuppressionStatus'
import { AudioDeviceInfo, SensitivityMode } from '../../types/audio'
import { CustomDropdown } from '../common/CustomDropdown'
import { toDeviceOptions } from './deviceOptions'
import { ParsecEchoSettings } from './ParsecEchoSettings'

interface Props {
  inputDevices: AudioDeviceInfo[]
  outputDevices: AudioDeviceInfo[]
  videoDevices: AudioDeviceInfo[]
  isPlayingTestSound: boolean
  onPlayTestSound: (deviceId?: string) => void
}

export const AudioDevicesTab: React.FC<Props> = ({
  inputDevices,
  outputDevices,
  videoDevices,
  isPlayingTestSound,
  onPlayTestSound,
}) => {
  const selectedAudioInput = useMediaStore((s) => s.selectedAudioInput)
  const selectedAudioOutput = useMediaStore((s) => s.selectedAudioOutput)
  const selectedVideoInput = useMediaStore((s) => s.selectedVideoInput)
  const inputVolume = useMediaStore((s) => s.inputVolume)
  const outputVolume = useMediaStore((s) => s.outputVolume)
  const sensitivityMode = useMediaStore((s) => s.sensitivityMode)
  const manualSensitivityThreshold = useMediaStore((s) => s.manualSensitivityThreshold)
  const autoThresholdPercent = useMediaStore((s) => s.autoThresholdPercent)
  const localAudioLevel = useMediaStore((s) => s.localAudioLevel)
  const isGateOpen = useMediaStore((s) => s.isGateOpen)
  const isTestingMic = useMediaStore((s) => s.isTestingMic)
  const setInputVolume = useMediaStore((s) => s.setInputVolume)
  const setOutputVolume = useMediaStore((s) => s.setOutputVolume)
  const setSensitivityMode = useMediaStore((s) => s.setSensitivityMode)
  const setManualSensitivityThreshold = useMediaStore((s) => s.setManualSensitivityThreshold)
  const soundEffectsEnabled = useMediaStore((s) => s.soundEffectsEnabled)
  const soundEffectsVolume = useMediaStore((s) => s.soundEffectsVolume)
  const soundTheme = useMediaStore((s) => s.soundTheme)
  const setSoundEffectsEnabled = useMediaStore((s) => s.setSoundEffectsEnabled)
  const setSoundEffectsVolume = useMediaStore((s) => s.setSoundEffectsVolume)
  const setSoundTheme = useMediaStore((s) => s.setSoundTheme)
  const micCalibrations = useMediaStore((s) => s.micCalibrations)
  const currentCalibration = micCalibrations[selectedAudioInput]
  const processingMode = useMediaStore(resolveNoiseProcessorPreference)
  const isNoiseSuppressionEnabled = useMediaStore((s) => s.isNoiseSuppressionEnabled)
  const deepFilterStatus = useMediaStore((s) => s.deepFilterStatus)
  const isDeepFilterContinuous =
    isNoiseSuppressionEnabled && processingMode === 'deepfilter' && deepFilterStatus === 'ready'

  const activeSeasonalTheme = resolveEffectiveSoundTheme('auto')

  const [isTestingCamera, setIsTestingCamera] = useState(false)
  const [cameraTestStream, setCameraTestStream] = useState<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null)
  const cameraTestStreamRef = useRef<MediaStream | null>(null)
  const isBorrowedRef = useRef(false)

  const stopCameraTest = () => {
    if (cameraTestStreamRef.current) {
      if (!isBorrowedRef.current) {
        cameraTestStreamRef.current.getTracks().forEach((t) => t.stop())
      }
      cameraTestStreamRef.current = null
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null
    }
    setCameraTestStream(null)
    setIsTestingCamera(false)
  }

  const startCameraTest = async (deviceId?: string) => {
    stopCameraTest()
    setCameraError(null)
    const targetId = deviceId || (selectedVideoInput !== 'default' ? selectedVideoInput : undefined)

    try {
      const localStream = useMediaStore.getState().localStream
      const isCameraOff = useMediaStore.getState().isCameraOff

      const existingLiveTrack =
        !isCameraOff &&
        localStream?.getVideoTracks().find((t) => !(t as any).__isDummy && t.readyState === 'live')

      let stream: MediaStream | null = null
      let isBorrowed = false

      if (existingLiveTrack) {
        const trackSettings = existingLiveTrack.getSettings ? existingLiveTrack.getSettings() : {}
        const matchesDevice =
          !targetId ||
          targetId === 'default' ||
          !trackSettings.deviceId ||
          trackSettings.deviceId === targetId

        if (matchesDevice) {
          stream = new MediaStream([existingLiveTrack])
          isBorrowed = true
        }
      }

      if (!stream) {
        try {
          const constraints: MediaStreamConstraints = {
            video: targetId && targetId !== 'default'
              ? { deviceId: { exact: targetId }, width: { ideal: 640 }, height: { ideal: 480 } }
              : { width: { ideal: 640 }, height: { ideal: 480 } },
          }
          stream = await navigator.mediaDevices.getUserMedia(constraints)
        } catch {
          try {
            const fallbackConstraints: MediaStreamConstraints = {
              video: targetId && targetId !== 'default'
                ? { deviceId: { exact: targetId }, width: { ideal: 640 }, height: { ideal: 480 } }
                : true,
            }
            stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints)
          } catch {
            stream = await navigator.mediaDevices.getUserMedia({ video: true })
          }
        }
        isBorrowed = false
      }

      isBorrowedRef.current = isBorrowed
      cameraTestStreamRef.current = stream
      setCameraTestStream(stream)
      setIsTestingCamera(true)
    } catch (err: any) {
      console.warn('[AudioDevicesTab] Failed to test camera:', err)
      setCameraError('Não foi possível inicializar a prévia da câmera. Verifique permissões ou selecione outro dispositivo.')
      setIsTestingCamera(false)
    }
  }

  useEffect(() => {
    if (isTestingCamera && cameraTestStream && videoPreviewRef.current) {
      const cleanup = attachStreamToVideo(videoPreviewRef.current, cameraTestStream, {
        tile: 'camera-preview',
        peer: 'local-preview',
        isLocal: true,
        muted: true,
      })
      return cleanup
    }
  }, [isTestingCamera, cameraTestStream])

  const handleVideoInputChange = async (deviceId: string) => {
    await MediaManager.getInstance().changeVideoInput(deviceId)
    if (isTestingCamera) {
      startCameraTest(deviceId)
    }
  }

  useEffect(() => {
    return () => {
      stopCameraTest()
    }
  }, [])

  const activeCameraLabel = videoDevices.find((d) => d.deviceId === selectedVideoInput)?.label || ''
  const isObsVirtualCamera =
    activeCameraLabel.toLowerCase().includes('obs') ||
    activeCameraLabel.toLowerCase().includes('virtual')

  const handleInputChange = async (deviceId: string) => {
    await MediaManager.getInstance().changeAudioInput(deviceId)
  }

  const handleOutputChange = async (deviceId: string) => {
    await MediaManager.getInstance().changeAudioOutput(deviceId)
  }

  const handleInputVolumeChange = (vol: number) => {
    setInputVolume(vol)
    MediaManager.getInstance().updateInputVolume(vol)
  }

  const handleOutputVolumeChange = (vol: number) => {
    setOutputVolume(vol)
    const elements = document.querySelectorAll('video, audio')
    elements.forEach((el: any) => {
      if (!el.muted) {
        el.volume = Math.max(0, Math.min(1, vol / 100))
      }
    })
  }

  const handleSensitivityModeToggle = (mode: SensitivityMode) => {
    setSensitivityMode(mode)
    MediaManager.getInstance().updateSensitivity(mode, manualSensitivityThreshold)
  }

  const handleThresholdChange = (val: number) => {
    setManualSensitivityThreshold(val)
    MediaManager.getInstance().updateSensitivity('manual', val)
  }

  const handleTestMicToggle = async () => {
    const nextTesting = !isTestingMic
    await MediaManager.getInstance().setTestMic(nextTesting)
  }

  return (
    <div className="space-y-6 font-mono">
      <ParsecEchoSettings />
      <div className="bg-lira-ground rounded-[12px] p-4 border border-dashed border-lira-rule/60 space-y-3.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs font-bold text-lira-ink">
            <Video className="w-4 h-4 text-lira-accent" />
            <span>Dispositivo de Vídeo (Câmera / Webcam)</span>
          </label>
          <button
            type="button"
            onClick={() => (isTestingCamera ? stopCameraTest() : startCameraTest())}
            className={`px-3 py-1.5 text-xs font-mono font-bold rounded-[8px] border transition-colors flex items-center gap-1.5 ${
              isTestingCamera
                ? 'bg-lira-error/15 hover:bg-lira-error border-lira-error/40 text-lira-error hover:text-lira-ground animate-pulse'
                : 'bg-lira-accent hover:bg-lira-ink border-lira-accent hover:border-lira-ink text-lira-ground'
            }`}
          >
            {isTestingCamera ? <VideoOff className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
            <span>{isTestingCamera ? 'Parar Teste' : 'Testar Câmera'}</span>
          </button>
        </div>

        <CustomDropdown
          value={selectedVideoInput}
          options={toDeviceOptions(videoDevices, 'Câmera', (cls) => <Video className={cls} />)}
          onChange={handleVideoInputChange}
          fullWidth
          size="md"
          buttonClassName="bg-lira-surface hover:border-lira-accent border-lira-rule"
        />

        {isObsVirtualCamera && (
          <div className="p-3 bg-lira-amber/10 border border-dashed border-lira-amber/40 rounded-[8px] flex items-start gap-2.5 text-xs text-lira-amber">
            <Info className="w-4 h-4 text-lira-amber shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">OBS Virtual Camera detectada</span>
              <p className="text-[11px] text-lira-amber/80 mt-0.5">
                Se a imagem estiver preta, abra o OBS Studio e clique em <b>"Iniciar Câmera Virtual"</b>, ou selecione sua webcam física na lista acima.
              </p>
            </div>
          </div>
        )}

        {cameraError && (
          <div className="p-3 bg-lira-error/10 border border-dashed border-lira-error/40 rounded-[8px] flex items-start gap-2.5 text-xs text-lira-error">
            <AlertTriangle className="w-4 h-4 text-lira-error shrink-0 mt-0.5" />
            <span>{cameraError}</span>
          </div>
        )}

        {isTestingCamera && (
          <div className="relative w-full aspect-video max-h-56 bg-lira-ground rounded-[8px] overflow-hidden border border-lira-quiet flex items-center justify-center">
            <video
              ref={(el) => {
                videoPreviewRef.current = el
                if (el && cameraTestStream) {
                  attachStreamToVideo(el, cameraTestStream, {
                    tile: 'camera-preview',
                    peer: 'local-preview',
                    isLocal: true,
                    muted: true,
                  })
                }
              }}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />
            <div className="absolute top-2 left-2 px-2 py-0.5 bg-lira-online text-lira-ground text-[10px] font-mono font-bold rounded-[4px] flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-lira-ground animate-pulse" />
              <span>PRÉVIA EM TEMPO REAL</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between h-7">
            <label className="flex items-center gap-2 text-xs font-bold text-lira-ink">
              <Mic className="w-4 h-4 text-lira-accent" />
              <span>Dispositivo de Entrada (Microfone)</span>
            </label>
          </div>
          <CustomDropdown
            value={selectedAudioInput}
            options={toDeviceOptions(inputDevices, 'Microfone', (cls) => <Mic className={cls} />)}
            onChange={handleInputChange}
            fullWidth
            size="md"
            buttonClassName="bg-lira-surface hover:border-lira-accent border-lira-rule"
          />

          <div className="pt-2">
            <div className="flex items-center justify-between text-[11px] text-lira-muted mb-1.5">
              <span>Volume de Entrada (Ganho)</span>
              <span className="font-mono tabular-nums font-bold text-lira-accent">{inputVolume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={inputVolume}
              onChange={(e) => handleInputVolumeChange(Number(e.target.value))}
              className="w-full h-2 bg-lira-surface rounded-[4px] appearance-none cursor-pointer accent-lira-accent"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between h-7">
            <label className="flex items-center gap-2 text-xs font-bold text-lira-ink">
              <Headphones className="w-4 h-4 text-lira-accent" />
              <span>Dispositivo de Saída</span>
            </label>
            <button
              type="button"
              disabled={isPlayingTestSound}
              onClick={() => onPlayTestSound(selectedAudioOutput)}
              className={`text-[10px] font-mono font-bold px-2 py-1 rounded-[6px] border transition-colors flex items-center gap-1 ${
                isPlayingTestSound
                  ? 'bg-lira-online/15 border-lira-online text-lira-online animate-pulse cursor-not-allowed opacity-80'
                  : 'bg-lira-surface border-lira-rule text-lira-ink hover:text-lira-accent hover:border-lira-accent'
              }`}
              title="Testar saída de áudio"
            >
              <Play className="w-3 h-3" />
              <span>{isPlayingTestSound ? 'Tocando...' : 'Testar Som'}</span>
            </button>
          </div>
          <CustomDropdown
            value={selectedAudioOutput}
            options={toDeviceOptions(outputDevices, 'Alto-Falante', (cls) => <Headphones className={cls} />)}
            onChange={handleOutputChange}
            fullWidth
            size="md"
            buttonClassName="bg-lira-surface hover:border-lira-accent border-lira-rule"
          />

          <div className="pt-2">
            <div className="flex items-center justify-between text-[11px] text-lira-muted mb-1.5">
              <span>Volume de Saída dos Participantes</span>
              <span className="font-mono tabular-nums font-bold text-lira-accent">{outputVolume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={outputVolume}
              onChange={(e) => handleOutputVolumeChange(Number(e.target.value))}
              className="w-full h-2 bg-lira-surface rounded-[4px] appearance-none cursor-pointer accent-lira-accent"
            />
          </div>
        </div>
      </div>

      <div className="bg-lira-ground rounded-[12px] p-4 border border-dashed border-lira-rule/60 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-lira-online" />
            <span className="font-display text-sm font-bold text-lira-ink">Teste do Microfone</span>
          </div>
          <button
            type="button"
            onClick={handleTestMicToggle}
            className={`px-3.5 py-1.5 rounded-[8px] border text-xs font-mono font-bold transition-colors flex items-center gap-1.5 ${
              isTestingMic
                ? 'bg-lira-error/15 border-lira-error/40 text-lira-error animate-pulse'
                : 'bg-lira-accent hover:bg-lira-ink border-lira-accent hover:border-lira-ink text-lira-ground'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{isTestingMic ? 'Parar Teste' : 'Testar Microfone'}</span>
          </button>
        </div>

        {isTestingMic && (
          <div className="text-[11px] text-lira-accent bg-lira-surface border border-lira-rule p-2.5 rounded-[8px] flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-lira-accent shrink-0" />
            <span>Fale no microfone para ouvir o retorno em tempo real nos seus fones de ouvido!</span>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-lira-muted">
            <span>Nível de Entrada Sonoro</span>
            <span className={isGateOpen ? 'text-lira-online font-bold' : 'text-lira-muted'}>
              {isGateOpen ? '● Microfone Aberto (Voz Detectada)' : '○ Filtrando Ruído'}
            </span>
          </div>

          <div className="relative w-full h-4 bg-lira-panel rounded-[6px] overflow-hidden border border-lira-quiet p-0.5">
            <div
              className={`h-full rounded-[4px] transition-all duration-75 ${
                isGateOpen
                  ? 'bg-lira-online'
                  : 'bg-lira-surface'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, localAudioLevel * 100))}%` }}
            />

            {sensitivityMode === 'manual' && (
              <div
                className="absolute top-0 bottom-0 w-1 bg-lira-amber z-10 pointer-events-none"
                style={{ left: `${manualSensitivityThreshold}%` }}
                title={`Limiar de Sensibilidade Manual: ${manualSensitivityThreshold}%`}
              >
                <div className="w-2.5 h-2.5 bg-lira-amber rotate-45 -translate-x-1/3 -translate-y-1/3 rounded-xs" />
              </div>
            )}

            {sensitivityMode === 'auto' && autoThresholdPercent > 0 && (
              <div
                className="absolute top-0 bottom-0 w-1 bg-lira-online z-10 transition-all duration-150 pointer-events-none"
                style={{ left: `${autoThresholdPercent}%` }}
                title={`Limiar Adaptativo Atual: ${autoThresholdPercent}%`}
              >
                <div className="w-2.5 h-2.5 bg-lira-online rotate-45 -translate-x-1/3 -translate-y-1/3 rounded-xs opacity-90" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-lira-ground rounded-[12px] p-4 border border-dashed border-lira-rule/60 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="font-display text-sm font-bold text-lira-ink">Sensibilidade de Entrada (Noise Gate)</span>
            <p className="text-[11px] text-lira-muted">
              Determina o volume mínimo para o microfone abrir e transmitir sua voz
            </p>
          </div>

          <div className="flex bg-lira-panel p-1 rounded-[8px] border border-lira-quiet">
            <button
              type="button"
              onClick={() => handleSensitivityModeToggle('auto')}
              className={`px-3 py-1 text-[11px] font-mono font-bold rounded-[6px] transition-colors ${
                sensitivityMode === 'auto'
                  ? 'bg-lira-accent text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink'
              }`}
            >
              Automático
            </button>
            <button
              type="button"
              onClick={() => handleSensitivityModeToggle('manual')}
              className={`px-3 py-1 text-[11px] font-mono font-bold rounded-[6px] transition-colors ${
                sensitivityMode === 'manual'
                  ? 'bg-lira-accent text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink'
              }`}
            >
              Manual
            </button>
          </div>
        </div>

        {sensitivityMode === 'manual' ? (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-[11px] text-lira-ink">
              <div className="flex items-center gap-2">
                <span>Limiar de Ativação Manual</span>
                {currentCalibration && currentCalibration.recommendedSensitivity !== manualSensitivityThreshold && (
                  <button
                    type="button"
                    onClick={() => handleThresholdChange(currentCalibration.recommendedSensitivity)}
                    className="text-[9.5px] font-mono tabular-nums px-1.5 py-0.5 rounded-[4px] bg-lira-amber/15 text-lira-amber hover:bg-lira-amber/25 transition-colors cursor-pointer"
                    title="Usar limiar manual sugerido pela análise do microfone"
                  >
                    Usar sugerido ({currentCalibration.recommendedSensitivity}%)
                  </button>
                )}
              </div>
              <span className="font-mono tabular-nums font-bold text-lira-amber">{manualSensitivityThreshold}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={manualSensitivityThreshold}
              onChange={(e) => handleThresholdChange(Number(e.target.value))}
              className="w-full h-2 bg-lira-surface rounded-[4px] appearance-none cursor-pointer accent-lira-amber"
            />
            <p className="text-[10px] text-lira-muted">
              Ajuste a barra para que o ruído de fundo fique à esquerda do marcador amarelo e sua voz normal fique à direita.
            </p>
          </div>
        ) : (
          <div className="text-[11px] text-lira-online bg-lira-online/10 border border-dashed border-lira-online/30 p-2.5 rounded-[8px]">
            <div className="flex items-center justify-between gap-2">
              <span>
                {isDeepFilterContinuous
                  ? 'O DeepFilterNet remove o ruído continuamente sem precisar fechar o microfone; o limiar acompanha apenas o indicador de voz.'
                  : 'O sistema detecta dinamicamente os barulhos da sua sala e ajusta o corte automaticamente em tempo real.'}
              </span>
              {autoThresholdPercent > 0 && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded-[4px] bg-lira-online/15 text-lira-online font-mono tabular-nums font-bold border border-lira-online/30 shrink-0"
                  title="Limiar adaptativo calculado em tempo real para o ruído da sala"
                >
                  {isDeepFilterContinuous ? `Detecção: ~${autoThresholdPercent}%` : `Corte atual: ~${autoThresholdPercent}%`}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="bg-lira-ground rounded-[12px] p-4 border border-dashed border-lira-rule/60 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-lira-accent shrink-0" />
              <span className="font-display text-sm font-bold text-lira-ink">Efeitos Sonoros</span>
            </div>
            <p className="text-[11px] text-lira-muted">
              Sons de notificação ao mutar microfone, ensurdecer, entrar ou sair de chamadas e transmissão
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={soundEffectsEnabled}
            onClick={() => setSoundEffectsEnabled(!soundEffectsEnabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-lira-accent cursor-pointer ${
              soundEffectsEnabled ? 'bg-lira-accent border-lira-accent' : 'bg-lira-surface border-lira-rule'
            }`}
            title={soundEffectsEnabled ? 'Desativar efeitos sonoros' : 'Ativar efeitos sonoros'}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full transition-transform ${
                soundEffectsEnabled ? 'translate-x-[23px] bg-lira-ground' : 'translate-x-[3px] bg-lira-ink'
              }`}
            />
          </button>
        </div>

        {soundEffectsEnabled && (
          <div className="space-y-3 pt-2 border-t border-dashed border-lira-rule/60">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-lira-ink">
                <span className="text-lira-muted font-medium">Volume dos Efeitos</span>
                <span className="font-mono tabular-nums font-bold text-lira-accent">{soundEffectsVolume}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={soundEffectsVolume}
                onChange={(e) => setSoundEffectsVolume(Number(e.target.value))}
                className="w-full h-2 bg-lira-surface rounded-[4px] appearance-none cursor-pointer accent-lira-accent"
              />
            </div>

            <div className="space-y-2 pt-2 border-t border-dashed border-lira-rule/60">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-lira-amber" />
                    <span className="text-xs font-bold text-lira-ink">Tema dos Efeitos (Sons por Data)</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-[6px] bg-lira-surface text-lira-accent border border-lira-rule font-semibold flex items-center gap-1">
                      <span>{SOUND_THEMES[soundTheme === 'auto' ? activeSeasonalTheme : soundTheme].icon}</span>
                      <span>
                        {soundTheme === 'auto'
                          ? `${SOUND_THEMES[activeSeasonalTheme].name} (Automático)`
                          : SOUND_THEMES[soundTheme].name}
                      </span>
                    </span>
                  </div>
                  <p className="text-[11px] text-lira-muted mt-0.5">
                    Alterne entre temas sazonais (Halloween de terror, Natal com sinos) ou selecione detecção automática por data
                  </p>
                </div>
              </div>

              {/* Switch de seleção de sons / temas */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-lira-panel rounded-[8px] border border-lira-quiet">
                {(['auto', 'default', 'halloween', 'christmas'] as SoundTheme[]).map((themeKey) => {
                  const info = SOUND_THEMES[themeKey]
                  const isSelected = soundTheme === themeKey
                  return (
                    <button
                      key={themeKey}
                      type="button"
                      onClick={() => {
                        setSoundTheme(themeKey)
                        playSoundEffect('unmute', true)
                      }}
                      className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-[6px] text-xs font-mono font-bold transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-lira-accent text-lira-ground'
                          : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface'
                      }`}
                      title={info.description}
                    >
                      <span className="text-sm shrink-0">{info.icon}</span>
                      <span className="truncate">{info.name}</span>
                    </button>
                  )
                })}
              </div>

              <div className="text-[10.5px] text-lira-muted bg-lira-panel p-2 rounded-[8px] border border-lira-quiet flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-lira-accent shrink-0" />
                  <span>
                    {soundTheme === 'auto'
                      ? `Calendário detectado: Sons de ${SOUND_THEMES[activeSeasonalTheme].name} (${SOUND_THEMES[activeSeasonalTheme].icon}) ativos automaticamente.`
                      : `Tema manual ativo: ${SOUND_THEMES[soundTheme].name} (${SOUND_THEMES[soundTheme].icon}) · ${SOUND_THEMES[soundTheme].description}`}
                  </span>
                </span>
                {soundTheme !== 'auto' && (
                  <button
                    type="button"
                    onClick={() => setSoundTheme('auto')}
                    className="text-[10px] text-lira-accent hover:text-lira-ink underline font-medium cursor-pointer shrink-0 ml-2"
                  >
                    Usar data automática
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <span className="text-[10.5px] font-semibold text-lira-muted uppercase tracking-wider">
                Testar Sons de Ação
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    'mute',
                    'unmute',
                    'deafen',
                    'undeafen',
                    'user_join',
                    'user_leave',
                    'live_start',
                    'live_stop',
                    'message',
                    'knock',
                    'call',
                  ] as SoundEffectType[]
                ).map((type) => {
                  const meta = SOUND_EFFECT_LABELS[type]
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => playSoundEffect(type, true)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] bg-lira-panel hover:bg-lira-surface border border-lira-quiet hover:border-lira-accent text-lira-ink hover:text-lira-accent transition-colors text-left group cursor-pointer"
                      title={`Ouvir som: ${meta.label}`}
                    >
                      <span className="text-sm shrink-0">
                        {meta.icon}
                      </span>
                      <span className="text-[11px] font-medium truncate">{meta.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
