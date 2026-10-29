import { describe, it, expect } from 'vitest'
import { NoiseSuppressor } from '../../media/NoiseSuppressor'
import { DeepFilterProcessor } from '../../media/DeepFilterProcessor'
import { RnnoiseProcessor } from '../../media/RnnoiseProcessor'
import { AUTO_GATE } from '../../media/autoGate'
import { useMediaStore } from '../../store/useMediaStore'

describe('Noise Gate Hold Time (Hangover) & Adaptive Threshold Features', () => {
  it('NoiseSuppressor exposes a standard 220ms hold time to eliminate word clipping', () => {
    const ns = new NoiseSuppressor()
    expect(ns.getHoldTimeMs()).toBe(220)
    expect(ns.getDynamicNoiseFloor()).toBe(AUTO_GATE.INITIAL_FLOOR_RMS)
  })

  it('DeepFilterProcessor exposes a standard 220ms hold time for natural human speech', () => {
    const soft = new DeepFilterProcessor()
    expect(soft.getHoldTimeMs()).toBe(220)
  })

  it('RnnoiseProcessor exposes a standard 220ms hold time', () => {
    const rnn = new RnnoiseProcessor()
    expect(rnn.getHoldTimeMs()).toBe(220)
  })

  it('useMediaStore stores and updates autoThresholdPercent cleanly', () => {
    useMediaStore.setState({ autoThresholdPercent: 0 })
    expect(useMediaStore.getState().autoThresholdPercent).toBe(0)

    useMediaStore.getState().setLocalAudioLevel(0.25, true, 14)
    expect(useMediaStore.getState().autoThresholdPercent).toBe(14)
    expect(useMediaStore.getState().localAudioLevel).toBe(0.25)
    expect(useMediaStore.getState().isGateOpen).toBe(true)
  })

  it('useMediaStore setLocalAudioLevel ignores negligible level changes when gate and threshold are unchanged', () => {
    useMediaStore.setState({ localAudioLevel: 0.100, isGateOpen: false, autoThresholdPercent: 12 })
    
    useMediaStore.getState().setLocalAudioLevel(0.102, false, 12)
    expect(useMediaStore.getState().localAudioLevel).toBe(0.100)

    useMediaStore.getState().setLocalAudioLevel(0.102, true, 12)
    expect(useMediaStore.getState().isGateOpen).toBe(true)
  })
})

