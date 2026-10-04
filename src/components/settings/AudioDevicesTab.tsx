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
} from 'lucide-react'
import { useMediaStore } from '../../store/useMediaStore'
import { MediaManager } from '../../media/MediaManager'
import { attachStreamToVideo } from '../../media/attachVideoElement'
import { AudioDeviceInfo, SensitivityMode } from '../../types/audio'
import { CustomDropdown } from '../common/CustomDropdown'
import { toDeviceOptions } from './deviceOptions'

interface Props {
  inputDevices: AudioDeviceInfo[]
  outputDevices: AudioDeviceInfo[]
  videoDevices: AudioDeviceInfo[]
  isPlayingTestSound: boolean
  onPlayTestSound: () => void
}

export const AudioDevicesTab: React.FC<Props> = ({
  inputDevices,
  outputDevices,
  videoDevices,
  isPlayingTestSound,
  onPlayTestSound,
}) => {
  // Granular selectors — localAudioLevel ticks at ~10Hz; whole-store here
  // would re-render the entire settings tab on every tick.
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
  const micCalibrations = useMediaStore((s) => s.micCalibrations)
  const currentCalibration = micCalibrations[selectedAudioInput]

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

      // Se a câmera já estiver ligada na chamada, reusamos o track ativo para evitar
      // conflito de exclusividade do hardware no Windows (DirectShow/MediaFoundation)
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
                ? { deviceId: { ideal: targetId }, width: { ideal: 640 }, height: { ideal: 480 } }
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

  // Acopla o stream de teste ao elemento de vídeo de forma reativa e segura
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
    MediaManager.getInstance().updateSensitivity(sensitivityMode, val)
  }

  const handleTestMicToggle = () => {
    const nextTesting = !isTestingMic
    MediaManager.getInstance().setTestMic(nextTesting)
  }

  return (
    <div className="space-y-6">
      {/* 0. Câmera & Webcam Selector */}
      <div className="bg-[#12151d]/70 rounded-2xl p-4 border border-[#2a3142] space-y-3.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <Video className="w-4 h-4 text-indigo-400" />
            <span>Dispositivo de Vídeo (Câmera / Webcam)</span>
          </label>
          <button
            type="button"
            onClick={() => (isTestingCamera ? stopCameraTest() : startCameraTest())}
            className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-md ${
              isTestingCamera
                ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
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
          buttonClassName="bg-[#12151d] hover:bg-[#181d2a] border-[#2a3142]"
        />

        {isObsVirtualCamera && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2.5 text-xs text-amber-300">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">OBS Virtual Camera detectada</span>
              <p className="text-[11px] text-amber-200/80 mt-0.5">
                Se a imagem estiver preta, abra o OBS Studio e clique em <b>"Iniciar Câmera Virtual"</b>, ou selecione sua webcam física na lista acima.
              </p>
            </div>
          </div>
        )}

        {cameraError && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{cameraError}</span>
          </div>
        )}

        {/* Live Camera Preview Box */}
        {isTestingCamera && (
          <div className="relative w-full aspect-video max-h-56 bg-black rounded-xl overflow-hidden border border-[#2a3142] shadow-inner flex items-center justify-center">
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
            <div className="absolute top-2 left-2 px-2 py-0.5 bg-emerald-500/90 text-white text-[10px] font-bold rounded-md flex items-center gap-1 shadow">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span>PRÉVIA EM TEMPO REAL</span>
            </div>
          </div>
        )}
      </div>

      {/* 1. Microfone & Alto-falantes Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Microfone */}
        <div className="space-y-2">
          {/* Cabeçalhos de entrada e saída com a mesma altura: o da saída tem o botão "Testar Som",
              mais alto que o título, e sem isso a coluna da saída ficaria mais baixa. */}
          <div className="flex items-center justify-between h-7">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Mic className="w-4 h-4 text-indigo-400" />
              <span>Dispositivo de Entrada (Microfone)</span>
            </label>
          </div>
          <CustomDropdown
            value={selectedAudioInput}
            options={toDeviceOptions(inputDevices, 'Microfone', (cls) => <Mic className={cls} />)}
            onChange={handleInputChange}
            fullWidth
            size="md"
            buttonClassName="bg-[#12151d] hover:bg-[#181d2a] border-[#2a3142]"
          />

          {/* Volume de Entrada */}
          <div className="pt-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
              <span>Volume de Entrada (Ganho)</span>
              <span className="font-bold text-indigo-400">{inputVolume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={inputVolume}
              onChange={(e) => handleInputVolumeChange(Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>
        </div>

        {/* Saída de Som */}
        <div className="space-y-2">
          <div className="flex items-center justify-between h-7">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Headphones className="w-4 h-4 text-indigo-400" />
              <span>Dispositivo de Saída</span>
            </label>
            <button
              type="button"
              onClick={onPlayTestSound}
              className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all flex items-center gap-1 ${
                isPlayingTestSound
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400 animate-pulse'
                  : 'bg-[#12151d] border-[#2a3142] text-slate-300 hover:text-white hover:bg-slate-800'
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
            buttonClassName="bg-[#12151d] hover:bg-[#181d2a] border-[#2a3142]"
          />

          {/* Volume de Saída */}
          <div className="pt-2">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
              <span>Volume de Saída dos Participantes</span>
              <span className="font-bold text-indigo-400">{outputVolume}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={outputVolume}
              onChange={(e) => handleOutputVolumeChange(Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* 2. Seção de Teste de Microfone & VU Meter */}
      <div className="bg-[#12151d]/70 rounded-2xl p-4 border border-[#2a3142] space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-bold text-slate-200">Teste do Microfone</span>
          </div>
          <button
            type="button"
            onClick={handleTestMicToggle}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md ${
              isTestingMic
                ? 'bg-rose-600 text-white animate-pulse'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>{isTestingMic ? 'Parar Teste' : 'Testar Microfone'}</span>
          </button>
        </div>

        {isTestingMic && (
          <div className="text-[11px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 p-2.5 rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>Fale no microfone para ouvir o retorno em tempo real nos seus fones de ouvido!</span>
          </div>
        )}

        {/* Real-time Dynamic VU Meter Bar with Sensitivity Cutoff Marker */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-slate-400">
            <span>Nível de Entrada Sonoro</span>
            <span className={isGateOpen ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
              {isGateOpen ? '● Microfone Aberto (Voz Detectada)' : '○ Filtrando Ruído'}
            </span>
          </div>

          <div className="relative w-full h-4 bg-slate-950 rounded-full overflow-hidden border border-[#2a3142] p-0.5">
            {/* Live volume level fill */}
            <div
              className={`h-full rounded-full transition-all duration-75 ${
                isGateOpen
                  ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-400 shadow-lg shadow-emerald-500/30'
                  : 'bg-slate-600/40'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, localAudioLevel * 100))}%` }}
            />

            {/* Manual Sensitivity Marker Overlay (Discord style) */}
            {sensitivityMode === 'manual' && (
              <div
                className="absolute top-0 bottom-0 w-1 bg-amber-400 z-10 shadow-md pointer-events-none"
                style={{ left: `${manualSensitivityThreshold}%` }}
                title={`Limiar de Sensibilidade Manual: ${manualSensitivityThreshold}%`}
              >
                <div className="w-2.5 h-2.5 bg-amber-400 rotate-45 -translate-x-1/3 -translate-y-1/3 rounded-xs" />
              </div>
            )}

            {/* Dynamic Adaptive Sensitivity Marker Overlay (Auto mode - Discord style) */}
            {sensitivityMode === 'auto' && autoThresholdPercent > 0 && (
              <div
                className="absolute top-0 bottom-0 w-1 bg-emerald-400/90 z-10 shadow-md transition-all duration-150 pointer-events-none"
                style={{ left: `${autoThresholdPercent}%` }}
                title={`Limiar Adaptativo Atual: ${autoThresholdPercent}%`}
              >
                <div className="w-2.5 h-2.5 bg-emerald-400 rotate-45 -translate-x-1/3 -translate-y-1/3 rounded-xs opacity-90 shadow-sm" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Seção de Ajuste de Sensibilidade (Noise Gate) */}
      <div className="bg-[#12151d]/70 rounded-2xl p-4 border border-[#2a3142] space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-bold text-slate-200">Sensibilidade de Entrada (Noise Gate)</span>
            <p className="text-[11px] text-slate-400">
              Determina o volume mínimo para o microfone abrir e transmitir sua voz
            </p>
          </div>

          {/* Mode Switcher: Auto vs Manual */}
          <div className="flex bg-[#1b202c] p-1 rounded-xl border border-[#2a3142]">
            <button
              type="button"
              onClick={() => handleSensitivityModeToggle('auto')}
              className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
                sensitivityMode === 'auto'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Automático
            </button>
            <button
              type="button"
              onClick={() => handleSensitivityModeToggle('manual')}
              className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all ${
                sensitivityMode === 'manual'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Manual
            </button>
          </div>
        </div>

        {sensitivityMode === 'manual' ? (
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-[11px] text-slate-300">
              <div className="flex items-center gap-2">
                <span>Limiar de Ativação Manual</span>
                {currentCalibration && currentCalibration.recommendedSensitivity !== manualSensitivityThreshold && (
                  <button
                    type="button"
                    onClick={() => handleThresholdChange(currentCalibration.recommendedSensitivity)}
                    className="text-[9.5px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors cursor-pointer"
                    title="Usar limiar recomendado na calibração do microfone"
                  >
                    Usar calibrado ({currentCalibration.recommendedSensitivity}%)
                  </button>
                )}
              </div>
              <span className="font-bold text-amber-400">{manualSensitivityThreshold}%</span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              value={manualSensitivityThreshold}
              onChange={(e) => handleThresholdChange(Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
            />
            <p className="text-[10px] text-slate-500">
              Ajuste a barra para que o ruído de fundo fique à esquerda do marcador amarelo e sua voz normal fique à direita.
            </p>
          </div>
        ) : (
          <div className="text-[11px] text-emerald-300/90 bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span>
                O sistema detecta dinamicamente os barulhos da sua sala e calibra o corte automaticamente.
              </span>
              {autoThresholdPercent > 0 && (
                <span
                  className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-mono font-bold border border-emerald-500/30 shrink-0"
                  title="Limiar adaptativo calculado em tempo real para o ruído da sala"
                >
                  Corte atual: ~{autoThresholdPercent}%
                </span>
              )}
            </div>
            {currentCalibration && (
              <div className="text-[10px] text-slate-400 pl-6 flex items-center gap-1.5">
                <span>Calibração recomendou {currentCalibration.recommendedSensitivity}%.</span>
                <button
                  type="button"
                  onClick={() => {
                    handleSensitivityModeToggle('manual')
                    handleThresholdChange(currentCalibration.recommendedSensitivity)
                  }}
                  className="text-emerald-400 underline hover:text-emerald-300 font-medium cursor-pointer"
                >
                  Mudar para Manual ({currentCalibration.recommendedSensitivity}%)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
