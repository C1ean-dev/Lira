export interface TransmissionStats {
  id: string
  peerId: string
  width: number | null
  height: number | null
  fps: number | null
  bitrateKbps: number | null
  bytes: number | null
  bufferMs: number | null
  bufferKind: 'send' | 'playback'
  jitterMs: number | null
  rttMs: number | null
  lossPct: number | null
  droppedFrames: number | null
  codec: string | null
  limitation: string | null
}

type Report = Record<string, any>
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const delta = (current: unknown, previous: unknown): number | null => {
  const a = number(current), b = number(previous)
  return a !== null && b !== null && a >= b ? a - b : null
}
const milliseconds = (seconds: unknown) => number(seconds) === null ? null : (seconds as number) * 1000

// Counters are scoped to the connection and RTP report ID. Reconnection and
// counter resets must not turn into negative rates or another viewer's bitrate.
export function createTransmissionSampler() {
  const previous = new WeakMap<RTCPeerConnection, Map<string, Report>>()
  return async (
    calls: Map<string, { peerConnection?: RTCPeerConnection }>,
    stream: MediaStream | null,
    local: boolean,
  ): Promise<TransmissionStats[]> => {
    const trackIds = new Set(stream?.getVideoTracks().filter(track => track.readyState !== 'ended').map(track => track.id))
    if (!trackIds.size) return []
    const results = await Promise.allSettled([...calls].map(async ([peerId, call]) => {
      const pc = call.peerConnection
      if (!pc || pc.connectionState === 'closed') return []
      const endpoints = local ? pc.getSenders() : pc.getReceivers()
      const track = endpoints.find(endpoint => endpoint.track && trackIds.has(endpoint.track.id))?.track
      if (!track) return []
      const stats = await pc.getStats(track)
      const last = previous.get(pc) || new Map<string, Report>()
      const next = new Map<string, Report>()
      const rows: TransmissionStats[] = []
      stats.forEach((video: Report) => {
        if (video.type !== (local ? 'outbound-rtp' : 'inbound-rtp') ||
          (video.kind ?? video.mediaType) !== 'video' || video.isRemote) return
        const codec = stats.get(video.codecId)
        if (/\/(rtx|red|ulpfec|flexfec)/i.test(codec?.mimeType || '')) return
        const before = last.get(video.id)
        next.set(video.id, { ...video })
        const elapsed = delta(video.timestamp, before?.timestamp)
        const bytes = local ? video.bytesSent : video.bytesReceived
        const byteDelta = delta(bytes, local ? before?.bytesSent : before?.bytesReceived)
        const frames = delta(local ? video.framesEncoded : video.framesDecoded, local ? before?.framesEncoded : before?.framesDecoded)
        const bufferDelay = delta(local ? video.totalPacketSendDelay : video.jitterBufferDelay, local ? before?.totalPacketSendDelay : before?.jitterBufferDelay)
        const bufferCount = delta(local ? video.packetsSent : video.jitterBufferEmittedCount, local ? before?.packetsSent : before?.jitterBufferEmittedCount)
        const remote = stats.get(video.remoteId)
        const lost = local ? null : delta(video.packetsLost, before?.packetsLost)
        const received = local ? null : delta(video.packetsReceived, before?.packetsReceived)
        let pair: Report | undefined
        stats.forEach((entry: Report) => {
          if (entry.type === 'transport' && entry.selectedCandidatePairId) pair = stats.get(entry.selectedCandidatePairId)
        })
        rows.push({
          id: `${peerId}:${video.id}`, peerId,
          width: number(video.frameWidth), height: number(video.frameHeight),
          fps: number(video.framesPerSecond) ?? (frames !== null && elapsed ? frames * 1000 / elapsed : null),
          bitrateKbps: byteDelta !== null && elapsed ? byteDelta * 8 / elapsed : null,
          bytes: number(bytes), bufferKind: local ? 'send' : 'playback',
          bufferMs: bufferDelay !== null && bufferCount ? bufferDelay * 1000 / bufferCount : null,
          jitterMs: milliseconds(local ? remote?.jitter : video.jitter),
          rttMs: milliseconds(remote?.roundTripTime ?? pair?.currentRoundTripTime),
          lossPct: local ? (number(remote?.fractionLost) === null ? null : remote.fractionLost * 100)
            : lost !== null && received !== null && lost + received > 0 ? lost * 100 / (lost + received) : null,
          droppedFrames: local ? null : delta(video.framesDropped, before?.framesDropped),
          codec: typeof codec?.mimeType === 'string' ? codec.mimeType.replace(/^video\//, '') : null,
          limitation: local && typeof video.qualityLimitationReason === 'string' ? video.qualityLimitationReason : null,
        })
      })
      previous.set(pc, next)
      return rows
    }))
    return results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
  }
}
