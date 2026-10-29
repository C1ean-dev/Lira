import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaManager } from '../../media/MediaManager'
import { useMediaStore } from '../../store/useMediaStore'
import { noiseSuppressionDisplay, resolveNoiseProcessorPreference } from '../../media/noiseSuppressionStatus'

describe('DeepFilterNet selection and fallback', () => {
  let manager: any
  const raw = { getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream
  const filtered = { getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream
  beforeEach(() => {
    manager = MediaManager.getInstance()
    manager.activeEngine = null
    manager.rawUserStream = null
    useMediaStore.setState({ audioProcessorMode: 'deepfilter', hasUserChosenProcessorMode: true,
      isNoiseSuppressionEnabled: true, isTestingMic: false, rnnoiseStatus: 'idle', deepFilterStatus: 'idle' } as any)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('defaults to RNNoise and preserves an explicit legacy Soft DSP choice', () => {
    expect(resolveNoiseProcessorPreference({})).toBe('rnnoise')
    expect(resolveNoiseProcessorPreference({ audioProcessorMode: 'soft', hasUserChosenProcessorMode: true } as any)).toBe('deepfilter')
    expect(resolveNoiseProcessorPreference({ micCalibrations: { default: { recommendedMode: 'soft' } } } as any)).toBe('rnnoise')
  })
  it.each(['deepfilter', 'classic'])('does not replace RNNoise by an automatic %s recommendation before an explicit choice', mode => {
    expect(resolveNoiseProcessorPreference({ audioProcessorMode: mode, hasUserChosenProcessorMode: false,
      micCalibrations: { default: { recommendedMode: mode } } } as any)).toBe('rnnoise')
  })
  it.each(['deepfilter', 'rnnoise', 'classic'])('preserves an explicit %s preference', mode => {
    expect(resolveNoiseProcessorPreference({ audioProcessorMode: mode, hasUserChosenProcessorMode: true } as any)).toBe(mode)
  })
  it('runs DeepFilterNet when selected', async () => {
    expect(manager.deepFilterEngine).toBeDefined()
    const process = vi.spyOn(manager.deepFilterEngine, 'processStream').mockResolvedValue(filtered)
    expect(await manager.runEngine(raw, () => {})).toBe(filtered)
    expect(process).toHaveBeenCalledWith(raw, true, 100, 'auto', 20, expect.any(Function))
    expect(manager.activeEngine).toBe(manager.deepFilterEngine)
  })
  it('runs RNNoise by default without loading DeepFilterNet before a user choice', async () => {
    useMediaStore.setState({ hasUserChosenProcessorMode: false })
    const deepfilter = vi.spyOn(manager.deepFilterEngine, 'processStream')
    const rnnoise = vi.spyOn(manager.rnnoiseEngine, 'processStream').mockResolvedValue(filtered)
    expect(await manager.runEngine(raw, () => {})).toBe(filtered)
    expect(rnnoise).toHaveBeenCalledOnce()
    expect(deepfilter).not.toHaveBeenCalled()
    expect(manager.activeEngine).toBe(manager.rnnoiseEngine)
  })
  it.each(['return', 'throw'])('falls back to RNNoise on DeepFilterNet startup failure (%s)', async failure => {
    expect(manager.deepFilterEngine).toBeDefined()
    vi.spyOn(manager.deepFilterEngine, 'processStream').mockImplementation(async () => {
      useMediaStore.getState().setDeepFilterStatus('error', 'SIMD unavailable')
      if (failure === 'throw') throw new Error('SIMD unavailable')
      return raw
    })
    const dispose = vi.spyOn(manager.deepFilterEngine, 'dispose')
    vi.spyOn(manager.rnnoiseEngine, 'processStream').mockImplementation(async () => {
      useMediaStore.getState().setRnnoiseStatus('ready'); return filtered
    })
    expect(await manager.runEngine(raw, () => {})).toBe(filtered)
    expect(dispose).toHaveBeenCalled()
    expect(manager.activeEngine).toBe(manager.rnnoiseEngine)
    expect(useMediaStore.getState().audioProcessorMode).toBe('deepfilter')
    expect(useMediaStore.getState().deepFilterStatus).toBe('fallback')
    expect(useMediaStore.getState().deepFilterError).toContain('SIMD unavailable')
  })
  it('uses classic DSP when both neural engines fail', async () => {
    expect(manager.deepFilterEngine).toBeDefined()
    vi.spyOn(manager.deepFilterEngine, 'processStream').mockResolvedValue(raw)
    vi.spyOn(manager.rnnoiseEngine, 'processStream').mockResolvedValue(raw)
    vi.spyOn(manager.classicEngine, 'processStream').mockReturnValue(filtered)
    expect(await manager.runEngine(raw, () => {})).toBe(filtered)
    expect(manager.activeEngine).toBe(manager.classicEngine)
    expect(useMediaStore.getState().deepFilterStatus).toBe('fallback')
    expect(useMediaStore.getState().rnnoiseStatus).toBe('fallback')
  })
  it('reports RNNoise as active when DeepFilterNet falls back', () => {
    const display = noiseSuppressionDisplay(true, 'deepfilter', 'ready', 'fallback')
    expect(display.activeMode).toBe('rnnoise')
    expect(display.canRetry).toBe(true)
    expect(display.notice).toContain('fallback do DeepFilterNet')
  })
  it('reports classic DSP if RNNoise also falls back', () => {
    expect(noiseSuppressionDisplay(true, 'deepfilter', 'fallback', 'fallback').activeMode).toBe('classic')
  })
  it('never advertises an inactive DeepFilterNet', () => {
    for (const status of ['idle', 'loading', 'error'] as const) {
      expect(noiseSuppressionDisplay(true, 'deepfilter', 'idle', status).activeMode).toBeNull()
    }
    expect(noiseSuppressionDisplay(false, 'deepfilter', 'ready', 'ready').activeMode).toBeNull()
  })
})
