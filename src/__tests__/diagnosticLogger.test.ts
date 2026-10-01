import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  diagLog,
  diagStats,
  flushDiagLogs,
  summarizeTrack,
  summarizeStream,
  __resetDiagForTests,
} from '../utils/diagnosticLogger'

describe('diagnosticLogger', () => {
  beforeEach(() => __resetDiagForTests())
  afterEach(() => {
    __resetDiagForTests()
    ;(globalThis as any).window = undefined
    vi.unstubAllGlobals()
  })

  it('summarizes tracks without keeping references', () => {
    expect(summarizeTrack(null)).toBeNull()
    expect(summarizeTrack(undefined)).toBeNull()
    const snap = summarizeTrack({
      kind: 'video',
      enabled: false,
      muted: true,
      readyState: 'live',
      label: 'FaceTime HD Camera',
      __isDummy: true,
    } as unknown as MediaStreamTrack)
    expect(snap).toMatchObject({ kind: 'video', enabled: false, muted: true, readyState: 'live', dummy: true })
    expect(typeof snap?.label).toBe('string')
  })

  it('summarizes streams and survives broken getters', () => {
    expect(summarizeStream(null)).toBeNull()
    const fake = {
      getAudioTracks: () => [{ kind: 'audio', enabled: true, muted: false, readyState: 'live' }],
      getVideoTracks: () => [],
    } as unknown as MediaStream
    expect(summarizeStream(fake)).toEqual({
      audio: [{ kind: 'audio', enabled: true, muted: false, readyState: 'live', dummy: undefined, label: undefined }],
      video: [],
    })
    const broken = {
      getAudioTracks: () => {
        throw new Error('nope')
      },
      getVideoTracks: () => [],
    } as unknown as MediaStream
    expect(summarizeStream(broken)).toEqual({ audio: [], video: [] })
  })

  it('caps the ring buffer and flags drops', () => {
    for (let i = 0; i < 2050; i++) diagLog('media', `evt-${i}`)
    const stats = diagStats()
    expect(stats.buffered).toBe(2000)
    expect(stats.dropping).toBe(true)
    expect(typeof stats.session).toBe('string')
  })

  it('flushes a batch to Electron and empties the buffer', async () => {
    const sent: unknown[][] = []
    ;(globalThis as any).window = {
      electronAPI: {
        diagnosticLogBatch: vi.fn(async (batch: unknown[]) => {
          sent.push(batch)
          return { ok: true, path: null }
        }),
      },
    }
    diagLog('p2p', 'call.dial', { toPeer: 'abc' })
    diagLog('tile', 'play-failed', { tile: 'mini' })
    await flushDiagLogs()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(2)
    expect((sent[0][0] as any).event).toBe('call.dial')
    expect(diagStats().buffered).toBe(0)
  })

  it('keeps the buffer in memory when there is no disk sink', async () => {
    ;(globalThis as any).window = undefined
    diagLog('media', 'startMedia.ready')
    await flushDiagLogs()
    expect(diagStats().buffered).toBe(1)
  })

  it('re-queues when the disk write fails', async () => {
    ;(globalThis as any).window = {
      electronAPI: {
        diagnosticLogBatch: vi.fn(async () => {
          throw new Error('disk busy')
        }),
      },
    }
    diagLog('media', 'mute')
    await flushDiagLogs()
    expect(diagStats().buffered).toBe(1)
  })

  it('never throws from diagLog', () => {
    expect(() => diagLog('x', 'y', { self: {} })).not.toThrow()
  })
})
