import { describe, expect, it, vi } from 'vitest'
import { createTransmissionSampler } from '../../media/liveTransmissionStats'

const track = { id: 'screen', kind: 'video', readyState: 'live' } as MediaStreamTrack
const stream = { getVideoTracks: () => [track] } as MediaStream
const report = (...rows: any[]) => new Map(rows.map(row => [row.id, row])) as unknown as RTCStatsReport
const outbound = (timestamp: number, bytesSent: number, extra = {}) => ({
  id: 'video', type: 'outbound-rtp', kind: 'video', timestamp, bytesSent,
  packetsSent: timestamp / 10, totalPacketSendDelay: timestamp / 10000,
  frameWidth: 1920, frameHeight: 1080, framesPerSecond: 60, ...extra,
})
function connection(stats: ReturnType<typeof report>) {
  return {
    getStats: vi.fn(async () => stats),
    getSenders: () => [{ track }], getReceivers: () => [{ track }],
    connectionState: 'connected',
  } as unknown as RTCPeerConnection
}

describe('live transmission statistics', () => {
  it('measures bitrate and send queue from deltas, with independent counters for each recipient', async () => {
    const sample = createTransmissionSampler()
    const pc = connection(report(outbound(1000, 100000)))
    const other = connection(report(outbound(1000, 50000)))
    const calls = new Map([['viewer', { peerConnection: pc }], ['other', { peerConnection: other }]])
    const first = await sample(calls, stream, true)
    expect(first[0].bitrateKbps).toBeNull()
    vi.mocked(pc.getStats).mockResolvedValue(report(outbound(2000, 350000)))
    vi.mocked(other.getStats).mockResolvedValue(report(outbound(2000, 175000)))
    const rows = await sample(calls, stream, true)
    expect(rows.map(row => row.bitrateKbps)).toEqual([2000, 1000])
    expect(rows[0]).toMatchObject({ width: 1920, height: 1080, fps: 60, bufferMs: 1, bufferKind: 'send', bytes: 350000 })
    expect(pc.getStats).toHaveBeenCalledWith(track)
  })

  it('reports playback buffer, lost packets and dropped frames for a viewer', async () => {
    const sample = createTransmissionSampler()
    const inbound = (timestamp: number, extra = {}) => ({
      id: 'incoming', type: 'inbound-rtp', kind: 'video', timestamp,
      bytesReceived: timestamp * 100, framesDecoded: timestamp / 20,
      jitterBufferDelay: timestamp / 1000, jitterBufferEmittedCount: timestamp / 20,
      packetsLost: timestamp / 1000, packetsReceived: timestamp / 10,
      framesDropped: timestamp / 1000, jitter: 0.005, codecId: 'codec', ...extra,
    })
    const codec = { id: 'codec', type: 'codec', mimeType: 'video/VP9' }
    const pc = connection(report(inbound(1000), codec))
    const calls = new Map([['host', { peerConnection: pc }]])
    await sample(calls, stream, false)
    vi.mocked(pc.getStats).mockResolvedValue(report(inbound(2000), codec))
    expect((await sample(calls, stream, false))[0]).toMatchObject({
      bitrateKbps: 800, fps: 50, bufferKind: 'playback', bufferMs: 20,
      lossPct: 100 / 101, droppedFrames: 1, jitterMs: 5, codec: 'VP9',
    })
  })

  it('does not fabricate zero measurements on the first sample, reset counters or missing browser fields', async () => {
    const sample = createTransmissionSampler()
    const pc = connection(report(outbound(1000, 100000, { totalPacketSendDelay: undefined })))
    const calls = new Map([['viewer', { peerConnection: pc }]])
    expect((await sample(calls, stream, true))[0].bufferMs).toBeNull()
    vi.mocked(pc.getStats).mockResolvedValue(report(outbound(2000, 20)))
    expect((await sample(calls, stream, true))[0].bitrateKbps).toBeNull()
  })

  it('ignores unrelated camera tracks and tolerates a disconnected recipient', async () => {
    const pc = connection(report(outbound(1000, 100)))
    pc.getSenders = () => [{ track: { ...track, id: 'camera' } }] as RTCRtpSender[]
    const broken = connection(report())
    vi.mocked(broken.getStats).mockRejectedValue(new Error('closed'))
    const sample = createTransmissionSampler()
    expect(await sample(new Map([['camera', { peerConnection: pc }], ['broken', { peerConnection: broken }]]), stream, true)).toEqual([])
    expect(pc.getStats).not.toHaveBeenCalled()
  })
})
