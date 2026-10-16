import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdvancedAudioTab } from '../../components/settings/AdvancedAudioTab'

const state = vi.hoisted(() => ({
  audioProcessorMode: 'rnnoise',
  selectedAudioInput: 'default',
  micCalibrations: {},
  isNoiseSuppressionEnabled: true,
  rnnoiseStatus: 'ready',
  rnnoiseError: null as string | null,
  rnnoiseStage: '',
}))
vi.mock('../../store/useMediaStore', () => ({
  useMediaStore: (selector: (value: typeof state) => unknown) => selector(state),
}))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: vi.fn() } }))

describe('RNNoise status in audio settings', () => {
  beforeEach(() => {
    state.isNoiseSuppressionEnabled = true
    state.rnnoiseStatus = 'ready'
    state.rnnoiseError = null
  })

  it.each(['ready', 'loading', 'fallback', 'error', 'idle'])('shows suppression disabled when bypassed (engine=%s)', (status) => {
    state.rnnoiseStatus = status
    state.isNoiseSuppressionEnabled = false
    const html = renderToStaticMarkup(<AdvancedAudioTab />)

    expect(html).toContain('Supressão desativada')
    expect(html).not.toContain('Rede neural ativa')
    expect(html).not.toContain('usando DSP Suave')
    expect(html).not.toContain('bg-emerald-400')
  })

  it.each([
    ['ready', 'Rede neural ativa'],
    ['idle', 'Aguardando microfone…'],
    ['loading', 'Carregando rede neural…'],
    ['error', 'Falha no RNNoise'],
    ['fallback', 'RNNoise indisponível — usando DSP Suave'],
  ])('describes %s accurately', (status, text) => {
    state.rnnoiseStatus = status
    const html = renderToStaticMarkup(<AdvancedAudioTab />)

    expect(html).toContain(text)
    if (status !== 'fallback') expect(html).not.toContain('usando DSP Suave')
  })
})
