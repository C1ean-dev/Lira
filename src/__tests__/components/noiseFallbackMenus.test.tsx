import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CallControlsBar } from '../../components/grid/CallControlsBar'
import { MiniCallOverlay } from '../../components/MiniCallOverlay'
import { useMediaStore } from '../../store/useMediaStore'
import { useGameStore } from '../../store/useGameStore'

const ui = vi.hoisted(() => ({ hook: 0, reprocess: vi.fn(async () => {}) }))
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  const useState = (initial: unknown) => actual.useState(ui.hook++ === 2 ? true : initial)
  return { ...actual, default: { ...actual.default, useState }, useState }
})
vi.mock('../../data/nativeAssets.json', () => ({ default: { assets: [], categories: [] } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({}) } }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: { getInstance: () => ({ reprocessStream: ui.reprocess }) } }))
vi.mock('../../components/ScreenShareModal', () => ({ ScreenShareModal: () => null }))
vi.mock('../../components/common/PlayerAvatar', () => ({ PlayerAvatar: () => null }))
vi.mock('../../hooks/usePlayerDetails', () => ({
  useLocalPlayerDetails: () => useGameStore.getState().localPlayer,
  useZonePeerDetails: () => [],
}))
vi.mock('../../store/useMediaStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useMediaStore')>('../../store/useMediaStore')
  return { ...actual, useMediaStore: Object.assign((select: any) => select(actual.useMediaStore.getState()), actual.useMediaStore) }
})
vi.mock('../../store/useGameStore', async () => {
  const actual = await vi.importActual<typeof import('../../store/useGameStore')>('../../store/useGameStore')
  return { ...actual, useGameStore: Object.assign((select: any) => select(actual.useGameStore.getState()), actual.useGameStore) }
})
const originalMedia = useMediaStore.getState()
const originalGame = useGameStore.getState()
beforeEach(() => {
  vi.clearAllMocks(); ui.hook = 0
  useGameStore.setState({ localPlayer: { ...originalGame.localPlayer, currentZoneId: 'room' }, remotePlayers: {} })
  useMediaStore.setState({ ...originalMedia, isNoiseSuppressionEnabled: true, audioProcessorMode: 'rnnoise', hasUserChosenProcessorMode: true, rnnoiseStatus: 'fallback', rnnoiseError: 'worklet failed' })
})
afterEach(() => { useMediaStore.setState(originalMedia); useGameStore.setState(originalGame) })
const bars = [
  ['expanded call', () => <CallControlsBar onLeaveCall={() => {}} onToggleScreenShare={() => {}} />],
  ['mini display', () => <MiniCallOverlay />],
] as const
const row = (html: string, text: string) => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes(`>${text}</span>`)) || ''

describe.each(bars)('noise suppression feedback in %s', (_, render) => {
  it('orders engines by quality while describing their speed and fallback', () => {
    useMediaStore.setState({ rnnoiseStatus: 'ready' })
    const html = renderToStaticMarkup(render())
    const deepfilter = row(html, 'DeepFilterNet')
    const rnnoise = row(html, 'RNNoise Neural')
    const classic = row(html, 'DSP Clássico')
    expect(deepfilter).toContain('O melhor, porém mais lento, com fallback para RNNoise')
    expect(rnnoise).toContain('Rápido e eficiente')
    expect(classic).toContain('Corte agressivo, menor uso de CPU')
    expect(html.indexOf(deepfilter)).toBeLessThan(html.indexOf(rnnoise))
    expect(html.indexOf(rnnoise)).toBeLessThan(html.indexOf(classic))
    expect(rnnoise).toContain('aria-pressed="true"')
  })
  it('offers DeepFilterNet, RNNoise and classic DSP with no Soft DSP', () => {
    const html = renderToStaticMarkup(render())
    expect(row(html, 'DeepFilterNet')).not.toBe('')
    expect(row(html, 'RNNoise Neural')).not.toBe('')
    expect(row(html, 'DSP Clássico')).not.toBe('')
    expect(html).not.toContain('DSP Suave')
  })
  it('marks RNNoise active during DeepFilterNet fallback while preserving the preference', () => {
    useMediaStore.setState({ audioProcessorMode: 'deepfilter', deepFilterStatus: 'fallback', rnnoiseStatus: 'ready' })
    const html = renderToStaticMarkup(render())
    expect(html).toContain('RNNoise Neural ativo — fallback do DeepFilterNet')
    expect(row(html, 'RNNoise Neural')).toContain('aria-pressed="true"')
    expect(row(html, 'DeepFilterNet')).toContain('aria-pressed="false"')
    expect(useMediaStore.getState().audioProcessorMode).toBe('deepfilter')
  })
  it('announces RNNoise fallback and marks Soft DSP as active instead of RNNoise', () => {
    const html = renderToStaticMarkup(render())
    expect(html).toContain('DSP Clássico ativo — fallback do RNNoise')
    expect(row(html, 'DSP Clássico')).toContain('aria-pressed="true"')
    expect(row(html, 'RNNoise Neural')).toContain('aria-pressed="false"')
    expect(html).not.toContain('Supressor de Ruído Ativo (RNNoise Neural)')
    expect(useMediaStore.getState().audioProcessorMode).toBe('rnnoise')
  })
  it('removes the fallback notice after the neural processor recovers', () => {
    useMediaStore.setState({ rnnoiseStatus: 'ready', rnnoiseError: null })
    const html = renderToStaticMarkup(render())
    expect(html).not.toContain('fallback do RNNoise')
    expect(row(html, 'RNNoise Neural')).toContain('aria-pressed="true"')
  })
  it('also reports fallback when the calibration chose RNNoise automatically', () => {
    useMediaStore.setState({ audioProcessorMode: 'classic', hasUserChosenProcessorMode: false,
      selectedAudioInput: 'auto-mic', micCalibrations: { 'auto-mic': { noiseFloorDb: -60, peakRmsDb: -10, snrDb: 50, recommendedMode: 'rnnoise', recommendedSensitivity: 20, calibratedAt: 1 } } })
    const html = renderToStaticMarkup(render())
    expect(html).toContain('DSP Clássico ativo — fallback do RNNoise')
    expect(row(html, 'DSP Clássico')).toContain('aria-pressed="true"')
  })
  it('does not advertise fallback or an active processor when suppression is disabled', () => {
    useMediaStore.setState({ isNoiseSuppressionEnabled: false })
    const html = renderToStaticMarkup(render())
    expect(html).not.toContain('fallback do RNNoise')
    expect(row(html, 'DSP Clássico')).not.toContain('aria-pressed="true"')
    expect(html).toContain('Desligado')
  })
  it.each(['loading', 'idle', 'error'] as const)('does not mark the neural processor active while its status is %s', status => {
    useMediaStore.setState({ rnnoiseStatus: status })
    const html = renderToStaticMarkup(render())
    expect(row(html, 'RNNoise Neural')).toContain('aria-pressed="false"')
    expect(row(html, 'DSP Clássico')).toContain('aria-pressed="false"')
    expect(html).not.toContain('DSP Clássico ativo — fallback do RNNoise')
    expect(html).not.toContain('Supressor de Ruído Ativo (RNNoise Neural)')
  })
})

it.each(['fallback', 'error'] as const)('can retry the preferred RNNoise processor after %s without switching preference to Soft DSP', async status => {
  useMediaStore.setState({ rnnoiseStatus: status })
  let tree: React.ReactNode
  function Probe() { tree = CallControlsBar({ onLeaveCall() {}, onToggleScreenShare() {} }); return null }
  renderToStaticMarkup(<Probe />)
  let retry: React.ReactElement<any> | undefined
  function visit(node: React.ReactNode) {
    React.Children.forEach(node, child => {
      if (!React.isValidElement(child)) return
      const props = child.props as any
      if (child.type === 'button' && props.title === 'Tentar RNNoise novamente') retry = child
      visit(props.children)
    })
  }
  visit(tree!)
  expect(retry).toBeDefined()
  await retry!.props.onClick()
  expect(ui.reprocess).toHaveBeenCalledOnce()
  expect(useMediaStore.getState().audioProcessorMode).toBe('rnnoise')
})

