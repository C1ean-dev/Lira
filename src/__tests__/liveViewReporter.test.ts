import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  LiveViewReporter,
  VIEW_RENEW_MS,
  VIEW_SEND_DELAY_MS,
  VIEW_SHRINK_DELAY_MS,
} from '../media/liveViewReporter'
import { viewHeightFor } from '../hooks/useLiveViewBox'
import { flushDiagLogs, __resetDiagForTests } from '../utils/diagnosticLogger'

const setup = (stats?: (sharerId: string) => any) => {
  const send = vi.fn()
  const reporter = new LiveViewReporter({ send, stats })
  /** What was sent since the last look, oldest first. */
  const sent = () => {
    const calls = send.mock.calls.map(([to, watch, h]) => ({ to, watch, h }))
    send.mockClear()
    return calls
  }
  const soon = () => vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
  return { reporter, send, sent, soon }
}

/** A reporter that is watching one live, shown 180 px tall, with that already sent. */
const watchingOne = async (stats?: (sharerId: string) => any) => {
  const s = setup(stats)
  s.reporter.setSharers(['ana'])
  s.reporter.setWatching(['ana'])
  s.reporter.setBox('mini', 'ana', 180)
  await s.soon()
  s.sent()
  return s
}

describe('what a viewer tells who is live', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetDiagForTests()
  })
  afterEach(() => {
    __resetDiagForTests()
    vi.useRealTimers()
    ;(globalThis as any).window = undefined
  })

  describe('before a click', () => {
    it('says that it is not watching as soon as a live starts', async () => {
      const { reporter, sent, soon } = setup()
      reporter.setSharers(['ana'])
      expect(sent()).toEqual([])
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: false, h: 0 }])
    })

    it('says it once, however large the live is shown', async () => {
      const { reporter, sent, soon } = setup()
      reporter.setSharers(['ana'])
      reporter.setBox('mini', 'ana', 180)
      reporter.setBox('grid', 'ana', 630)
      await soon()
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS)
      expect(sent()).toEqual([{ to: 'ana', watch: false, h: 0 }])
    })

    it('says nothing to somebody who is not live', async () => {
      const { reporter, sent, soon } = setup()
      reporter.setWatching(['ana'])
      reporter.setBox('mini', 'ana', 180)
      reporter.callConnected('ana')
      // Not even a timer: there is nobody to say anything to.
      expect(vi.getTimerCount()).toBe(0)
      await soon()
      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS * 2)
      expect(sent()).toEqual([])
    })
  })

  describe('the click', () => {
    it('asks for the live at the height it is shown', async () => {
      const { reporter, sent, soon } = setup()
      reporter.setSharers(['ana'])
      await soon()
      sent()

      reporter.setWatching(['ana'])
      reporter.setBox('mini', 'ana', 180)
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 180 }])
    })

    it('waits for the picture to be on screen, so the first request already has a size', async () => {
      const { reporter, sent } = setup()
      reporter.setSharers(['ana'])
      await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
      sent()

      reporter.setWatching(['ana'])
      await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS - 10)
      expect(sent()).toEqual([])
      reporter.setBox('mini', 'ana', 180)
      await vi.advanceTimersByTimeAsync(10)
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 180 }])
    })

    it('asks for everything when the live is shown nowhere it can measure', async () => {
      const { reporter, sent, soon } = setup()
      reporter.setSharers(['ana'])
      reporter.setWatching(['ana'])
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: null }])
    })

    it('asks for the largest of the places the live is shown in', async () => {
      const { reporter, sent, soon } = setup()
      reporter.setSharers(['ana'])
      reporter.setWatching(['ana'])
      reporter.setBox('tile', 'ana', 90)
      reporter.setBox('mini', 'ana', 180)
      reporter.setBox('grid', 'ana', 630)
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 630 }])
    })

    it('keeps each live to its own size', async () => {
      const { reporter, sent, soon } = setup()
      reporter.setSharers(['ana', 'bia'])
      reporter.setWatching(['ana'])
      reporter.setBox('mini-ana', 'ana', 180)
      reporter.setBox('grid-bia', 'bia', 630)
      await soon()
      expect(sent()).toEqual([
        { to: 'ana', watch: true, h: 180 },
        { to: 'bia', watch: false, h: 0 },
      ])
    })
  })

  describe('a picture that changes size', () => {
    it('asks for more at once', async () => {
      const { reporter, sent, soon } = await watchingOne()
      reporter.setBox('grid', 'ana', 630)
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 630 }])
    })

    it('asks for less only after it stayed smaller for a while', async () => {
      const { reporter, sent } = await watchingOne()
      reporter.setBox('grid', 'ana', 630)
      await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
      sent()

      reporter.clearBox('grid')
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS - 1)
      expect(sent()).toEqual([])
      await vi.advanceTimersByTimeAsync(1 + VIEW_SEND_DELAY_MS)
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 180 }])
    })

    it('forgets about asking for less when the picture grows back in time', async () => {
      const { reporter, sent } = await watchingOne()
      reporter.setBox('grid', 'ana', 630)
      await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
      sent()

      reporter.clearBox('grid')
      await vi.advanceTimersByTimeAsync(1000)
      reporter.setBox('grid', 'ana', 630)
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS * 2)
      expect(sent()).toEqual([])
    })

    it('asks for more at once even while it waits to ask for less', async () => {
      const { reporter, sent, soon } = await watchingOne()
      reporter.setBox('grid', 'ana', 630)
      await soon()
      sent()

      reporter.setBox('grid', 'ana', 300)
      await vi.advanceTimersByTimeAsync(1000)
      reporter.setBox('grid', 'ana', 1080)
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 1080 }])
      // And the smaller size that was waiting is forgotten.
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS * 2)
      expect(sent()).toEqual([])
    })

    it('does not count a place with no size: the live is not taken as hidden', async () => {
      const { reporter, sent, soon } = await watchingOne()
      reporter.setBox('mini', 'ana', 0)
      await soon()
      // The only place lost its size: unknown, so everything, and at once.
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: null }])

      reporter.setBox('grid', 'ana', 630)
      reporter.setBox('grid', 'ana', -5)
      reporter.setBox('tile', 'ana', Number.NaN)
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS * 2)
      expect(sent()).toEqual([])
    })

    it('counts the wait from the moment it got smaller, not from each resize after that', async () => {
      const { reporter, sent } = await watchingOne()
      reporter.setBox('grid', 'ana', 630)
      await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
      sent()

      reporter.setBox('grid', 'ana', 420)
      await vi.advanceTimersByTimeAsync(2000)
      reporter.setBox('grid', 'ana', 390)
      await vi.advanceTimersByTimeAsync(500 + VIEW_SEND_DELAY_MS)
      // 2.5 s after the first shrink: what is asked is the size it has now.
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 390 }])
    })

    it('says nothing when the size did not change', async () => {
      const { reporter, sent } = await watchingOne()
      reporter.setBox('mini', 'ana', 180)
      reporter.setBox('tile', 'ana', 90)
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS * 2)
      expect(sent()).toEqual([])
    })

    it('asks for everything at once when it loses the only place it could measure', async () => {
      const { reporter, sent, soon } = await watchingOne()
      // A size that cannot be measured is asked as "everything": that is more, so there is no wait.
      reporter.clearBox('mini')
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: null }])

      // And a size again, once there is one, is less: it waits.
      reporter.setBox('mini', 'ana', 180)
      await soon()
      expect(sent()).toEqual([])
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS)
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 180 }])
    })
  })

  describe('stopping', () => {
    it('says so at once, whatever is on screen', async () => {
      const { reporter, sent, soon } = await watchingOne()
      reporter.setWatching([])
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: false, h: 0 }])
    })

    it('drops a smaller size it was about to ask for', async () => {
      const { reporter, sent } = await watchingOne()
      reporter.setBox('mini', 'ana', 90)
      await vi.advanceTimersByTimeAsync(1000)
      reporter.setWatching([])
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS * 2)
      expect(sent()).toEqual([{ to: 'ana', watch: false, h: 0 }])
    })

    it('asks again from the size on screen at the next click', async () => {
      const { reporter, sent, soon } = await watchingOne()
      reporter.setWatching([])
      await soon()
      sent()
      reporter.setWatching(['ana'])
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 180 }])
    })
  })

  describe('a window that shows nothing', () => {
    it('asks for the small picture after a while, and for the size back at once', async () => {
      const { reporter, sent, soon } = await watchingOne()
      reporter.setWindowVisible(false)
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS - 1)
      expect(sent()).toEqual([])
      await vi.advanceTimersByTimeAsync(1 + VIEW_SEND_DELAY_MS)
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 0 }])

      reporter.setWindowVisible(true)
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 180 }])
    })

    it('says nothing when the window comes back before the wait is over', async () => {
      const { reporter, sent } = await watchingOne()
      reporter.setWindowVisible(false)
      await vi.advanceTimersByTimeAsync(1000)
      reporter.setWindowVisible(true)
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS * 2)
      expect(sent()).toEqual([])
    })

    it('changes nothing for a live that is not being watched', async () => {
      const { reporter, sent, soon } = setup()
      reporter.setSharers(['ana'])
      await soon()
      sent()
      reporter.setWindowVisible(false)
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS * 2)
      expect(sent()).toEqual([])
    })
  })

  describe('repeating what it said', () => {
    it('renews every 10 s what it asked for, so who is live knows it still holds', async () => {
      const { reporter, sent } = setup()
      reporter.setSharers(['ana', 'bia'])
      reporter.setWatching(['ana'])
      reporter.setBox('mini', 'ana', 180)
      await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
      sent()

      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS)
      expect(sent()).toEqual([
        { to: 'ana', watch: true, h: 180 },
        { to: 'bia', watch: false, h: 0 },
      ])
      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS)
      expect(sent()).toHaveLength(2)
    })

    it('renews the size in force while it waits to ask for less', async () => {
      const { reporter, sent } = await watchingOne()
      reporter.setBox('grid', 'ana', 630)
      await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
      sent()

      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS - VIEW_SEND_DELAY_MS - 1000)
      reporter.clearBox('grid')
      await vi.advanceTimersByTimeAsync(1000)
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 630 }])
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS)
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 180 }])
    })

    it('says it again when the call with who is live connects', async () => {
      const { reporter, sent, soon } = await watchingOne()
      reporter.callConnected('ana')
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: true, h: 180 }])
    })

    it('stops when there is no live left', async () => {
      const { reporter, sent, soon } = await watchingOne()
      reporter.setSharers([])
      // No timer is left running for nobody.
      expect(vi.getTimerCount()).toBe(0)
      await soon()
      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS * 3)
      expect(sent()).toEqual([])
    })
  })

  describe('a live that ends', () => {
    it('is forgotten: the next one of the same person starts as not watched', async () => {
      const { reporter, sent, soon } = await watchingOne()
      reporter.setSharers([])
      reporter.setWatching([])
      await soon()
      expect(sent()).toEqual([])

      reporter.setSharers(['ana'])
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: false, h: 0 }])
    })

    it('is said "not watching" again at the next one, also when the one before was not watched', async () => {
      const { reporter, sent, soon } = setup()
      reporter.setSharers(['ana'])
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: false, h: 0 }])

      reporter.setSharers([])
      await soon()
      reporter.setSharers(['ana'])
      await soon()
      expect(sent()).toEqual([{ to: 'ana', watch: false, h: 0 }])
    })

    it('takes with it the smaller size that was about to be asked', async () => {
      const { reporter, sent } = await watchingOne()
      reporter.setBox('mini', 'ana', 90)
      reporter.setSharers([])
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(VIEW_SHRINK_DELAY_MS * 2)
      expect(sent()).toEqual([])
    })
  })

  it('goes on when a message cannot be sent', async () => {
    const send = vi.fn(() => {
      throw new Error('no connection')
    })
    const reporter = new LiveViewReporter({ send })
    reporter.setSharers(['ana', 'bia'])
    await vi.advanceTimersByTimeAsync(VIEW_SEND_DELAY_MS)
    expect(send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS)
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('does nothing more once it is disposed', async () => {
    const { reporter, sent } = await watchingOne()
    reporter.dispose()
    expect(vi.getTimerCount()).toBe(0)
    reporter.setSharers(['ana', 'bia'])
    reporter.setWatching(['ana'])
    reporter.setBox('grid', 'ana', 630)
    reporter.setWindowVisible(false)
    reporter.callConnected('ana')
    await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS * 2)
    expect(sent()).toEqual([])
  })

  describe('the log of what arrives', () => {
    const captureDiag = () => {
      const entries: any[] = []
      ;(globalThis as any).window = {
        electronAPI: {
          diagnosticLogBatch: vi.fn(async (batch: any[]) => {
            entries.push(...batch)
            return { ok: true, path: null }
          }),
        },
      }
      return async () => {
        await flushDiagLogs()
        return entries.filter((e) => e.cat === 'screenshare' && e.event === 'view-stats').map((e) => e.data)
      }
    }

    /** 10 s of a 270p live at 600 kbps per reading. */
    const inbound = (n: number) =>
      new Map<string, any>([
        ['codec-1', { id: 'codec-1', type: 'codec', mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=42e01f' }],
        ['in-audio', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 5 }],
        [
          'in-video',
          {
            type: 'inbound-rtp',
            kind: 'video',
            codecId: 'codec-1',
            timestamp: n * 10_000,
            bytesReceived: n * 750_000,
            framesDecoded: n * 600,
            framesDropped: n * 3,
            freezeCount: n,
            totalFreezesDuration: n * 0.25,
            qpSum: n * 600 * 28,
            jitterBufferDelay: n * 600 * 0.05,
            jitterBufferEmittedCount: n * 600,
            packetsLost: n * 4,
            pliCount: n,
            frameWidth: 480,
            frameHeight: 270,
            framesPerSecond: 59.7,
            decoderImplementation: 'D3D11VideoDecoder',
            powerEfficientDecoder: true,
          },
        ],
        // This viewer also sends its camera: that is not what arrives.
        ['out-video', { type: 'outbound-rtp', kind: 'video', frameWidth: 640, frameHeight: 360, bytesSent: n * 9 }],
      ])

    it('records every 10 s what is received of a live that is being watched', async () => {
      const log = captureDiag()
      // The call was already running: the counters do not start at zero.
      let reads = 5
      const stats = vi.fn(async () => inbound(reads++))
      await watchingOne(stats)
      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS * 2)

      const samples = await log()
      expect(samples).toHaveLength(2)
      expect(samples[1]).toEqual({
        fromPeer: 'ana',
        askH: 180,
        codec: 'H264',
        profile: 'Constrained Baseline 3.1',
        decoder: 'D3D11VideoDecoder',
        hw: true,
        w: 480,
        h: 270,
        fps: 60,
        kbps: 600,
        qp: 28,
        dropped: 3,
        freezes: 1,
        frozenMs: 250,
        jitterMs: 50,
        lost: 4,
        pli: 1,
      })
      // The first one has nothing to compare with.
      expect(samples[0]).toMatchObject({ fromPeer: 'ana', w: 480, h: 270, kbps: null, qp: null, dropped: null })
      expect(stats).toHaveBeenCalledWith('ana')
    })

    it('records nothing for a live that is not being watched', async () => {
      const log = captureDiag()
      const stats = vi.fn(async () => inbound(1))
      const { reporter } = setup(stats)
      reporter.setSharers(['ana'])
      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS * 2)
      expect(stats).not.toHaveBeenCalled()
      expect(await log()).toEqual([])
    })

    it('starts the comparison over at each click', async () => {
      const log = captureDiag()
      let reads = 0
      const { reporter } = await watchingOne(async () => inbound(reads++))
      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS)
      reporter.setWatching([])
      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS)
      reporter.setWatching(['ana'])
      await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS)

      expect((await log()).map((s) => s.kbps)).toEqual([null, null])
    })

    it('never throws when the stats are missing or fail', async () => {
      const log = captureDiag()
      const cases = [
        () => null,
        () => {
          throw new Error('no call')
        },
        async () => {
          throw new Error('closed')
        },
        async () => new Map<string, any>(),
      ]
      for (const stats of cases) {
        await watchingOne(stats as any)
        await vi.advanceTimersByTimeAsync(VIEW_RENEW_MS)
      }
      expect(await log()).toEqual([])
    })
  })
})

describe('how tall the picture of a live is on screen', () => {
  const WIDE = { videoWidth: 1920, videoHeight: 1080 }

  it('is the height of the picture inside its box, in device pixels, rounded up to a step', () => {
    // Mini player, 320x160, at 100%.
    expect(viewHeightFor({ width: 320, height: 160 }, WIDE, 'contain')).toBe(180)
    // The same box on a 150% screen is 480x240 device pixels.
    expect(viewHeightFor({ width: 480, height: 240 }, WIDE, 'contain')).toBe(240)
    // Mini tile, 124x92: the picture is 124 wide, so about 70 tall.
    expect(viewHeightFor({ width: 124, height: 92 }, WIDE, 'contain')).toBe(90)
    // Grid stage in a 1280x800 window.
    expect(viewHeightFor({ width: 1068, height: 630 }, WIDE, 'contain')).toBe(630)
  })

  it('is the height the picture needs to cover a box that crops it', () => {
    // Sidebar thumbnail of the grid: 176x99, covered.
    expect(viewHeightFor({ width: 176, height: 99 }, WIDE, 'cover')).toBe(120)
    // A square picture covering it is as tall as it is wide.
    expect(viewHeightFor({ width: 176, height: 99 }, { videoWidth: 500, videoHeight: 500 }, 'cover')).toBe(180)
  })

  it('assumes 16:9 until the first frame says the shape of the live', () => {
    expect(viewHeightFor({ width: 124, height: 92 }, { videoWidth: 0, videoHeight: 0 }, 'contain')).toBe(90)
    expect(viewHeightFor({ width: 124, height: 92 }, null, 'contain')).toBe(90)
    expect(viewHeightFor({ width: 124, height: 92 }, {}, 'contain')).toBe(90)
  })

  it('is zero for a box with no size', () => {
    expect(viewHeightFor({ width: 0, height: 0 }, WIDE, 'contain')).toBe(0)
  })
})
