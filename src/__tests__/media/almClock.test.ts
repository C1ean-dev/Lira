import { afterEach, expect, it, vi } from 'vitest'
import { AlmCaptureClock, AlmPlayoutClock } from '../../media/almClock'

afterEach(() => vi.useRealTimers())

it('normalizes different capture timestamp origins onto the same source clock', () => {
  const clock = new AlmCaptureClock(() => 100)
  const audioStart = clock.stamp('audio', 9_000_000, 10_000)
  const video = clock.stamp('video', 0)
  expect(audioStart).toBe(90_000)
  expect(video).toBe(100_000)
  expect(clock.stamp('audio', 9_020_000, 10_000)).toBe(110_000)
  expect(clock.stamp('video', 33_333)).toBe(133_333)
})

it('schedules audio and video with the same timestamp at the same receiver deadline', () => {
  vi.useFakeTimers()
  let now = 0
  const clock = new AlmPlayoutClock(() => now)
  const show = vi.fn(), release = vi.fn()
  const target = clock.target(500_000)!
  clock.audio(500_000, target, 20)
  clock.schedule(500_000, show, release)
  now = 119; vi.advanceTimersByTime(119)
  expect(show).not.toHaveBeenCalled()
  now = 120; vi.advanceTimersByTime(1)
  expect(show).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledOnce()
  expect(clock.describe().audioVideoSkewMs).toBe(0)
  clock.close()
})

it('cancels pending video and audio together when a stalled timeline is reanchored', () => {
  vi.useFakeTimers()
  let now = 0, resets = 0
  const clock = new AlmPlayoutClock(() => now)
  const release = vi.fn(), show = vi.fn()
  clock.onReset(() => resets++)
  clock.schedule(0, show, release)
  now = 1000
  expect(clock.target(100_000)).toBe(1120)
  expect(resets).toBe(1)
  expect(release).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(2000)
  expect(show).not.toHaveBeenCalled()
  clock.close()
})

it('delays both tracks together when the selected audio device needs more output time', () => {
  const clock = new AlmPlayoutClock(() => 0)
  expect(clock.target(100_000)).toBe(120)
  clock.ensureLead(540)
  expect(clock.target(100_000)).toBe(540)
  expect(clock.target(120_000)).toBe(560)
  expect(clock.describe().playoutLeadMs).toBe(540)
  clock.close()
})

it('counts gaps between played frames as freezes while accepting a steady lower frame rate', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const clock = new AlmPlayoutClock()
  const show = vi.fn()
  for (let frame = 0; frame < 6; frame++) {
    clock.schedule(frame * 40_000, show, vi.fn())
    vi.advanceTimersByTime(40)
  }
  vi.advanceTimersByTime(120)
  expect(clock.videoStats()).toMatchObject({ freezeCount: 0, freezeDurationSec: 0, droppedFrames: 0 })

  clock.schedule(500_000, show, vi.fn())
  vi.advanceTimersByTime(260)
  expect(show).toHaveBeenCalledTimes(7)
  expect(clock.videoStats()).toMatchObject({ freezeCount: 1, freezeDurationSec: 0.3 })
  clock.close()
})

it('counts cancelled playout frames and frames that arrive too late without counting them as played', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const clock = new AlmPlayoutClock()
  const release = vi.fn(), show = vi.fn()
  clock.schedule(0, show, release)
  clock.ensureLead(240)
  clock.schedule(500_000, show, release)
  vi.advanceTimersByTime(740)
  clock.schedule(0, show, release)
  expect(show).toHaveBeenCalledOnce()
  expect(release).toHaveBeenCalledTimes(3)
  expect(clock.videoStats()).toMatchObject({ droppedFrames: 2, freezeCount: 0 })
  clock.close()
})
