export interface LayerCaps {
  maxBitrate: number
  maxFramerate: number
}

export interface LiveLayer {
  scale: number
  maxBitrate: number
  maxFramerate: number
}

export type PictureFit = 'contain' | 'cover'

export const VIEW_HEIGHT_STEP = 30
export const MAX_VIEW_HEIGHT = 4320

export const LAYER_SCALES = [1, 1.5, 2, 3, 4, 6]

const VIEW_MARGIN = 1.1

const MIN_LAYER_BITRATE = 250_000

const HIDDEN_LAYER_HEIGHT = 180
export const HIDDEN_LAYER_FRAMERATE = 15
const HIDDEN_LAYER_BITRATE_SHARE = 0.5
const MIN_HIDDEN_BITRATE = 150_000

const DEFAULT_ASPECT = 16 / 9

export function pictureHeight(
  box: { width: number; height: number },
  aspect: number | null | undefined,
  fit: PictureFit
): number {
  if (!(box.width > 0) || !(box.height > 0)) return 0
  const ratio = typeof aspect === 'number' && aspect > 0 ? aspect : DEFAULT_ASPECT
  const byWidth = box.width / ratio
  return fit === 'cover' ? Math.max(box.height, byWidth) : Math.min(box.height, byWidth)
}

export function viewHeightStep(devicePixels: number): number {
  if (!(devicePixels > 0)) return 0
  const steps = Math.ceil((devicePixels - 0.01) / VIEW_HEIGHT_STEP)
  return Math.min(MAX_VIEW_HEIGHT, Math.max(1, steps) * VIEW_HEIGHT_STEP)
}

const roundBitrate = (bps: number) => Math.round(bps / 1000) * 1000

const scaledBitrate = (caps: LayerCaps, scale: number) => caps.maxBitrate * Math.pow(scale, -1.5)

function scaleFor(sourceHeight: number, lines: number): number {
  let scale = 1
  for (const candidate of LAYER_SCALES) {
    if (sourceHeight / candidate >= lines) scale = candidate
  }
  return scale
}

export function layerFor(caps: LayerCaps, sourceHeight: number | null | undefined, need: number | null): LiveLayer {
  const full: LiveLayer = { scale: 1, maxBitrate: caps.maxBitrate, maxFramerate: caps.maxFramerate }
  if (need === null || !(typeof sourceHeight === 'number' && sourceHeight > 0)) return full

  if (!(need > 0)) {
    const scale = scaleFor(sourceHeight, HIDDEN_LAYER_HEIGHT)
    const bitrate = roundBitrate(scaledBitrate(caps, scale) * HIDDEN_LAYER_BITRATE_SHARE)
    return {
      scale,
      maxBitrate: Math.min(caps.maxBitrate, Math.max(MIN_HIDDEN_BITRATE, bitrate)),
      maxFramerate: Math.min(caps.maxFramerate, HIDDEN_LAYER_FRAMERATE),
    }
  }

  const scale = scaleFor(sourceHeight, need * VIEW_MARGIN)
  if (scale === 1) return full
  return {
    scale,
    maxBitrate: Math.min(caps.maxBitrate, Math.max(MIN_LAYER_BITRATE, roundBitrate(scaledBitrate(caps, scale)))),
    maxFramerate: caps.maxFramerate,
  }
}
