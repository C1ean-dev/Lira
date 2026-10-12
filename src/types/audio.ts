export interface AudioDeviceInfo {
  deviceId: string
  label: string
  groupId?: string
}

export type SensitivityMode = 'auto' | 'manual'

export type AudioProcessorMode = 'classic' | 'soft' | 'rnnoise'

export type SoundTheme = 'auto' | 'default' | 'halloween' | 'christmas' | 'new_year'

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
