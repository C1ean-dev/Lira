import { acceptsGStreamerVideo, normalizeGStreamerOffer, type GStreamerSignal } from './gstreamerProtocol'

const WAIT_FOR_FRAMES_MS = 8_000
const POLL_MS = 500
const MAX_ICE = 100

export class GStreamerReceiver {
  private readonly peer: RTCPeerConnection
  private readonly timer: ReturnType<typeof setInterval>
  private readonly remoteIce: RTCIceCandidateInit[] = []
  private readonly localIce: RTCIceCandidateInit[] = []
  private queue = Promise.resolve()
  private offered = false
  private answered = false
  private closed = false
  private polling = false
  private stream?: MediaStream
  private delivered = false
  private frames = 0
  private lastFrameAt = Date.now()

  constructor(
    readonly session: string, rtc: RTCConfiguration,
    private readonly send: (signal: GStreamerSignal) => void,
    private readonly onVideo: (stream: MediaStream) => void,
    private readonly onFailure: () => void,
  ) {
    const peer = this.peer = new RTCPeerConnection(rtc)
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate?.candidate || candidate.sdpMLineIndex === null || this.closed) return
      if (this.answered) this.sendIce(candidate)
      else if (this.localIce.length < MAX_ICE) this.localIce.push(candidate)
    }
    peer.ontrack = ({ track }) => {
      if (track.kind !== 'video' || this.closed || this.stream) return
      this.stream = new MediaStream([track])
      track.addEventListener('ended', this.fail, { once: true })
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed') this.fail()
    }
    this.timer = setInterval(() => { void this.checkVideo() }, POLL_MS)
  }

  getStats(): Promise<RTCStatsReport> { return this.peer.getStats() }
  get peerConnection(): RTCPeerConnection { return this.peer }

  receive(signal: GStreamerSignal): void {
    if (signal.session !== this.session || this.closed) return
    if (signal.kind === 'end') { this.fail(); return }
    this.queue = this.queue.then(async () => {
      if (this.closed) return
      if (signal.kind === 'ice') {
        if (this.peer.remoteDescription) await this.peer.addIceCandidate(signal.candidate).catch(() => {})
        else if (this.remoteIce.length < MAX_ICE) this.remoteIce.push(signal.candidate)
      } else if (signal.kind === 'sdp' && signal.description.type === 'offer' && !this.offered) {
        this.offered = true
        await this.peer.setRemoteDescription({ type: 'offer', sdp: normalizeGStreamerOffer(signal.description.sdp) })
        if (this.closed) return
        for (const ice of this.remoteIce.splice(0)) await this.peer.addIceCandidate(ice).catch(() => {})
        const answer = await this.peer.createAnswer()
        if (!answer.sdp || !acceptsGStreamerVideo(answer.sdp)) throw new Error('H.264 indisponível')
        await this.peer.setLocalDescription(answer)
        const sdp = this.peer.localDescription?.sdp
        if (!sdp || this.closed) return
        this.send({ kind: 'sdp', session: this.session, description: { type: 'answer', sdp } })
        this.answered = true
        for (const ice of this.localIce.splice(0)) this.sendIce(ice)
      }
    }).catch(this.fail)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer)
    this.peer.onconnectionstatechange = null
    this.peer.onicecandidate = null
    this.peer.ontrack = null
    this.stream?.getVideoTracks().forEach(track => {
      track.removeEventListener('ended', this.fail)
      track.stop()
    })
    this.peer.close()
  }

  private sendIce(ice: RTCIceCandidateInit) {
    if (ice.candidate && typeof ice.sdpMLineIndex === 'number')
      this.send({ kind: 'ice', session: this.session, candidate: { candidate: ice.candidate, sdpMLineIndex: ice.sdpMLineIndex } })
  }

  private fail = () => {
    if (this.closed) return
    this.close()
    this.onFailure()
  }

  private async checkVideo() {
    if (this.closed) return
    if (this.stream && !this.polling) {
      this.polling = true
      try {
        const stats = await this.getStats()
        if (this.closed) return
        let decoded = 0
        stats.forEach(row => {
          if (row.type === 'inbound-rtp' && (row.kind ?? row.mediaType) === 'video') decoded += row.framesDecoded ?? 0
        })
        const advanced = decoded > 0 && decoded !== this.frames
        this.frames = decoded
        if (advanced) {
          this.lastFrameAt = Date.now()
          if (!this.delivered) {
            this.delivered = true
            this.onVideo(this.stream)
          }
        }
      } catch { /* The deadline also applies when statistics become unavailable. */ }
      finally { this.polling = false }
    }
    if (Date.now() - this.lastFrameAt >= WAIT_FOR_FRAMES_MS) this.fail()
  }
}

export class NativeGStreamerCapture {
  private readonly id = crypto.randomUUID()
  private preview?: GStreamerReceiver
  private unsubscribe: () => void
  private closed = false
  private resolve?: (stream: MediaStream | null) => void
  private route?: (signal: GStreamerSignal) => void
  private active = false

  constructor(
    private readonly api: import('./gstreamerProtocol').GStreamerCaptureAPI,
    private readonly onFailure: () => void,
  ) {
    this.unsubscribe = api.onGStreamerSignal((id, signal) => {
      if (id !== this.id || this.closed) return
      if (!signal) this.fail()
      else if (signal.session === this.preview?.session) this.preview.receive(signal)
      else this.route?.(signal)
    })
  }

  async start(capture: import('./gstreamerProtocol').GStreamerCapture): Promise<MediaStream | null> {
    try {
      if (!await this.api.startGStreamerCapture(this.id, capture) || this.closed) return null
      const session = crypto.randomUUID()
      return await new Promise<MediaStream | null>(resolve => {
        this.resolve = resolve
        this.preview = new GStreamerReceiver(session, { iceServers: [] }, this.send, stream => {
          this.resolve = undefined
          resolve(stream)
        }, this.fail)
        this.send({ kind: 'watch', session })
      })
    } catch {
      return null
    }
  }

  activate(route: (signal: GStreamerSignal) => void): void {
    this.route = route
    this.active = true
  }

  get available(): boolean { return !this.closed }

  signal(signal: GStreamerSignal): Promise<boolean> {
    return this.closed ? Promise.resolve(false) : this.api.sendGStreamerSignal(this.id, signal).catch(() => false)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    this.preview?.close()
    this.resolve?.(null)
    this.resolve = undefined
    void this.api.stopGStreamerCapture(this.id).catch(() => {})
  }

  private send = (signal: GStreamerSignal) => {
    void this.signal(signal).then(ok => { if (!ok) this.fail() })
  }

  private fail = () => {
    if (this.closed) return
    this.close()
    if (this.active) this.onFailure()
  }
}
