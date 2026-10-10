/**
 * What size of a live one viewer gets.
 *
 * In the mesh every viewer has its own connection and its own encoder, so a
 * live does not have to be one stream for everybody: whoever watches it in the
 * 320x160 mini player was getting the same 1080p as whoever has it full screen.
 * The viewer says how tall the picture is on its screen and the sender picks,
 * for that viewer alone, the smallest layer that is still above it.
 */

export interface LayerCaps {
  maxBitrate: number
  maxFramerate: number
}

export interface LiveLayer {
  /** RTCRtpEncodingParameters.scaleResolutionDownBy */
  scale: number
  maxBitrate: number
  maxFramerate: number
}

export type PictureFit = 'contain' | 'cover'

/** Heights are reported in steps, so a small resize says nothing new. */
export const VIEW_HEIGHT_STEP = 30
export const MAX_VIEW_HEIGHT = 4320

/** The reductions a live is sent at, smallest first. */
export const LAYER_SCALES = [1, 1.5, 2, 3, 4, 6]

/** A layer has at least this many times the lines the viewer shows. */
const VIEW_MARGIN = 1.1

const MIN_LAYER_BITRATE = 250_000

/** A viewer whose window shows nothing (minimized, in the tray) still gets a picture, a small and slow one. */
const HIDDEN_LAYER_HEIGHT = 180
export const HIDDEN_LAYER_FRAMERATE = 15
const HIDDEN_LAYER_BITRATE_SHARE = 0.5
const MIN_HIDDEN_BITRATE = 150_000

const DEFAULT_ASPECT = 16 / 9

/** Height the picture of a stream takes in a box, in the units of the box. */
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

/** What a viewer reports for a picture that many device pixels tall. */
export function viewHeightStep(devicePixels: number): number {
  if (!(devicePixels > 0)) return 0
  // The height often comes out of a division: 180.00000000000003 is 180.
  const steps = Math.ceil((devicePixels - 0.01) / VIEW_HEIGHT_STEP)
  return Math.min(MAX_VIEW_HEIGHT, Math.max(1, steps) * VIEW_HEIGHT_STEP)
}

const roundBitrate = (bps: number) => Math.round(bps / 1000) * 1000

/**
 * Bitrate goes with the height to the power 1.5. That is the table the app
 * already uses for a live (1080p60 5.5 Mbps, 720p60 3.0, 480p60 1.5), so a
 * smaller layer has more bits per pixel than the full one, never fewer.
 */
const scaledBitrate = (caps: LayerCaps, scale: number) => caps.maxBitrate * Math.pow(scale, -1.5)

/** The largest reduction that still leaves `lines` lines. */
function scaleFor(sourceHeight: number, lines: number): number {
  let scale = 1
  for (const candidate of LAYER_SCALES) {
    if (sourceHeight / candidate >= lines) scale = candidate
  }
  return scale
}

/**
 * The layer for one viewer.
 *
 * `need` is what the viewer reported: null when it said nothing about its
 * size (it gets everything), 0 when it is watching with nothing on screen,
 * otherwise the height of the picture in device pixels.
 */
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
