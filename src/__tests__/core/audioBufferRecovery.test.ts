import { describe, expect, it } from 'vitest'
import { DynamicBufferManager } from '../../services/DynamicBufferManager'

describe('audio buffer recovery cadence', () => {
  it('waits four clean polls between reductions and resets after a jitter spike', () => {
    const manager = DynamicBufferManager.getInstance()
    manager.resetForNewCall()
    const adapt = (jitter: number, loss = 0) => manager['adaptBuffer']('audio', jitter, loss, 0, 0, 0)
    const current = () => manager['buffers'].audio.currentMs
    try {
      adapt(100)
      const high = current()
      for (let i = 0; i < 3; i++) adapt(0)
      expect(current()).toBe(high)
      adapt(0)
      expect(current()).toBe(high - 10)
      for (let i = 0; i < 3; i++) adapt(0)
      expect(current()).toBe(high - 10)
      adapt(0)
      expect(current()).toBe(high - 20)
      adapt(200, 0.05)
      const afterSpike = current()
      expect(afterSpike).toBeGreaterThan(high - 20)
      for (let i = 0; i < 3; i++) adapt(0)
      expect(current()).toBe(afterSpike)
      adapt(0)
      expect(current()).toBe(afterSpike - 10)
    } finally { manager.resetForNewCall(); manager.stopMonitoring() }
  })
})
