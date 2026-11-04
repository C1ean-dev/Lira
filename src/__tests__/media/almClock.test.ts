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
