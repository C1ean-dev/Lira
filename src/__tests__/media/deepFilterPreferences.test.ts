import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
describe('persisted audio processor migration', () => {
  it.each(['soft', 'deepfilter', 'rnnoise', 'classic', undefined])('loads the saved %s preference and calibration', async previous => {
    vi.resetModules()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'lira_audio_settings' ? JSON.stringify({
        audioProcessorMode: previous, hasUserChosenProcessorMode: true,
        micCalibrations: { mic: { recommendedMode: previous, noiseFloorDb: -50, calibratedAt: 42 } },
      }) : null,
      setItem: vi.fn(), removeItem: vi.fn(),
    })
    const { useMediaStore } = await import('../../store/useMediaStore')
    const expected = previous === 'soft' ? 'deepfilter' : previous ?? 'rnnoise'
    expect(useMediaStore.getState().audioProcessorMode).toBe(expected)
    expect(useMediaStore.getState().micCalibrations.mic.recommendedMode).toBe(expected)
    expect(useMediaStore.getState().micCalibrations.mic.calibratedAt).toBe(42)
    expect(useMediaStore.getState().hasUserChosenProcessorMode).toBe(true)
  })
  it.each([false, undefined])('keeps RNNoise as the default with an old automatic mode (chosen=%s)', async chosen => {
    vi.resetModules()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'lira_audio_settings' ? JSON.stringify({
        audioProcessorMode: 'deepfilter', hasUserChosenProcessorMode: chosen,
        micCalibrations: { default: { recommendedMode: 'deepfilter' } },
      }) : null,
      setItem: vi.fn(), removeItem: vi.fn(),
    })
    const { useMediaStore } = await import('../../store/useMediaStore')
    expect(useMediaStore.getState().audioProcessorMode).toBe('rnnoise')
    expect(useMediaStore.getState().hasUserChosenProcessorMode).toBe(false)
  })
  it.each(['deepfilter', 'classic'] as const)('remembers an explicit %s choice after fallback and reload', async mode => {
    vi.resetModules()
    const memory = new Map<string, string>()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key),
    })
    const { useMediaStore } = await import('../../store/useMediaStore')
    expect(useMediaStore.getState().audioProcessorMode).toBe('rnnoise')
    useMediaStore.getState().setAudioProcessorMode(mode)
    useMediaStore.getState().setDeepFilterStatus('fallback', 'overload')
    useMediaStore.getState().setRnnoiseStatus('ready')
    vi.resetModules()
    const { useMediaStore: reloaded } = await import('../../store/useMediaStore')
    expect(reloaded.getState().audioProcessorMode).toBe(mode)
    expect(reloaded.getState().hasUserChosenProcessorMode).toBe(true)
  })
})
