import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  LIVE_QUALITY_INTERVAL_MS,
  describeCodec,
  logVideoCodecsOnce,
  watchLiveQuality,
  __resetLiveQualityLogForTests,
} from '../p2p/liveQualityLog'
import { flushDiagLogs, __resetDiagForTests } from '../utils/diagnosticLogger'

const H264_BASELINE = 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f'

/** What the browser reports the n-th time it is asked: 10 s of a 5 Mbps live per step. */
const report = (n: number, over: Record<string, unknown> = {}) =>
  new Map<string, any>([
    ['codec-1', { id: 'codec-1', type: 'codec', mimeType: 'video/H264', sdpFmtpLine: H264_BASELINE }],
    ['out-audio', { type: 'outbound-rtp', kind: 'audio', bytesSent: 999 }],
    ['in-video-before', { type: 'inbound-rtp', kind: 'video', frameWidth: 16, frameHeight: 16, qpSum: 1 }],
    [
      'out-video',
      {
        type: 'outbound-rtp',
        kind: 'video',
        codecId: 'codec-1',
        timestamp: n * 10_000,
        bytesSent: n * 6_250_000,
        framesEncoded: n * 600,
        qpSum: n * 600 * 24,
        totalEncodeTime: n * 600 * 0.004,
        keyFramesEncoded: n,
        pliCount: n * 2,
        frameWidth: 1920,
        frameHeight: 1080,
        framesPerSecond: 59.6,
        targetBitrate: 5_500_000,
        qualityLimitationReason: 'none',
        encoderImplementation: 'MediaFoundationVideoEncodeAccelerator',
        powerEfficientEncoder: true,
        ...over,
      },
    ],
    // What this side receives is not what it sends, wherever it comes in the report.
    ['in-video-after', { type: 'inbound-rtp', kind: 'video', frameWidth: 16, frameHeight: 16, qpSum: 1 }],
    ['remote-in', { type: 'remote-inbound-rtp', kind: 'video', fractionLost: 0.0123, roundTripTime: 0.045 }],
    ['idle-pair', { type: 'candidate-pair', nominated: false, availableOutgoingBitrate: 300_000 }],
    ['pair', { type: 'candidate-pair', nominated: true, availableOutgoingBitrate: 8_000_000 }],
  ])

/** A connection whose stats advance one step each time they are read. */
const connection = (step: (n: number) => Map<string, any> = (n) => report(n)) => {
  let reads = 0
  const pc: any = { getStats: vi.fn(async () => step(reads++)) }
  return pc
}

const captureDiag = () => {
  const entries: any[] = []
  ;(globalThis as any).window = {
    ...((globalThis as any).window ?? {}),
    electronAPI: {
      diagnosticLogBatch: vi.fn(async (batch: any[]) => {
        entries.push(...batch)
        return { ok: true, path: null }
      }),
    },
  }
  return async (event = 'quality-stats') => {
    await flushDiagLogs()
    return entries.filter((e) => e.event === event).map((e) => e.data)
  }
}

describe('live quality log', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetDiagForTests()
    __resetLiveQualityLogForTests()
  })
  afterEach(() => {
    __resetDiagForTests()
    __resetLiveQualityLogForTests()
    vi.useRealTimers()
    ;(globalThis as any).window = undefined
  })

  describe('describeCodec', () => {
    it('names the H.264 profile and level that were negotiated', () => {
      expect(describeCodec('video/H264', H264_BASELINE)).toEqual({ codec: 'H264', profile: 'Constrained Baseline 3.1' })
      expect(describeCodec('video/H264', 'profile-level-id=42001f')).toEqual({ codec: 'H264', profile: 'Baseline 3.1' })
      expect(describeCodec('video/H264', 'profile-level-id=4d0028;packetization-mode=1')).toEqual({
        codec: 'H264',
        profile: 'Main 4.0',
      })
      expect(describeCodec('video/H264', 'profile-level-id=64001f')).toEqual({ codec: 'H264', profile: 'High 3.1' })
      expect(describeCodec('video/H264', 'profile-level-id=640c34')).toEqual({
        codec: 'H264',
        profile: 'Constrained High 5.2',
      })
    })

    it('keeps what it cannot name as the browser wrote it', () => {
      expect(describeCodec('video/H264', 'profile-level-id=f4001f')).toEqual({
        codec: 'H264',
        profile: 'profile-level-id=f4001f',
      })
      expect(describeCodec('video/H264', undefined)).toEqual({ codec: 'H264', profile: null })
      expect(describeCodec('video/VP9', 'profile-id=0')).toEqual({ codec: 'VP9', profile: 'profile-id=0' })
      expect(describeCodec('video/AV1', 'level-idx=5;profile=0;tier=0')).toEqual({
        codec: 'AV1',
        profile: 'level-idx=5;profile=0;tier=0',
      })
      expect(describeCodec('video/VP8', '')).toEqual({ codec: 'VP8', profile: null })
    })

    it('says nothing about a codec it was not told', () => {
      expect(describeCodec(undefined, undefined)).toEqual({ codec: null, profile: null })
      expect(describeCodec(42 as any, {} as any)).toEqual({ codec: null, profile: null })
    })
  })

  describe('watchLiveQuality', () => {
    it('logs every 10 s what the encoder did in those 10 s', async () => {
      const samples = captureDiag()
      const pc = connection()
      watchLiveQuality({
        pc,
        peerId: 'viewer-1',
        isActive: () => true,
        viewer: () => ({ mode: 'on', askH: 180 }),
      })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 2)

      // The first sample is the first reading; the second has an interval behind it.
      expect((await samples())[1]).toEqual(
        {
          toPeer: 'viewer-1',
          mode: 'on',
          askH: 180,
          codec: 'H264',
          profile: 'Constrained Baseline 3.1',
          encoder: 'MediaFoundationVideoEncodeAccelerator',
          hw: true,
          w: 1920,
          h: 1080,
          fps: 60,
          sentKbps: 5000,
          targetKbps: 5500,
          estimateKbps: 8000,
          qp: 24,
          encodeMs: 4,
          keyFrames: 1,
          pli: 2,
          limit: 'none',
          lostPct: 1.2,
          rttMs: 45,
        }
      )
    })

    it('is ten seconds long', () => {
      expect(LIVE_QUALITY_INTERVAL_MS).toBe(10_000)
    })

    it('gives the QP of each interval, not the average since the call started', async () => {
      const samples = captureDiag()
      // 600 frames at QP 20, then 600 at QP 30, then 600 at QP 26.5.
      const qpSums = [0, 12_000, 30_000, 45_900]
      const pc = connection((n) => report(n, { qpSum: qpSums[n] }))
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 4)

      expect((await samples()).map((s) => s.qp)).toEqual([null, 20, 30, 26.5])
    })

    it('does not read the stats before the first 10 s are over', async () => {
      const samples = captureDiag()
      const pc = connection()
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS - 1)
      expect(pc.getStats).not.toHaveBeenCalled()
      expect(await samples()).toEqual([])
    })

    it('leaves the numbers of the interval empty in the first sample: there is nothing to compare with', async () => {
      const samples = captureDiag()
      const pc = connection((n) => report(n + 3))
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS)

      const [first] = await samples()
      expect(first).toMatchObject({
        codec: 'H264',
        encoder: 'MediaFoundationVideoEncodeAccelerator',
        w: 1920,
        h: 1080,
        targetKbps: 5500,
        sentKbps: null,
        qp: null,
        encodeMs: null,
        keyFrames: null,
        pli: null,
      })
    })

    it('goes on after a reading that failed', async () => {
      const samples = captureDiag()
      let reads = 0
      const pc: any = {
        getStats: vi.fn(async () => {
          const n = reads++
          if (n === 1) throw new Error('busy')
          return report(n)
        }),
      }
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 3)

      // Readings 0 and 2 are 20 s apart: the bitrate is still 5 Mbps.
      expect((await samples()).map((s) => s.sentKbps)).toEqual([null, 5000])
    })

    it('says who the sample is about when no viewer state is given', async () => {
      const samples = captureDiag()
      watchLiveQuality({ pc: connection(), peerId: 'viewer-9', isActive: () => true })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS)
      expect((await samples())[0]).toMatchObject({ toPeer: 'viewer-9', mode: null, askH: null })
    })

    it('runs the tick before each sample', async () => {
      const order: string[] = []
      const pc: any = {
        getStats: vi.fn(async () => {
          order.push('stats')
          return report(0)
        }),
      }
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true, onTick: () => order.push('tick') })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 2)
      expect(order).toEqual(['tick', 'stats', 'tick', 'stats'])
    })

    it('stops for good when the live is over', async () => {
      const samples = captureDiag()
      const pc = connection()
      const onTick = vi.fn()
      let live = true
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => live, onTick })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS)
      live = false
      const reads = pc.getStats.mock.calls.length
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 5)
      // Back on: a watch that ended does not come back.
      live = true
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 5)

      expect(pc.getStats).toHaveBeenCalledTimes(reads)
      expect(onTick).toHaveBeenCalledTimes(1)
      expect(await samples()).toHaveLength(1)
    })

    it('drops a sample whose stats arrive after the live is over', async () => {
      const samples = captureDiag()
      let live = true
      let release: (stats: Map<string, any>) => void = () => {}
      const pc: any = {
        getStats: vi.fn(() => new Promise<Map<string, any>>((resolve) => (release = resolve))),
      }
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => live })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS)
      expect(pc.getStats).toHaveBeenCalledTimes(1)
      live = false
      release(report(1))
      await vi.advanceTimersByTimeAsync(0)

      expect(await samples()).toEqual([])
    })

    it('is one per connection: a new watch replaces the one before it', async () => {
      const samples = captureDiag()
      const pc = connection()
      const first = vi.fn()
      const second = vi.fn()
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true, onTick: first })
      await vi.advanceTimersByTimeAsync(4000)
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true, onTick: second })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 2)

      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledTimes(2)
      expect(await samples()).toHaveLength(2)
    })

    it('keeps the tick going on a connection without stats', async () => {
      const samples = captureDiag()
      const onTick = vi.fn()
      watchLiveQuality({ pc: {} as any, peerId: 'viewer-1', isActive: () => true, onTick })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 3)
      expect(onTick).toHaveBeenCalledTimes(3)
      expect(await samples()).toEqual([])
    })

    it('never throws when the stats fail, and keeps ticking', async () => {
      const samples = captureDiag()
      const failing: any = {
        getStats: vi.fn(async () => {
          throw new Error('connection closed')
        }),
      }
      const throwing: any = {
        getStats: vi.fn(() => {
          throw new Error('sync failure')
        }),
      }
      const broken: any = { getStats: vi.fn(async () => ({ forEach: () => { throw new Error('bad report') } })) }
      const ticks = vi.fn()
      for (const pc of [failing, throwing, broken]) {
        expect(() => watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true, onTick: ticks })).not.toThrow()
      }
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 2)

      expect(ticks).toHaveBeenCalledTimes(6)
      expect(await samples()).toEqual([])
    })

    it('survives a tick that throws', async () => {
      const samples = captureDiag()
      const pc = connection()
      watchLiveQuality({
        pc,
        peerId: 'viewer-1',
        isActive: () => true,
        onTick: () => {
          throw new Error('sender is gone')
        },
      })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 2)
      expect(await samples()).toHaveLength(2)
    })

    it('says nothing when there is no video being sent on the connection', async () => {
      const samples = captureDiag()
      const pc: any = {
        getStats: vi.fn(async () => new Map<string, any>([['out-audio', { type: 'outbound-rtp', kind: 'audio', bytesSent: 1 }]])),
      }
      watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true })
      await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 2)
      expect(await samples()).toEqual([])
    })

    describe('a viewer that is not watching', () => {
      it('is logged once to show that nothing is sent, then only if something is', async () => {
        const samples = captureDiag()
        // Nothing sent for 30 s, then 10 s of video, then nothing again.
        const bytes = [1000, 1000, 1000, 126_000, 126_000, 126_000]
        const pc = connection((n) => report(n, { bytesSent: bytes[n], framesPerSecond: 0 }))
        watchLiveQuality({
          pc,
          peerId: 'viewer-1',
          isActive: () => true,
          viewer: () => ({ mode: 'off', askH: null }),
        })
        await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 6)

        expect((await samples()).map((s) => [s.mode, s.sentKbps])).toEqual([
          ['off', null],
          ['off', 100],
          ['off', 0],
        ])
      })

      it('is logged again every 10 s once it watches', async () => {
        const samples = captureDiag()
        let mode = 'off'
        const pc = connection((n) => report(n, { bytesSent: 1000 }))
        watchLiveQuality({ pc, peerId: 'viewer-1', isActive: () => true, viewer: () => ({ mode, askH: null }) })
        await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 2)
        mode = 'on'
        await vi.advanceTimersByTimeAsync(LIVE_QUALITY_INTERVAL_MS * 2)

        expect((await samples()).map((s) => s.mode)).toEqual(['off', 'on', 'on'])
      })
    })
  })

  describe('logVideoCodecsOnce', () => {
    const codecs = (...list: Array<[string, string?]>) => ({
      codecs: list.map(([mimeType, sdpFmtpLine]) => ({ mimeType, sdpFmtpLine })),
    })

    it('records once what this build can send and receive', async () => {
      const read = captureDiag()
      Object.assign((globalThis as any).window, {
        RTCRtpSender: {
          getCapabilities: vi.fn(() =>
            codecs(
              ['video/VP8'],
              ['video/rtx', 'apt=96'],
              ['video/H264', H264_BASELINE],
              ['video/H264', 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f'],
              ['video/H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f'],
              ['video/VP9', 'profile-id=0'],
              ['video/red'],
              ['video/ulpfec'],
              ['video/flexfec-03', 'repair-window=10000000']
            )
          ),
        },
        RTCRtpReceiver: {
          getCapabilities: vi.fn(() => codecs(['video/VP8'], ['video/AV1', 'level-idx=5;profile=0;tier=0'], ['video/rtx'])),
        },
      })

      logVideoCodecsOnce()
      logVideoCodecsOnce()

      expect(await read('video-codecs')).toEqual([
        {
          send: ['VP8', 'H264 Constrained Baseline 3.1', 'H264 Constrained High 3.1', 'VP9 profile-id=0'],
          receive: ['VP8', 'AV1 level-idx=5;profile=0;tier=0'],
        },
      ])
    })

    it('waits for a place where the capabilities can be read', async () => {
      const read = captureDiag()
      logVideoCodecsOnce()
      expect(await read('video-codecs')).toEqual([])

      Object.assign((globalThis as any).window, {
        RTCRtpSender: { getCapabilities: () => codecs(['video/VP8']) },
      })
      logVideoCodecsOnce()
      expect(await read('video-codecs')).toEqual([{ send: ['VP8'], receive: null }])
    })

    it('never throws', () => {
      ;(globalThis as any).window = {
        RTCRtpSender: {
          getCapabilities: () => {
            throw new Error('no video')
          },
        },
      }
      expect(() => logVideoCodecsOnce()).not.toThrow()
      ;(globalThis as any).window = undefined
      expect(() => logVideoCodecsOnce()).not.toThrow()
    })
  })
})
