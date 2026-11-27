import { GStreamerReceiver, type NativeGStreamerCapture } from '../media/gstreamerReceiver'
import type { GStreamerSignal } from '../media/gstreamerProtocol'

type Capture = Pick<NativeGStreamerCapture, 'activate' | 'signal'>
const VIEW_TIMEOUT_MS = 30_000
const OFFER_TIMEOUT_MS = 8_000
const MAX_VIEWERS = 32

export interface GStreamerRoomE2EE {
  signSdp?: (
    to: string,
    session: string,
    type: 'offer' | 'answer',
    sdp: string
  ) => Promise<string | null>
  verifySdp?: (
    from: string,
    session: string,
    type: 'offer' | 'answer',
    sdp: string,
    sig?: string
  ) => Promise<boolean>
}

interface Dependencies {
  rtc: RTCConfiguration
  send: (peerId: string, signal: GStreamerSignal) => void
  eligible: (peerId: string) => boolean
  watching: (peerId: string) => boolean
  stream: (peerId: string, track: MediaStreamTrack, present: boolean) => void
  rtp: (peerId: string, nativePlaying: boolean) => void
  e2ee?: GStreamerRoomE2EE
}

interface Subscription {
  session: string
  started: number
  ice: GStreamerSignal[]
  receiver?: GStreamerReceiver
  track?: MediaStreamTrack
}
interface Viewer {
  session: string
  playing: boolean
  expiry: ReturnType<typeof setTimeout>
}

export class GStreamerRoom {
  private capture?: Capture
  private readonly viewers = new Map<string, Viewer>()
  private readonly subscriptions = new Map<string, Subscription>()

  constructor(private readonly deps: Dependencies) {}

  private sendSignal(peerId: string, signal: GStreamerSignal): void {
    if (signal.kind === 'sdp' && this.deps.e2ee?.signSdp) {
      const signSdp = this.deps.e2ee.signSdp
      void signSdp(peerId, signal.session, signal.description.type, signal.description.sdp)
        .then((sig) => {
          this.deps.send(peerId, sig ? { ...signal, dtlsSig: sig } : signal)
        })
        .catch(() => {})
      return
    }
    this.deps.send(peerId, signal)
  }

  setCapture(capture?: Capture): void {
    const previous = this.capture
    if (capture === previous) return
    this.capture = capture
    capture?.activate(signal => {
      if (capture !== this.capture) return
      for (const [id, viewer] of this.viewers) {
        if (viewer.session !== signal.session) continue
        if (!this.deps.eligible(id)) this.endViewer(id, true)
        else {
          this.sendSignal(id, signal)
          if (signal.kind === 'end') this.endViewer(id, false)
        }
        break
      }
    })
    for (const id of [...this.viewers.keys()]) this.endViewer(id, true, previous, !!capture)
  }

  watch(id: string, watch: boolean): void {
    if (!watch || !this.deps.watching(id)) { this.endSubscription(id, true); return }
    if (typeof globalThis.crypto?.randomUUID !== 'function') return
    let subscription = this.subscriptions.get(id)
    if (subscription && !subscription.receiver && Date.now() - subscription.started >= OFFER_TIMEOUT_MS) {
      this.endSubscription(id, true)
      subscription = undefined
    }
    if (!subscription) {
      subscription = { session: crypto.randomUUID(), started: Date.now(), ice: [] }
      this.subscriptions.set(id, subscription)
    }
    this.deps.send(id, { kind: 'watch', session: subscription.session })
  }

  async receive(id: string, signal: GStreamerSignal): Promise<void> {
    const sub = this.subscriptions.get(id)
    if (sub?.session === signal.session) {
      if (!this.deps.watching(id) || signal.kind === 'end') {
        this.endSubscription(id, false)
        if (signal.kind === 'end' && signal.retry) this.watch(id, true)
        return
      }
      if (signal.kind === 'ice' && !sub.receiver && sub.ice.length < 100) sub.ice.push(signal)
      if (signal.kind === 'sdp' && signal.description.type === 'offer') {
        if (this.deps.e2ee?.verifySdp) {
          const valid = await this.deps.e2ee.verifySdp(
            id,
            signal.session,
            signal.description.type,
            signal.description.sdp,
            signal.dtlsSig
          )
          if (!valid) {
            this.endSubscription(id, true)
            return
          }
          if (this.subscriptions.get(id) !== sub) return
        }
        if (!sub.receiver) {
          try {
            sub.receiver = new GStreamerReceiver(sub.session, this.deps.rtc, reply => this.sendSignal(id, reply), stream => {
              const track = stream.getVideoTracks()[0]
              if (!track || !this.deps.watching(id)) { this.endSubscription(id, true); return }
              sub.track = track
              this.deps.stream(id, track, true)
              this.deps.send(id, { kind: 'ready', session: sub.session })
            }, () => this.endSubscription(id, true))
            for (const ice of sub.ice.splice(0)) sub.receiver.receive(ice)
          } catch { this.endSubscription(id, true); return }
        }
      }
      sub.receiver?.receive(signal)
      return
    }

    const capture = this.capture
    const existing = this.viewers.get(id)
    if (!capture || !this.deps.eligible(id)) {
      if (existing) this.endViewer(id, true)
      return
    }
    if (signal.kind === 'watch') {
      if (existing?.session === signal.session) {
        clearTimeout(existing.expiry)
        existing.expiry = setTimeout(() => this.endViewer(id, true), VIEW_TIMEOUT_MS)
        if (existing.playing) this.deps.rtp(id, true)
        return
      }
      if ([...this.viewers.values()].some(viewer => viewer.session === signal.session)) return
      if (existing) this.endViewer(id, true)
      if (this.viewers.size >= MAX_VIEWERS) return
      const viewer = { session: signal.session, playing: false, expiry: setTimeout(() => this.endViewer(id, true), VIEW_TIMEOUT_MS) }
      this.viewers.set(id, viewer)
      if (!await capture.signal(signal) && this.viewers.get(id) === viewer) this.endViewer(id, true)
    } else if (existing?.session === signal.session) {
      if (signal.kind === 'end') this.endViewer(id, false)
      else if (signal.kind === 'ready' && !existing.playing) {
        existing.playing = true
        this.deps.rtp(id, true)
      } else if (signal.kind === 'sdp') {
        if (this.deps.e2ee?.verifySdp) {
          const valid = await this.deps.e2ee.verifySdp(
            id,
            signal.session,
            signal.description.type,
            signal.description.sdp,
            signal.dtlsSig
          )
          if (!valid) {
            this.endViewer(id, true)
            return
          }
          if (this.viewers.get(id) !== existing || this.capture !== capture) return
        }
        await capture.signal(signal)
      } else if (signal.kind === 'ice') await capture.signal(signal)
    }
  }

  connection(stream: MediaStream): { id: string; peerConnection: RTCPeerConnection } | undefined {
    for (const [id, sub] of this.subscriptions) {
      if (sub.track && sub.receiver && stream.getVideoTracks().includes(sub.track))
        return { id, peerConnection: sub.receiver.peerConnection }
    }
  }

  isSendingVideo(id: string): boolean { return this.viewers.get(id)?.playing === true }

  peerLeft(id: string): void {
    this.endViewer(id, true)
    this.endSubscription(id, true)
  }

  close(): void {
    this.setCapture()
    for (const id of this.subscriptions.keys()) this.endSubscription(id, true)
  }

  private endViewer(id: string, notify: boolean, capture = this.capture, retry = false): void {
    const viewer = this.viewers.get(id)
    if (!viewer) return
    this.viewers.delete(id)
    clearTimeout(viewer.expiry)
    const signal = { kind: 'end', session: viewer.session } as const
    void capture?.signal(signal)
    if (viewer.playing) this.deps.rtp(id, false)
    if (notify) this.deps.send(id, retry ? { ...signal, retry: true } : signal)
  }

  private endSubscription(id: string, notify: boolean): void {
    const sub = this.subscriptions.get(id)
    if (!sub) return
    this.subscriptions.delete(id)
    sub.receiver?.close()
    if (sub.track) this.deps.stream(id, sub.track, false)
    if (notify) this.deps.send(id, { kind: 'end', session: sub.session })
  }
}
