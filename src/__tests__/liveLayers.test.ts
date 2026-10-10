import { describe, it, expect } from 'vitest'
import {
  HIDDEN_LAYER_FRAMERATE,
  LAYER_SCALES,
  MAX_VIEW_HEIGHT,
  VIEW_HEIGHT_STEP,
  layerFor,
  pictureHeight,
  viewHeightStep,
} from '../p2p/liveLayers'

const caps = { maxBitrate: 5_500_000, maxFramerate: 60 }
const WIDE = 16 / 9

describe('pictureHeight', () => {
  it('is the height of the picture inside a box that shows all of it', () => {
    // Mini player: 320x160. A 16:9 picture is limited by the height.
    expect(pictureHeight({ width: 320, height: 160 }, WIDE, 'contain')).toBe(160)
    // Mini tile: 128x96. Limited by the width.
    expect(pictureHeight({ width: 128, height: 96 }, WIDE, 'contain')).toBeCloseTo(72, 6)
    // Grid stage in a 1280x800 window.
    expect(pictureHeight({ width: 1068, height: 630 }, WIDE, 'contain')).toBeCloseTo(600.75, 6)
  })

  it('is the height the picture needs to fill a box that crops it', () => {
    expect(pictureHeight({ width: 176, height: 99 }, WIDE, 'cover')).toBeCloseTo(99, 6)
    // A tall box: the picture is as tall as the box, its sides are cropped.
    expect(pictureHeight({ width: 100, height: 200 }, WIDE, 'cover')).toBe(200)
    // A flat box: the picture is as wide as the box, so taller than it.
    expect(pictureHeight({ width: 320, height: 90 }, WIDE, 'cover')).toBeCloseTo(180, 6)
  })

  it('follows the shape of the stream, a window that is not 16:9 included', () => {
    // A tall window (800x1000) shown in the mini player.
    expect(pictureHeight({ width: 320, height: 160 }, 0.8, 'contain')).toBe(160)
    // A very wide one (2:1) in the same box.
    expect(pictureHeight({ width: 320, height: 200 }, 2, 'contain')).toBe(160)
  })

  it('assumes 16:9 while the shape of the stream is not known', () => {
    expect(pictureHeight({ width: 128, height: 96 }, null, 'contain')).toBeCloseTo(72, 6)
    expect(pictureHeight({ width: 128, height: 96 }, 0, 'contain')).toBeCloseTo(72, 6)
    expect(pictureHeight({ width: 128, height: 96 }, Number.NaN, 'contain')).toBeCloseTo(72, 6)
    expect(pictureHeight({ width: 128, height: 96 }, -2, 'contain')).toBeCloseTo(72, 6)
  })

  it('is zero for a box that shows nothing', () => {
    expect(pictureHeight({ width: 0, height: 160 }, WIDE, 'contain')).toBe(0)
    expect(pictureHeight({ width: 320, height: 0 }, WIDE, 'cover')).toBe(0)
    expect(pictureHeight({ width: -5, height: -5 }, WIDE, 'contain')).toBe(0)
  })
})

describe('viewHeightStep', () => {
  it('rounds up to the next step, so a small resize says nothing new', () => {
    expect(VIEW_HEIGHT_STEP).toBe(30)
    expect(viewHeightStep(160)).toBe(180)
    expect(viewHeightStep(180)).toBe(180)
    expect(viewHeightStep(181)).toBe(210)
    expect(viewHeightStep(600.4)).toBe(630)
    expect(viewHeightStep(1)).toBe(30)
  })

  it('does not jump a step over the rounding noise of a division', () => {
    expect(viewHeightStep(180.00000000000003)).toBe(180)
    expect(viewHeightStep(180.02)).toBe(210)
  })

  it('is zero for nothing shown and never passes the largest height', () => {
    expect(viewHeightStep(0)).toBe(0)
    expect(viewHeightStep(-10)).toBe(0)
    expect(viewHeightStep(Number.NaN)).toBe(0)
    expect(viewHeightStep(99999)).toBe(MAX_VIEW_HEIGHT)
  })
})

describe('layerFor', () => {
  it('sends everything when the viewer said nothing about its size', () => {
    expect(layerFor(caps, 1080, null)).toEqual({ scale: 1, maxBitrate: 5_500_000, maxFramerate: 60 })
  })

  it('sends everything when the height of the capture is not known', () => {
    expect(layerFor(caps, null, 180)).toEqual({ scale: 1, maxBitrate: 5_500_000, maxFramerate: 60 })
    expect(layerFor(caps, 0, 180)).toEqual({ scale: 1, maxBitrate: 5_500_000, maxFramerate: 60 })
    expect(layerFor(caps, Number.NaN, 0)).toEqual({ scale: 1, maxBitrate: 5_500_000, maxFramerate: 60 })
  })

  it('picks the smallest layer that is still at least 10% above what is shown', () => {
    // Mini player on a 100% screen: 160 px shown, reported as 180.
    expect(layerFor(caps, 1080, 180).scale).toBe(4) // 270p
    // Mini tile alone: 72 px shown, reported as 90.
    expect(layerFor(caps, 1080, 90).scale).toBe(6) // 180p
    // Grid in a 1280x800 window: 601 px shown, reported as 630.
    expect(layerFor(caps, 1080, 630).scale).toBe(1.5) // 720p
    // Grid in a maximized window on a 1080p monitor.
    expect(layerFor(caps, 1080, 870).scale).toBe(1)
    expect(layerFor(caps, 1080, 1080).scale).toBe(1)
    // Larger than the capture: there is nothing more to send.
    expect(layerFor(caps, 1080, 2160).scale).toBe(1)
  })

  it('never sends fewer lines than the viewer shows, plus the margin', () => {
    for (const source of [1080, 1048, 1030, 720, 586, 480]) {
      for (let need = 30; need <= 2160; need += 30) {
        const { scale } = layerFor(caps, source, need)
        expect(LAYER_SCALES).toContain(scale)
        if (scale > 1) expect(source / scale).toBeGreaterThanOrEqual(need * 1.1)
      }
    }
  })

  it('uses the largest reduction the margin allows', () => {
    // 1080 / 6 = 180 is exactly 10% above 163.6: 150 fits, 180 does not.
    expect(layerFor(caps, 1080, 150).scale).toBe(6)
    expect(layerFor(caps, 1080, 180).scale).toBe(4)
    // 1080 / 4 = 270: 240 fits (264), 270 does not (297).
    expect(layerFor(caps, 1080, 240).scale).toBe(4)
    expect(layerFor(caps, 1080, 270).scale).toBe(3)
  })

  it('gives each layer the bitrate of the table the app already uses', () => {
    // 1080p60 5.5 Mbps -> 720p60 3.0 Mbps, as in resolveOptimalScreenQuality.
    expect(layerFor(caps, 1080, 630).maxBitrate).toBe(2_994_000)
    expect(layerFor(caps, 1080, 420).maxBitrate).toBe(1_945_000) // 540p
    expect(layerFor(caps, 1080, 300).maxBitrate).toBe(1_058_000) // 360p
    expect(layerFor(caps, 1080, 180).maxBitrate).toBe(688_000) // 270p
    expect(layerFor(caps, 1080, 90).maxBitrate).toBe(374_000) // 180p
    // 1080p30 3.5 Mbps -> 720p30 about 1.9 Mbps (the table says 2.0).
    expect(layerFor({ maxBitrate: 3_500_000, maxFramerate: 30 }, 1080, 630).maxBitrate).toBe(1_905_000)
  })

  it('keeps the frame rate of the live', () => {
    expect(layerFor(caps, 1080, 180).maxFramerate).toBe(60)
    expect(layerFor({ maxBitrate: 3_500_000, maxFramerate: 30 }, 1080, 180).maxFramerate).toBe(30)
  })

  it('does not go under 250 kbps, nor over the bitrate of the live', () => {
    expect(layerFor({ maxBitrate: 1_000_000, maxFramerate: 30 }, 1080, 90)).toEqual({
      scale: 6,
      maxBitrate: 250_000,
      maxFramerate: 30,
    })
    expect(layerFor({ maxBitrate: 200_000, maxFramerate: 30 }, 1080, 90).maxBitrate).toBe(200_000)
  })

  it('follows the height of the capture, a window included', () => {
    // A 1920x1030 window: 1030 / 4 = 257 >= 198, 1030 / 6 = 171 is not.
    expect(layerFor(caps, 1030, 180).scale).toBe(4)
    // A 720p capture: 720 / 3 = 240 >= 198.
    expect(layerFor({ maxBitrate: 3_000_000, maxFramerate: 60 }, 720, 180)).toEqual({
      scale: 3,
      maxBitrate: 577_000,
      maxFramerate: 60,
    })
    // A small window that is already below what the viewer shows.
    expect(layerFor(caps, 586, 630).scale).toBe(1)
  })

  describe('a viewer whose window shows nothing', () => {
    it('gets about 180 lines at 15 fps and half the bitrate of that layer', () => {
      expect(HIDDEN_LAYER_FRAMERATE).toBe(15)
      expect(layerFor(caps, 1080, 0)).toEqual({ scale: 6, maxBitrate: 187_000, maxFramerate: 15 })
      expect(layerFor(caps, 720, 0).scale).toBe(4) // 180p
      expect(layerFor(caps, 586, 0).scale).toBe(3) // 195p
    })

    it('does not raise the frame rate of a slow live', () => {
      expect(layerFor({ maxBitrate: 1_000_000, maxFramerate: 10 }, 1080, 0).maxFramerate).toBe(10)
    })

    it('does not go under 150 kbps, nor over the bitrate of the live', () => {
      expect(layerFor({ maxBitrate: 1_000_000, maxFramerate: 30 }, 1080, 0).maxBitrate).toBe(150_000)
      expect(layerFor({ maxBitrate: 100_000, maxFramerate: 30 }, 1080, 0).maxBitrate).toBe(100_000)
    })

    it('leaves a capture that is already tiny at its size', () => {
      expect(layerFor(caps, 170, 0)).toEqual({ scale: 1, maxBitrate: 2_750_000, maxFramerate: 15 })
    })
  })
})
