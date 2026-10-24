import type { AudioProcessorMode } from '../types/audio'

export function resolveNoiseProcessorPreference(state: {
  audioProcessorMode?: AudioProcessorMode
  hasUserChosenProcessorMode?: boolean
  selectedAudioInput?: string
  micCalibrations?: Record<string, { recommendedMode: AudioProcessorMode }>
}): AudioProcessorMode {
  const calibrated = state.micCalibrations?.[state.selectedAudioInput ?? '']?.recommendedMode
  return (state.hasUserChosenProcessorMode ? state.audioProcessorMode : calibrated ?? state.audioProcessorMode) ?? 'rnnoise'
}

export function noiseSuppressionDisplay(
  enabled: boolean, mode: AudioProcessorMode,
  status: 'idle' | 'loading' | 'ready' | 'fallback' | 'error',
) {
  const fallback = enabled && mode === 'rnnoise' && status === 'fallback'
  const canRetry = enabled && mode === 'rnnoise' && (status === 'fallback' || status === 'error')
  const pending = mode === 'rnnoise' && (status === 'idle' || status === 'loading' || status === 'error')
  const activeMode = !enabled || pending ? null : fallback ? 'soft' : mode
  const names = { rnnoise: 'RNNoise Neural', soft: 'DSP Suave', classic: 'DSP Clássico' }
  const notice = !enabled || mode !== 'rnnoise' ? null
    : fallback ? 'DSP Suave ativo — fallback do RNNoise'
    : status === 'error' ? 'Falha no RNNoise — tente novamente'
    : status === 'loading' ? 'Carregando RNNoise…'
    : status === 'idle' ? 'Aguardando microfone…' : null
  return {
    activeMode, fallback, canRetry, notice,
    badge: !enabled ? 'Desligado' : fallback ? 'Fallback' : status === 'error' && mode === 'rnnoise' ? 'Falha'
      : activeMode ? 'Ativo' : status === 'loading' ? 'Carregando' : 'Aguardando',
    title: !enabled ? 'Ativar / Configurar Supressor de Ruído'
      : notice || `Supressor de Ruído Ativo (${names[mode]}) - Clique para alternar motor`,
  }
}
