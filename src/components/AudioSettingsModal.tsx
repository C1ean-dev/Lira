import React, { useState, useEffect } from 'react'
import { X, Sliders, Mic, Sparkles, CheckCircle2, Download, Monitor } from 'lucide-react'
import { useMediaStore } from '../store/useMediaStore'
import { MediaManager } from '../media/MediaManager'
import { exportDiagLogs } from '../utils/diagnosticLogger'
import { AudioDeviceInfo } from '../types/audio'
import { AudioDevicesTab } from './settings/AudioDevicesTab'
import { AdvancedAudioTab } from './settings/AdvancedAudioTab'
import { SystemSettingsTab } from './settings/SystemSettingsTab'

export const AudioSettingsModal: React.FC = () => {
  // Selectors only — whole-store would re-render this modal (and enumerate
  // effects) on every VU-meter tick while the mic is live.
  const isSettingsModalOpen = useMediaStore((s) => s.isSettingsModalOpen)
  const setSettingsModalOpen = useMediaStore((s) => s.setSettingsModalOpen)
  const isTestingMic = useMediaStore((s) => s.isTestingMic)

  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([])
  const [videoDevices, setVideoDevices] = useState<AudioDeviceInfo[]>([])
  const [activeTab, setActiveTab] = useState<'devices' | 'advanced' | 'system'>('devices')
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false)
  const [logsExported, setLogsExported] = useState(false)

  // Enumerate all media devices
  const refreshDevices = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return

      const devices = await navigator.mediaDevices.enumerateDevices()

      const inputs: AudioDeviceInfo[] = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Microfone ${idx + 1}`,
          groupId: d.groupId,
        }))

      const outputs: AudioDeviceInfo[] = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Alto-Falante/Fone ${idx + 1}`,
          groupId: d.groupId,
        }))

      const videos: AudioDeviceInfo[] = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Câmera ${idx + 1}`,
          groupId: d.groupId,
        }))

      setInputDevices(inputs)
      setOutputDevices(outputs)
      setVideoDevices(videos)
    } catch (err) {
      console.warn('Could not enumerate audio/video devices:', err)
    }
  }

  useEffect(() => {
    if (isSettingsModalOpen) {
      refreshDevices()
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
        return () => {
          navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
        }
      }
    } else {
      // Auto-stop mic test if modal is closed
      if (isTestingMic) {
        MediaManager.getInstance().setTestMic(false)
      }
    }
  }, [isSettingsModalOpen, isTestingMic])

  if (!isSettingsModalOpen) return null

  const handleClose = () => {
    if (isTestingMic) {
      MediaManager.getInstance().setTestMic(false)
    }
    setSettingsModalOpen(false)
  }

  const handlePlayTestSound = () => {
    setIsPlayingTestSound(true)
    MediaManager.getInstance().playAudioTestBeep()
    setTimeout(() => setIsPlayingTestSound(false), 800)
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none">
      <div className="bg-[#1b202c] border border-[#2a3142] rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a3142] bg-[#12151d]/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">Configurações do Espaço</h2>
              <p className="text-xs text-slate-400">
                Dispositivos de Áudio, Câmera, Voz & Sistema
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex gap-2 px-6 pt-3 border-b border-[#2a3142] bg-[#12151d]/40">
          <button
            onClick={() => setActiveTab('devices')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'devices'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Mic className="w-4 h-4" />
            🎙️ Áudio & Câmera
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'advanced'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            ⚙️ Anti-Eco & DSP
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold border-b-2 transition-all ${
              activeTab === 'system'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Monitor className="w-4 h-4" />
            🖥️ Sistema & Inicialização
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {activeTab === 'devices' && (
            <AudioDevicesTab
              inputDevices={inputDevices}
              outputDevices={outputDevices}
              videoDevices={videoDevices}
              isPlayingTestSound={isPlayingTestSound}
              onPlayTestSound={handlePlayTestSound}
            />
          )}
          {activeTab === 'advanced' && <AdvancedAudioTab />}
          {activeTab === 'system' && <SystemSettingsTab />}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-[#2a3142] bg-[#12151d]/90 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Configurações salvas automaticamente no seu dispositivo</span>
            </div>
            <button
              onClick={async () => {
                await exportDiagLogs()
                setLogsExported(true)
                setTimeout(() => setLogsExported(false), 3000)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-bold transition-all"
              title="Gera o arquivo de diagnóstico da chamada (pasta logs) para enviar ao suporte"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{logsExported ? 'Pasta de logs aberta!' : 'Exportar logs da chamada'}</span>
            </button>
          </div>

          <button
            onClick={handleClose}
            className="px-6 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all active:scale-98"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  )
}
