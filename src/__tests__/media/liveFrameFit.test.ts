import { expect, it } from 'vitest'
import { fitLiveFrame } from '../../hooks/useLiveFrameFit'

it('fits an entire 1920x1200 screen in a widescreen stage without internal pillarboxes', () => {
  const frame = fitLiveFrame({ width: 960, height: 540 }, { width: 1920, height: 1200 }, 4)!
  expect(frame.height).toBe(540)
  expect(frame.width).toBeCloseTo(861.6)
  expect((frame.width - 4) / (frame.height - 4)).toBeCloseTo(1.6)
})

it('fits widescreen, portrait and ultrawide sources without cropping or stretching', () => {
  for (const source of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 3440, height: 1440 }]) {
    const frame = fitLiveFrame({ width: 960, height: 600 }, source, 4)!
    expect(frame.width).toBeLessThanOrEqual(960)
    expect(frame.height).toBeLessThanOrEqual(600)
    expect((frame.width - 4) / (frame.height - 4)).toBeCloseTo(source.width / source.height)
  }
})

it('preserves the source aspect in a width-controlled floating live', () => {
  expect(fitLiveFrame({ width: 320, height: Infinity }, { width: 1920, height: 1200 })).toEqual({ width: 320, height: 200 })
  expect(fitLiveFrame({ width: 0, height: 0 }, { width: 1920, height: 1200 })).toBeUndefined()
})

it('keeps every corner inside the compact 128x96 live tile', () => {
  const wide = fitLiveFrame({ width: 128, height: 96 }, { width: 1920, height: 1200 }, 4)!
  const portrait = fitLiveFrame({ width: 128, height: 96 }, { width: 1080, height: 1920 }, 4)!
  expect(wide.width).toBe(128)
  expect(wide.height).toBeCloseTo(81.5)
  expect(portrait.width).toBeCloseTo(55.75)
  expect(portrait.height).toBe(96)
})
