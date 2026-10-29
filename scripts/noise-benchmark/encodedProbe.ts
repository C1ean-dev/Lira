type FrameEvent = { rtp: number; atMs: number; forwardedAtMs: number; size: number; hash: string; data: string; metadata: unknown }

// Test-only transparent probe. It never edits a packet or the production RTC
// configuration. Encoded receiver frames are observed before NetEq/decoding.
export function installEncodedProbe(target: any = window, clock = () => performance.timeOrigin + performance.now()) {
  const Native = target.RTCPeerConnection
  const seen = new WeakSet<object>()
  const probe = { sent: [] as FrameEvent[], received: [] as FrameEvent[], errors: [] as string[] }
  function observe(endpoint: any, direction: 'sent' | 'received', kind: string) {
    if (seen.has(endpoint)) return
    seen.add(endpoint)
    if (typeof endpoint.createEncodedStreams !== 'function') throw new Error('Encoded WebRTC audio instrumentation unavailable')
    const streams = endpoint.createEncodedStreams()
    void streams.readable.pipeThrough(new TransformStream({
      transform(frame, controller) {
        const atMs = clock()
        if (kind === 'audio') {
          const bytes = new Uint8Array(frame.data)
          let hash = 2166136261
          let binary = ''
          for (const value of bytes) { hash = Math.imul(hash ^ value, 16777619); binary += String.fromCharCode(value) }
          const event = { rtp: frame.timestamp, atMs, forwardedAtMs: atMs, size: bytes.length,
            hash: (hash >>> 0).toString(16), data: typeof btoa === 'function' ? btoa(binary) : '', metadata: frame.getMetadata?.() || {} }
          controller.enqueue(frame)
          event.forwardedAtMs = clock()
          probe[direction].push(event)
        } else controller.enqueue(frame)
      },
    })).pipeTo(streams.writable).catch((error: Error) => probe.errors.push(direction + ': ' + error.message))
  }
  target.RTCPeerConnection = class extends Native {
    constructor(config: RTCConfiguration) {
      super({ ...config, encodedInsertableStreams: true })
      this.addEventListener('track', (event: RTCTrackEvent) => observe(event.receiver, 'received', event.track.kind))
    }
    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]) {
      const sender = super.addTrack(track, ...streams)
      observe(sender, 'sent', track.kind)
      return sender
    }
    addTransceiver(trackOrKind: MediaStreamTrack | string, init: RTCRtpTransceiverInit) {
      const transceiver = super.addTransceiver(trackOrKind, init)
      observe(transceiver.sender, 'sent', typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind)
      return transceiver
    }
  }
  return probe
}
