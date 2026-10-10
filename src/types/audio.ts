export interface AudioDeviceInfo {
  deviceId: string
  label: string
  groupId?: string
}

export type SensitivityMode = 'auto' | 'manual'

/**
 * Which mic cleanup engine the user wants.
 *
 * - 'classic' : original hard-gate DSP (rms gate, fast attack, 150ms release).
 *               Lowest CPU; aggressive on breath/consonants.
 * - 'soft'    : soft downward expander (no hard cuts, hysteresis, 250ms
 *               release, conservative auto-floor). Same audio engine family
 *               as classic but tuned to preserve speech tails.
 * - 'rnnoise' : Mozilla/Xiph RNNoise neural denoiser running as a
 *               AudioWorklet + WASM module. Highest quality; needs the
 *               @jitsi/rnnoise-wasm binary to be present (else the app
 *               transparently falls back to 'soft').
 */
export type AudioProcessorMode = 'classic' | 'soft' | 'rnnoise'

export interface AudioSettings {
  selectedAudioInput: string
  selectedAudioOutput: string
  selectedVideoInput?: string
  inputVolume: number // 0 to 200 (percentage, 100 is unity gain)
  outputVolume: number // 0 to 100 (percentage)
  sensitivityMode: SensitivityMode
  manualSensitivityThreshold: number // 0 to 100
  echoCancellation: boolean
  autoGainControl: boolean
  audioProcessorMode: AudioProcessorMode // Default 'rnnoise'
  screenShareAudioVolume: number // 0 to 200 (percentage, default 100)
  duckingEnabled: boolean // Auto-reduce screen audio when speaking
}
