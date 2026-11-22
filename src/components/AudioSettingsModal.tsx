import React, { useState, useEffect } from 'react'
import { X, Sliders, Mic, Sparkles, Monitor, Bug } from 'lucide-react'
import { useMediaStore } from '../store/useMediaStore'
import { MediaManager } from '../media/MediaManager'
import { ExportLogsButton } from './ExportLogsButton'
import { ReportIssueModal } from './ReportIssueModal'
import { AudioDeviceInfo } from '../types/audio'
import { AudioDevicesTab } from './settings/AudioDevicesTab'
import { AdvancedAudioTab } from './settings/AdvancedAudioTab'
import { SystemSettingsTab } from './settings/SystemSettingsTab'

export const AudioSettingsModal: React.FC = () => {
  const isSettingsModalOpen = useMediaStore((s) => s.isSettingsModalOpen)
  const setSettingsModalOpen = useMediaStore((s) => s.setSettingsModalOpen)
  const isTestingMic = useMediaStore((s) => s.isTestingMic)

  const [inputDevices, setInputDevices] = useState<AudioDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<AudioDeviceInfo[]>([])
  const [videoDevices, setVideoDevices] = useState<AudioDeviceInfo[]>([])
  const [activeTab, setActiveTab] = useState<'devices' | 'advanced' | 'system'>('devices')
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false)
  const [isReportIssueOpen, setIsReportIssueOpen] = useState(false)

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
      const handler = () => refreshDevices()
      window.addEventListener('lira:devices-changed', handler)
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', handler)
      }
      return () => {
        window.removeEventListener('lira:devices-changed', handler)
        if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
          navigator.mediaDevices.removeEventListener('devicechange', handler)
        }
      }
    } else {
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
    MediaManager.getInstance().stopAudioTestBeep()
    setIsPlayingTestSound(false)
    setSettingsModalOpen(false)
  }

  const handlePlayTestSound = async (deviceId?: string) => {
    if (isPlayingTestSound) return
    setIsPlayingTestSound(true)
    try {
      await MediaManager.getInstance().playAudioTestBeep(deviceId)
    } finally {
      setIsPlayingTestSound(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-lira-ground/80 p-4 select-none font-mono">
      <div className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-dashed border-lira-rule/60 bg-lira-surface/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[8px] bg-lira-surface border border-lira-rule flex items-center justify-center text-lira-accent">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-lira-accent">Configurações do Espaço</h2>
              <p className="text-xs font-mono text-lira-muted">
                Dispositivos de Áudio, Câmera, Voz & Sistema
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-[8px] border border-lira-rule bg-lira-surface text-lira-muted hover:text-lira-ink hover:border-lira-accent transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2 px-6 pt-3 border-b border-dashed border-lira-rule/60 bg-lira-panel">
          <button
            onClick={() => setActiveTab('devices')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-mono font-bold border-b-2 transition-colors ${
              activeTab === 'devices'
                ? 'border-lira-accent text-lira-accent'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <Mic className="w-4 h-4" />
            🎙️ Áudio & Câmera
          </button>
          <button
            onClick={() => setActiveTab('advanced')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-mono font-bold border-b-2 transition-colors ${
              activeTab === 'advanced'
                ? 'border-lira-accent text-lira-accent'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            ⚙️ Anti-Eco & DSP
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`flex items-center gap-2 pb-3 px-3 text-xs font-mono font-bold border-b-2 transition-colors ${
              activeTab === 'system'
                ? 'border-lira-accent text-lira-accent'
                : 'border-transparent text-lira-muted hover:text-lira-ink'
            }`}
          >
            <Monitor className="w-4 h-4" />
            🖥️ Sistema & Inicialização
          </button>
        </div>

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

        <div className="p-4 border-t border-dashed border-lira-rule/60 bg-lira-surface/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ExportLogsButton className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-ink hover:text-lira-accent text-[11px] font-mono font-bold transition-colors disabled:opacity-60" />
            <button
              type="button"
              onClick={() => setIsReportIssueOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-lira-error/15 hover:bg-lira-error/25 border border-lira-error/40 text-lira-error text-[11px] font-mono font-bold transition-colors"
              title="Relatar um problema no GitHub com diagnóstico e logs do app"
            >
              <Bug className="w-3.5 h-3.5" />
              <span>Reportar problema</span>
            </button>
          </div>

          <button
            onClick={handleClose}
            className="px-6 py-2 rounded-[8px] text-xs font-mono font-bold bg-lira-accent hover:bg-lira-ink border border-lira-accent hover:border-lira-ink text-lira-ground transition-colors"
          >
            Concluir
          </button>
        </div>
      </div>
      <ReportIssueModal isOpen={isReportIssueOpen} onClose={() => setIsReportIssueOpen(false)} />
    </div>
  )
}
