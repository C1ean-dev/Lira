/**
 * Hardware Codec Optimization for WebRTC
 * Supports toggling between Hardware Acceleration (H.264 NVENC/AMF/QuickSync)
 * and Software Encoding (VP8 libvpx on CPU).
 */

const STORAGE_HW_KEY = 'gather_hw_acceleration_enabled'

let hwAccelerationActive = (() => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(STORAGE_HW_KEY)
      if (stored !== null) return stored === 'true'
    }
  } catch {}
  return true // Default: GPU hardware acceleration enabled
})()

export function isHardwareAccelerationEnabled(): boolean {
  return hwAccelerationActive
}

export function setHardwareAccelerationEnabled(enabled: boolean) {
  hwAccelerationActive = enabled
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_HW_KEY, String(enabled))
      window.dispatchEvent(new CustomEvent('gather:hw-acceleration-changed', { detail: { enabled } }))
    }
  } catch {}
  console.info(`[HardwareCodec] Hardware acceleration: ${enabled ? 'ENABLED (GPU / H.264)' : 'DISABLED (CPU / VP8)'}`)
}

export function prioritizeH264HardwareCodec(pc?: RTCPeerConnection | null, forceH264?: boolean) {
  if (!pc || typeof pc.getTransceivers !== 'function') return

  const globalScope = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null
  if (!globalScope) return

  const rtcReceiver = (globalScope as any).RTCRtpReceiver || (globalScope as any).RTCRtpSender
  if (!rtcReceiver || typeof rtcReceiver.getCapabilities !== 'function') return

  try {
    const capabilities = rtcReceiver.getCapabilities('video')
    if (!capabilities || !capabilities.codecs || capabilities.codecs.length === 0) return

    const useHw = forceH264 !== undefined ? forceH264 : hwAccelerationActive
    let sortedCodecs: any[]

    if (useHw) {
      // Find H.264 codecs in receiver capabilities
      const h264Codecs = capabilities.codecs.filter(
        (c: any) => c.mimeType && c.mimeType.toLowerCase() === 'video/h264'
      )
      if (h264Codecs.length === 0) return

      // Prioritize packetization-mode=1 (required by Windows MediaFoundation for NVENC/AMF/QuickSync hardware offload)
      const h264Mode1 = h264Codecs.filter(
        (c: any) => c.sdpFmtpLine && c.sdpFmtpLine.includes('packetization-mode=1')
      )
      const h264Other = h264Codecs.filter(
        (c: any) => !c.sdpFmtpLine || !c.sdpFmtpLine.includes('packetization-mode=1')
      )

      const otherCodecs = capabilities.codecs.filter(
        (c: any) => !c.mimeType || c.mimeType.toLowerCase() !== 'video/h264'
      )

      // Sorted list: H.264 mode 1 first, then other H.264, then VP8/VP9/AV1
      sortedCodecs = [...h264Mode1, ...h264Other, ...otherCodecs]
    } else {
      // Software mode: prioritize VP8/VP9 on CPU
      const vp8Codecs = capabilities.codecs.filter(
        (c: any) => c.mimeType && c.mimeType.toLowerCase() === 'video/vp8'
      )
      const vp9Codecs = capabilities.codecs.filter(
        (c: any) => c.mimeType && c.mimeType.toLowerCase() === 'video/vp9'
      )
      const otherCodecs = capabilities.codecs.filter(
        (c: any) => !c.mimeType || (!c.mimeType.toLowerCase().includes('vp8') && !c.mimeType.toLowerCase().includes('vp9'))
      )

      sortedCodecs = [...vp8Codecs, ...vp9Codecs, ...otherCodecs]
    }

    pc.getTransceivers().forEach((transceiver) => {
      // CRITICAL: NEVER apply video codecs to audio transceivers!
      const isVideo =
        transceiver.receiver?.track?.kind === 'video' ||
        transceiver.sender?.track?.kind === 'video' ||
        (transceiver as any).kind === 'video'

      if (!isVideo) return

      if (typeof transceiver.setCodecPreferences === 'function') {
        try {
          transceiver.setCodecPreferences(sortedCodecs)
        } catch {
          // Safe to ignore if transceiver has already locked negotiation
        }
      }
    })
  } catch (err) {
    console.warn('[HardwareCodec] Error setting codec preference:', err)
  }
}

/**
 * Reorders the video payload types in the SDP m=video line so that H.264 payloads appear first.
 */
export function prioritizeH264InSdp(sdp: string): string {
  if (!sdp || !sdp.includes('m=video')) return sdp

  try {
    const lines = sdp.split(/\r\n|\n/)
    const h264Payloads: string[] = []
    const h264Mode1Payloads: string[] = []

    for (const line of lines) {
      const rtpMatch = line.match(/^a=rtpmap:(\d+)\s+H264\/90000/i)
      if (rtpMatch) {
        h264Payloads.push(rtpMatch[1])
      }
    }

    if (h264Payloads.length === 0) return sdp

    for (const pt of h264Payloads) {
      const fmtpMatch = lines.some((line) => {
        const regex = new RegExp(`^a=fmtp:${pt}\\s+[^\\r\\n]*packetization-mode=1`, 'i')
        return regex.test(line)
      })
      if (fmtpMatch) {
        h264Mode1Payloads.push(pt)
      }
    }

    const preferredH264 = [
      ...h264Mode1Payloads,
      ...h264Payloads.filter((pt) => !h264Mode1Payloads.includes(pt)),
    ]

    return sdp.replace(
      /(m=video\s+\d+\s+[^\r\n\s]+\s+)([0-9\s]+?)(?=\r?\n|$)/i,
      (_all, prefix, payloadStr) => {
        const existingPayloads = payloadStr.trim().split(/\s+/)
        const remaining = existingPayloads.filter((pt: string) => !preferredH264.includes(pt))
        const reordered = [...preferredH264, ...remaining].join(' ')
        return `${prefix}${reordered}`
      }
    )
  } catch (err) {
    console.warn('[HardwareCodec] Error munging SDP for H.264:', err)
    return sdp
  }
}

/**
 * Reorders the video payload types in the SDP m=video line so that VP8 payloads appear first (software mode).
 */
export function prioritizeVP8InSdp(sdp: string): string {
  if (!sdp || !sdp.includes('m=video')) return sdp

  try {
    const lines = sdp.split(/\r\n|\n/)
    const vp8Payloads: string[] = []

    for (const line of lines) {
      const rtpMatch = line.match(/^a=rtpmap:(\d+)\s+VP8\/90000/i)
      if (rtpMatch) {
        vp8Payloads.push(rtpMatch[1])
      }
    }

    if (vp8Payloads.length === 0) return sdp

    return sdp.replace(
      /(m=video\s+\d+\s+[^\r\n\s]+\s+)([0-9\s]+?)(?=\r?\n|$)/i,
      (_all, prefix, payloadStr) => {
        const existingPayloads = payloadStr.trim().split(/\s+/)
        const remaining = existingPayloads.filter((pt: string) => !vp8Payloads.includes(pt))
        const reordered = [...vp8Payloads, ...remaining].join(' ')
        return `${prefix}${reordered}`
      }
    )
  } catch (err) {
    return sdp
  }
}

export function prioritizeCodecInSdp(sdp: string, forceH264?: boolean): string {
  const useHw = forceH264 !== undefined ? forceH264 : hwAccelerationActive
  return useHw ? prioritizeH264InSdp(sdp) : prioritizeVP8InSdp(sdp)
}

/**
 * RTCPeerConnection codec configuration helper.
 * Per W3C WebRTC 1.0, codec preferences are set directly via transceiver.setCodecPreferences()
 * on peer connections (handled by prioritizeH264HardwareCodec).
 */
export function installHardwareCodecInterceptor() {
  // Maintained for backward compatibility. Direct transceiver preferences are used instead of prototype patching.
}
