import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdvancedAudioTab } from '../../components/settings/AdvancedAudioTab'
import { MultiEngineAudioPlayer } from '../../components/settings/MultiEngineAudioPlayer'

const state = vi.hoisted(() => ({
  audioProcessorMode: 'rnnoise',
  hasUserChosenProcessorMode: true,
  selectedAudioInput: 'default',
  micCalibrations: {},
  isNoiseSuppressionEnabled: true,
  rnnoiseStatus: 'ready',
  rnnoiseError: null as string | null,
  rnnoiseStage: '',
  deepFilterStatus: 'ready',
  deepFilterError: null as string | null,
  deepFilterStage: '',
}))
vi.mock('../../store/useMediaStore', () => ({
  useMediaStore: (selector: (value: typeof state) => unknown) => selector(state),
}))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: vi.fn() } }))

describe('RNNoise status in audio settings', () => {
  beforeEach(() => {
    state.audioProcessorMode = 'rnnoise'
    state.isNoiseSuppressionEnabled = true
    state.rnnoiseStatus = 'ready'
    state.rnnoiseError = null
  })

  it.each([
    ['ready', 'ready', 'Rede neural ativa'],
    ['loading', 'idle', 'Carregando DeepFilterNet…'],
    ['fallback', 'ready', 'RNNoise Neural ativo — fallback do DeepFilterNet'],
    ['fallback', 'fallback', 'DSP Clássico ativo — fallback do DeepFilterNet'],
    ['error', 'idle', 'Falha no DeepFilterNet — tente novamente'],
  ])('describes DeepFilterNet %s with RNNoise %s', (status, fallbackStatus, text) => {
    state.audioProcessorMode = 'deepfilter'
    state.deepFilterStatus = status
    state.rnnoiseStatus = fallbackStatus
    const html = renderToStaticMarkup(<AdvancedAudioTab />)
    expect(html).toContain(text)
    expect(html).not.toContain('DSP Suave')
  })

  it('compares DeepFilterNet, RNNoise and classic DSP calibration samples', () => {
    const html = renderToStaticMarkup(<MultiEngineAudioPlayer recommendedMode="deepfilter" activeMode="deepfilter"
      recommendedSensitivity={20} onApplyEngine={() => {}} samples={{
        deepfilter: { audioUrl: 'blob:deepfilter' }, rnnoise: { audioUrl: 'blob:rnnoise' }, classic: { audioUrl: 'blob:classic' },
      }} />)
    expect(html).toContain('DeepFilterNet')
    expect(html).toContain('RNNoise Neural')
    expect(html).toContain('DSP Clássico')
    expect(html).not.toContain('DSP Suave')
    expect(html).toContain('blob:deepfilter')
    expect(html.indexOf('DeepFilterNet')).toBeLessThan(html.indexOf('RNNoise Neural'))
    expect(html.indexOf('RNNoise Neural')).toBeLessThan(html.indexOf('DSP Clássico'))
    expect(html).toContain('O melhor, porém mais lento, com fallback para RNNoise')
    expect(html).toContain('Rápido e eficiente')
  })
  it('shows the same order and descriptions in advanced audio settings', () => {
    const html = renderToStaticMarkup(<AdvancedAudioTab />)
    const controls = html.slice(html.indexOf('Motor de Supressão de Ruído'))
    expect(controls.indexOf('>DeepFilterNet')).toBeLessThan(controls.indexOf('>RNNoise Neural'))
    expect(controls.indexOf('>RNNoise Neural')).toBeLessThan(controls.indexOf('>DSP Clássico'))
    expect(controls).toContain('O melhor, porém mais lento, com fallback para RNNoise')
    expect(controls).toContain('Rápido e eficiente')
    expect(controls).toContain('Corte agressivo. Baixo CPU.')
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
    ['loading', 'Carregando RNNoise…'],
    ['error', 'Falha no RNNoise — tente novamente'],
    ['fallback', 'DSP Clássico ativo — fallback do RNNoise'],
  ])('describes %s accurately', (status, text) => {
    state.rnnoiseStatus = status
    const html = renderToStaticMarkup(<AdvancedAudioTab />)

    expect(html).toContain(text)
    if (status !== 'fallback') expect(html).not.toContain('usando DSP Suave')
  })
})

