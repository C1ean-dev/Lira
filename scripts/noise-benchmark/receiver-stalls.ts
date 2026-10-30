// Controlled receiver stalls for A/B experiments, never imported by the app.
export function installReceiverStalls(target: any = window) {
  const Native = target.RTCPeerConnection
  const seen = new WeakSet<object>()
  const stats = { receivedFrames: 0, delayedFrames: 0, delayMs: 90, errors: [] as string[] }
  const connect = (endpoint: any, receiver = false, kind = '') => {
    if (seen.has(endpoint)) return
    seen.add(endpoint)
    if (!endpoint.createEncodedStreams) throw new Error('Receiver stall instrumentation unavailable')
    const streams = endpoint.createEncodedStreams()
    const readable = receiver && kind === 'audio' ? streams.readable.pipeThrough(new TransformStream({
      async transform(frame, controller) {
        stats.receivedFrames++
        if (stats.receivedFrames % 25 === 0) {
          stats.delayedFrames++
          await new Promise(resolve => setTimeout(resolve, stats.delayMs))
        }
        controller.enqueue(frame)
      },
    })) : streams.readable
    void readable.pipeTo(streams.writable).catch((error: Error) => stats.errors.push(error.message))
  }
  target.RTCPeerConnection = class extends Native {
    constructor(config: RTCConfiguration) {
      super({ ...config, encodedInsertableStreams: true })
      this.addEventListener('track', (event: RTCTrackEvent) => connect(event.receiver, true, event.track.kind))
    }
    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]) {
      const sender = super.addTrack(track, ...streams); connect(sender); return sender
    }
    addTransceiver(track: MediaStreamTrack | string, init: RTCRtpTransceiverInit) {
      const transceiver = super.addTransceiver(track, init); connect(transceiver.sender); return transceiver
    }
  }
  return stats
}
