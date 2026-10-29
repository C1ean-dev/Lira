export interface AudioDeviceInfo {
  deviceId: string
  label: string
  groupId?: string
}

export type SensitivityMode = 'auto' | 'manual'

export type AudioProcessorMode = 'classic' | 'deepfilter' | 'rnnoise'

export type NoiseEngineStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

export function normalizeAudioProcessorMode(mode: unknown): AudioProcessorMode {
  if (mode === 'classic' || mode === 'deepfilter' || mode === 'rnnoise') return mode
  return mode === 'soft' ? 'deepfilter' : 'rnnoise'
}

export type SoundTheme = 'auto' | 'default' | 'halloween' | 'christmas'

export interface AudioSettings {
  selectedAudioInput: string
  selectedAudioOutput: string
  selectedVideoInput?: string
  inputVolume: number
  outputVolume: number
  sensitivityMode: SensitivityMode
  manualSensitivityThreshold: number
  echoCancellation: boolean
  autoGainControl: boolean
  audioProcessorMode: AudioProcessorMode
  screenShareAudioVolume: number
  duckingEnabled: boolean
  soundEffectsEnabled?: boolean
  soundEffectsVolume?: number
  soundTheme?: SoundTheme
}
