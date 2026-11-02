
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

export const DEFAULT_PLI_THROTTLE_MS = 1200

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

    const h264Codecs = capabilities.codecs.filter(
      (c: any) => c.mimeType && c.mimeType.toLowerCase() === 'video/h264'
    )
    const av1Codecs = capabilities.codecs.filter(
      (c: any) => c.mimeType && c.mimeType.toLowerCase() === 'video/av1'
    )
    const vp9Codecs = capabilities.codecs.filter(
      (c: any) => c.mimeType && c.mimeType.toLowerCase() === 'video/vp9'
    )
    const vp8Codecs = capabilities.codecs.filter(
      (c: any) => c.mimeType && c.mimeType.toLowerCase() === 'video/vp8'
    )
    const knownMimes = new Set(['video/h264', 'video/av1', 'video/vp9', 'video/vp8'])
    const otherCodecs = capabilities.codecs.filter(
      (c: any) => !c.mimeType || !knownMimes.has(c.mimeType.toLowerCase())
    )

    const sortedH264 = [...h264Codecs].sort((a: any, b: any) => {
      return getH264ProfileScore(b.sdpFmtpLine) - getH264ProfileScore(a.sdpFmtpLine)
    })

    if (useHw) {
      sortedCodecs = [...sortedH264, ...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...otherCodecs]
    } else {
      sortedCodecs = [...av1Codecs, ...vp9Codecs, ...vp8Codecs, ...sortedH264, ...otherCodecs]
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

export function reorderVideoCodecsInSdp(sdp: string, codecPreferenceOrder: string[], trrIntMs: number = DEFAULT_PLI_THROTTLE_MS): string {
  if (!sdp || !sdp.includes('m=video')) return sdp

  try {
    const isCrlf = sdp.includes('\r\n')
    const sep = isCrlf ? '\r\n' : '\n'
    const lines = sdp.split(/\r\n|\n/)

    const videoLineIdx = lines.findIndex((l) => l.startsWith('m=video'))
    if (videoLineIdx === -1) return sdp

    const vParts = lines[videoLineIdx].trim().split(/\s+/)
    const videoPts = vParts.slice(3)
    const videoPtSet = new Set(videoPts)

    const ptMimeMap = new Map<string, string>()
    const ptFmtpMap = new Map<string, string>()
    const aptMap = new Map<string, string>()

    for (const line of lines) {
      const rtpMatch = line.match(/^a=rtpmap:(\d+)\s+([A-Za-z0-9_-]+)\//i)
      if (rtpMatch) {
        ptMimeMap.set(rtpMatch[1], rtpMatch[2].toUpperCase())
      }
      const fmtpMatch = line.match(/^a=fmtp:(\d+)\s+(.+)$/i)
      if (fmtpMatch) {
        ptFmtpMap.set(fmtpMatch[1], fmtpMatch[2])
        const aptMatch = fmtpMatch[2].match(/apt=(\d+)/i)
        if (aptMatch) {
          aptMap.set(fmtpMatch[1], aptMatch[1])
        }
      }
    }

    const orderedPts: string[] = []
    const seen = new Set<string>()

    for (const codec of codecPreferenceOrder) {
      const matchingPts = videoPts.filter((pt) => ptMimeMap.get(pt) === codec)
      if (codec === 'H264') {
        matchingPts.sort((a, b) => getH264ProfileScore(ptFmtpMap.get(b)) - getH264ProfileScore(ptFmtpMap.get(a)))
      }
      for (const pt of matchingPts) {
        if (!seen.has(pt)) {
          orderedPts.push(pt)
          seen.add(pt)
        }
        for (const [rtxPt, primaryPt] of aptMap.entries()) {
          if (primaryPt === pt && !seen.has(rtxPt) && videoPtSet.has(rtxPt)) {
            orderedPts.push(rtxPt)
            seen.add(rtxPt)
          }
        }
      }
    }

    for (const pt of videoPts) {
      if (!seen.has(pt)) {
        orderedPts.push(pt)
        seen.add(pt)
      }
    }

    lines[videoLineIdx] = vParts.slice(0, 3).join(' ') + ' ' + orderedPts.join(' ')

    // Inject/throttle RTCP-FB trr-int for video payload types
    if (trrIntMs > 0) {
      const fbPtsWithTrr = new Set<string>()
      for (const l of lines) {
        const trrMatch = l.match(/^a=rtcp-fb:(\d+)\s+trr-int\b/i)
        if (trrMatch) {
          fbPtsWithTrr.add(trrMatch[1])
        }
      }

      const updatedLines: string[] = []
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const trrMatch = line.match(/^a=rtcp-fb:(\d+)\s+trr-int\s+(\d+)/i)
        if (trrMatch) {
          updatedLines.push('a=rtcp-fb:' + trrMatch[1] + ' trr-int ' + trrIntMs)
          continue
        }

        updatedLines.push(line)

        const fbMatch = line.match(/^a=rtcp-fb:(\d+)\s+/i)
        if (fbMatch) {
          const pt = fbMatch[1]
          if (videoPtSet.has(pt) && !fbPtsWithTrr.has(pt)) {
            const nextLine = lines[i + 1]
            const nextIsSamePtFb = nextLine && nextLine.toLowerCase().startsWith('a=rtcp-fb:' + pt.toLowerCase())
            if (!nextIsSamePtFb) {
              updatedLines.push('a=rtcp-fb:' + pt + ' trr-int ' + trrIntMs)
              fbPtsWithTrr.add(pt)
            }
          }
        }
      }
      return updatedLines.join(sep)
    }

    return lines.join(sep)
  } catch (err) {
    console.warn('[HardwareCodec] Error reordering codecs in SDP:', err)
    return sdp
  }
}

export function prioritizeH264InSdp(sdp: string): string {
  return reorderVideoCodecsInSdp(sdp, ['H264', 'AV1', 'VP9', 'VP8'])
}

export function prioritizeVP8InSdp(sdp: string): string {
  return reorderVideoCodecsInSdp(sdp, ['AV1', 'VP9', 'VP8', 'H264'])
}

export function prioritizeCodecInSdp(sdp: string, forceH264?: boolean): string {
  const useHw = forceH264 !== undefined ? forceH264 : hwAccelerationActive
  return useHw ? prioritizeH264InSdp(sdp) : prioritizeVP8InSdp(sdp)
}

export function installHardwareCodecInterceptor() {
}

export function isConnectionSendingH264(pc?: RTCPeerConnection | null): boolean | null {
  if (!pc) return null
  try {
    const sdp = pc.currentLocalDescription?.sdp || pc.localDescription?.sdp
    if (!sdp || !sdp.includes('m=video')) return null
    const videoLine = sdp.split(/\r\n|\n/).find((l) => l.startsWith('m=video'))
    if (!videoLine) return null
    const parts = videoLine.trim().split(/\s+/)
    if (parts.length < 4) return null
    const firstPayload = parts[3]
    const lines = sdp.split(/\r\n|\n/)
    const prefix = 'a=rtpmap:' + firstPayload + ' '
    const rtpmap = lines.find((l) => l.startsWith(prefix))
    if (rtpmap) {
      return rtpmap.toUpperCase().includes('H264')
    }
  } catch {}
  return null
}
