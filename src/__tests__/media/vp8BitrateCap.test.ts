import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import {
  beginScreenShare,
  endScreenShare,
  noteViewRequest,
  screenCaps,
  setPeerNegotiatedCodec,
  viewerSend,
  applyVideoCaps,
  SCREEN_MAX_BITRATE,
  VP8_SCREEN_MAX_BITRATE,
  SCREEN_DEFAULT_MIN_BITRATE,
} from '../../p2p/videoSendPolicy'
import { setHardwareAccelerationEnabled } from '../../media/hardwareCodec'

describe('VP8 Software Encoder Bitrate Ceiling', () => {
  beforeEach(() => {
    endScreenShare()
    setHardwareAccelerationEnabled(true)
  })

  it('clamps screenCaps to VP8_SCREEN_MAX_BITRATE (10 Mbps) when isH264 is false', () => {
    expect(SCREEN_MAX_BITRATE).toBe(15_000_000)
    expect(VP8_SCREEN_MAX_BITRATE).toBe(10_000_000)

    const hwCaps = screenCaps(15_000_000, 60, true)
    expect(hwCaps.maxBitrate).toBe(15_000_000)

    const swCaps = screenCaps(15_000_000, 60, false)
    expect(swCaps.maxBitrate).toBe(10_000_000)
  })

  it('clamps screenCaps to VP8_SCREEN_MAX_BITRATE when hardware acceleration is globally disabled', () => {
    setHardwareAccelerationEnabled(false)
    const caps = screenCaps(15_000_000, 60)
    expect(caps.maxBitrate).toBe(10_000_000)
  })

  it('dynamically throttles peer bitrate when peer connection is negotiated on VP8 to protect CPU from choking', () => {
    beginScreenShare(screenCaps(15_000_000, 60, true))
    noteViewRequest('viewer-1', true, 1080)

    // Before codec is known (or default H264), full 15 Mbps
    expect(viewerSend('viewer-1').kbps).toBe(15000)

    // Negotiated on VP8: clamps to 10000 kbps (10 Mbps)
    setPeerNegotiatedCodec('viewer-1', 'video/VP8')
    expect(viewerSend('viewer-1').kbps).toBe(10000)

    // Negotiated on H264: restores full 15000 kbps
    setPeerNegotiatedCodec('viewer-1', 'video/H264')
    expect(viewerSend('viewer-1').kbps).toBe(15000)
  })

  it('configures minBitrate in screenCaps and applies it to RTCRtpEncodingParameters', () => {
    const caps = screenCaps(15_000_000, 60)
    expect(caps.minBitrate).toBe(SCREEN_DEFAULT_MIN_BITRATE)
    expect(SCREEN_DEFAULT_MIN_BITRATE).toBe(2_500_000)

    const setParametersMock = vi.fn().mockResolvedValue(undefined)
    const mockSender = {
      getParameters: () => ({
        encodings: [
          { active: true, maxBitrate: 1000 },
        ],
      }),
      setParameters: setParametersMock,
    } as unknown as RTCRtpSender

    applyVideoCaps(mockSender, caps, 'maintain-resolution')
    expect(setParametersMock).toHaveBeenCalledTimes(1)
    const passedParams = setParametersMock.mock.calls[0][0]
    expect(passedParams.encodings[0].minBitrate).toBe(2_500_000)
    expect(passedParams.encodings[0].networkPriority).toBe('high')
  })
})
