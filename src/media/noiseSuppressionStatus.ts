import { normalizeAudioProcessorMode, type AudioProcessorMode, type NoiseEngineStatus } from '../types/audio'

export function resolveNoiseProcessorPreference(state: {
  audioProcessorMode?: AudioProcessorMode
  hasUserChosenProcessorMode?: boolean
  selectedAudioInput?: string
  micCalibrations?: Record<string, { recommendedMode: AudioProcessorMode }>
}): AudioProcessorMode {
  return state.hasUserChosenProcessorMode ? normalizeAudioProcessorMode(state.audioProcessorMode) : 'rnnoise'
}

export function noiseSuppressionDisplay(
  enabled: boolean, mode: AudioProcessorMode, rnnoiseStatus: NoiseEngineStatus,
  deepFilterStatus: NoiseEngineStatus = 'idle',
) {
  const neural = mode !== 'classic'
  const status = mode === 'deepfilter' ? deepFilterStatus : rnnoiseStatus
  const fallback = enabled && neural && status === 'fallback'
  const canRetry = enabled && neural && (status === 'fallback' || status === 'error')
  let activeMode: AudioProcessorMode | null = enabled ? mode : null
  if (enabled && neural) {
    activeMode = status === 'ready' ? mode : fallback
      ? mode === 'deepfilter' ? rnnoiseStatus === 'ready' ? 'rnnoise' : rnnoiseStatus === 'fallback' ? 'classic' : null : 'classic'
      : null
  }
  const names = { deepfilter: 'DeepFilterNet', rnnoise: 'RNNoise Neural', classic: 'DSP Clássico' }
  const name = mode === 'rnnoise' ? 'RNNoise' : names[mode]
  const notice = !enabled || !neural ? null
    : fallback ? activeMode ? `${names[activeMode]} ativo — fallback do ${name}` : 'Carregando RNNoise — fallback do DeepFilterNet…'
    : status === 'error' ? `Falha no ${name} — tente novamente`
    : status === 'loading' ? `Carregando ${name}…`
    : status === 'idle' ? 'Aguardando microfone…' : null
  return {
    activeMode, fallback, canRetry, notice,
    badge: !enabled ? 'Desligado' : fallback ? 'Fallback' : status === 'error' && neural ? 'Falha'
      : activeMode ? 'Ativo' : status === 'loading' ? 'Carregando' : 'Aguardando',
    title: !enabled ? 'Ativar / Configurar Supressor de Ruído'
      : notice || `Supressor de Ruído Ativo (${names[mode]}) - Clique para alternar motor`,
  }
}
