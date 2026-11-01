
const STORAGE_HW_KEY = 'lira_hw_acceleration_enabled'

let hwAccelerationActive = (() => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(STORAGE_HW_KEY)
      if (stored !== null) return stored === 'true'
    }
  } catch {}
  return true
})()

export function isHardwareAccelerationEnabled(): boolean {
  return hwAccelerationActive
}

export function setHardwareAccelerationEnabled(enabled: boolean) {
  hwAccelerationActive = enabled
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_HW_KEY, String(enabled))
      window.dispatchEvent(new CustomEvent('lira:hw-acceleration-changed', { detail: { enabled } }))
    }
  } catch {}
  console.info(`[HardwareCodec] Hardware acceleration: ${enabled ? 'ENABLED (GPU / H.264)' : 'DISABLED (CPU / VP8)'}`)
}

export function getH264ProfileScore(fmtpLine?: string): number {
  if (!fmtpLine) return 0
  const lower = fmtpLine.toLowerCase()
  const isMode1 = lower.includes('packetization-mode=1')
  const base = isMode1 ? 100 : 0
  if (lower.includes('profile-level-id=6400')) return base + 50 // High Profile (Level 5.0/4.2 with CABAC)
  if (lower.includes('profile-level-id=4d00')) return base + 40 // Main Profile
  if (lower.includes('profile-level-id=42e0')) return base + 30 // Constrained Baseline
  if (lower.includes('profile-level-id=4200')) return base + 20 // Baseline
  return base + 10
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
      const h264Codecs = capabilities.codecs.filter(
        (c: any) => c.mimeType && c.mimeType.toLowerCase() === 'video/h264'
      )
      if (h264Codecs.length === 0) return

      const sortedH264 = [...h264Codecs].sort((a: any, b: any) => {
        return getH264ProfileScore(b.sdpFmtpLine) - getH264ProfileScore(a.sdpFmtpLine)
      })

      const otherCodecs = capabilities.codecs.filter(
        (c: any) => !c.mimeType || c.mimeType.toLowerCase() !== 'video/h264'
      )

      sortedCodecs = [...sortedH264, ...otherCodecs]
    } else {
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
      const isVideo =
        transceiver.receiver?.track?.kind === 'video' ||
        transceiver.sender?.track?.kind === 'video' ||
        (transceiver as any).kind === 'video'

      if (!isVideo) return

      if (typeof transceiver.setCodecPreferences === 'function') {
        try {
          transceiver.setCodecPreferences(sortedCodecs)
        } catch {
        }
      }
    })
  } catch (err) {
    console.warn('[HardwareCodec] Error setting codec preference:', err)
  }
}

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

    const ptFmtpMap = new Map<string, string>()
    for (const line of lines) {
      const match = line.match(/^a=fmtp:(\d+)\s+(.+)$/i)
      if (match) {
        ptFmtpMap.set(match[1], match[2])
      }
    }

    const preferredH264 = [...h264Payloads].sort((a, b) => {
      return getH264ProfileScore(ptFmtpMap.get(b)) - getH264ProfileScore(ptFmtpMap.get(a))
    })

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

export function installHardwareCodecInterceptor() {
}
