import { AlmTree } from './almTree'
import { AlmAssembler, AlmFrameQueue, packetizeFrame, type AlmFrame } from './almPackets'
import { AlmVideoSink, AlmVideoSource, supportsAlmVideo, type AlmVideoConfig } from '../media/almVideo'
import { AlmAudioSource, AlmAudioSink, supportsAlmAudio } from '../media/almAudio'
import { AlmCaptureClock, AlmPlayoutClock } from '../media/almClock'
import { markAlmStream } from '../media/almStreams'
import { AlmCapacity } from './almCapacity'

export interface AlmEdge { id: string; parent: string; child: string; maxLayer?: number }
interface Link {
  edge: AlmEdge
  pc: RTCPeerConnection
  channel?: RTCDataChannel
  candidates: RTCIceCandidateInit[]
  assembler: AlmAssembler
  seen: Set<string>
  openedAt: number
  blocked: number
  sent: number
  received: number
  reportedBytes: number
  deliveredBps: number | null
  rttMs: number | null
  statsPending: boolean
  receiptAt: number
}
interface Session {
  root: string
  epoch: string
  config: AlmVideoConfig
  audioConfig?: AudioDecoderConfig
  audioSource?: AlmAudioSource
  audioSink?: AlmAudioSink
  audioQueue?: AlmFrameQueue
  clock: AlmPlayoutClock
  localLayer: number
  videoTimestamp?: number
  viewHeights: Map<string, number | null>
  capacity: AlmCapacity
  measured?: ReturnType<AlmCapacity['observe']>
  lastSample: number
  createdAt: number
  audioFrames: number
  revision: number
  edges: AlmEdge[]
  links: Map<string, Link>
  sink?: AlmVideoSink
  queue?: AlmFrameQueue
  input?: string
  lastFrame: number
  lastKeyRequest: number
  lastRenew: number
  tree?: AlmTree
  viewers: Map<string, number>
  playing: Set<string>
  retired: Map<string, { edge: AlmEdge; until: number }>
  source?: AlmVideoSource
  capture?: { track: MediaStreamTrack; fps: number; hardware: boolean; audio?: MediaStreamTrack }
  lastShed: number
  confirmedInput?: string
  inputTimestamp?: number
}

export interface AlmLiveDeps {
  id: () => string | null
  peers: () => string[]
  eligible: (peerId: string, root: string) => boolean
  watching: (root: string) => boolean
  send: (to: string, payload: Record<string, unknown>) => void
  ice: () => Promise<RTCConfiguration>
  stream: (root: string, stream: MediaStream | null) => void
  rtp: (viewer: string, almPlaying: boolean) => void
  log: (event: string, data: Record<string, unknown>) => void
}

/** One presenter coordinates each live; all media edges are native DataChannels. */
export class AlmLive {
  private sessions = new Map<string, Session>()
  private timer: ReturnType<typeof setInterval> | null = null
  private generation = 0
  private configuring = new Map<string, symbol>()
  private pendingSignals: Array<{ from: string; message: any; at: number }> = []
  private wantedHeights = new Map<string, number | null>()

  constructor(private deps: AlmLiveDeps) {}

  private send(to: string, session: Session, message: Record<string, unknown>): void {
    this.deps.send(to, { ...message, root: session.root, epoch: session.epoch, v: 2 })
  }

  private arm(): void {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 2000)
  }

  async start(track: MediaStreamTrack, bitrate: number, fps: number, hardware: boolean, audio?: MediaStreamTrack): Promise<void> {
    this.stopSource()
    const generation = ++this.generation
    const root = this.deps.id()
    if (!root || !supportsAlmVideo()) { this.deps.log('unsupported', {}); return }
    const captureClock = new AlmCaptureClock()
    const onFailure = (error: unknown) => {
      if (generation !== this.generation) return
      this.deps.log('source-failed', { error: String(error) })
      this.stopSource()
    }
    const source = new AlmVideoSource(frame => {
      const session = this.sessions.get(root)
      if (session?.source === source) this.forward(session, frame)
    }, onFailure, captureClock)
    const audioSource = audio ? new AlmAudioSource(captureClock, frame => {
      const session = this.sessions.get(root)
      if (session && session.audioSource === audioSource) this.forward(session, frame)
    }, onFailure) : undefined
    try {
      const effectiveFps = Math.min(fps, track.getSettings().frameRate || fps)
      const config = await source.start(track, bitrate, effectiveFps, hardware)
      const audioConfig = audio ? await audioSource!.start(audio) : undefined
      if (generation !== this.generation) { source.close(); audioSource?.close(); return }
      const session = this.makeSession(root, crypto.randomUUID(), config)
      session.source = source
      session.audioSource = audioSource
      session.audioConfig = audioConfig
      session.capture = { track, fps: effectiveFps, hardware, audio }
      session.tree = new AlmTree(root)
      this.sessions.set(root, session)
      this.arm()
      for (const peer of this.deps.peers()) if (this.deps.eligible(peer, root)) this.send(peer, session, { kind: 'available' })
      this.deps.log('source-started', { codec: config.codec, fanout: 3, bitrate })
    } catch (error) {
      source.close()
      audioSource?.close()
      this.deps.log('source-unavailable', { error: String(error) })
    }
  }

  /** Called with the existing watch renewals, also providing legacy fallback. */
  watch(root: string, watch: boolean, height: number | null = null): void {
    const session = this.sessions.get(root)
    if (!watch) {
      this.wantedHeights.delete(root)
      this.configuring.delete(root)
      if (session && !session.tree) { this.send(root, session, { kind: 'leave' }); this.dispose(session) }
      return
    }
    this.wantedHeights.set(root, height)
    if (session) {
      const level = this.layerFor(height, session.config)
      if (level !== session.localLayer) { session.localLayer = level; session.queue?.reset(); this.requestKey(session) }
    }
    if (!supportsAlmVideo()) return
    this.deps.send(root, { kind: 'join', root, h: height, v: 2 })
    this.arm()
  }

  async receive(from: string, message: any): Promise<void> {
    const me = this.deps.id()
    if (!me || !message || message.v !== 2 || typeof message.root !== 'string' ||
      !this.deps.eligible(from, message.root)) return
    const root = message.root
    let session = this.sessions.get(root)
    if (message.kind === 'available') {
      if (from === root && this.deps.watching(root)) this.watch(root, true, this.wantedHeights.get(root) ?? null)
      return
    }
    if (message.kind === 'join') {
      if (root === me && session?.tree && from !== me) {
        const height = this.validHeight(message.h)
        if (session.tree.parents.has(from) && session.viewHeights.get(from) !== height) {
          session.viewHeights.set(from, height); this.publish(session)
        } else session.viewHeights.set(from, height)
        this.send(from, session, { kind: 'config', config: session.config, audio: session.audioConfig })
      }
      return
    }
    if (message.kind === 'config') {
      if (from !== root || root === me || !this.deps.watching(root) || !supportsAlmVideo() ||
        typeof message.epoch !== 'string' || message.epoch.length > 80 || !this.validConfig(message.config)) return
      if (session && session.epoch === message.epoch) { this.send(root, session, { kind: 'ready' }); return }
      if (this.configuring.has(root)) return
      const token = Symbol()
      this.configuring.set(root, token)
      const config: AlmVideoConfig = {
        codec: message.config.codec, codedWidth: message.config.codedWidth,
        codedHeight: message.config.codedHeight, optimizeForLatency: true,
        temporalLayers: message.config.temporalLayers ?? 1,
      }
      try {
        if (!(await VideoDecoder.isConfigSupported(config)).supported || !this.deps.watching(root) || this.configuring.get(root) !== token) return
        let audioConfig: AudioDecoderConfig | undefined
        if (message.audio) {
          if (message.audio.codec !== 'opus' || ![8000, 12000, 16000, 24000, 44100, 48000].includes(message.audio.sampleRate) ||
            ![1, 2].includes(message.audio.numberOfChannels)) return
          audioConfig = { codec: 'opus', sampleRate: message.audio.sampleRate, numberOfChannels: message.audio.numberOfChannels }
          if (!(await supportsAlmAudio(audioConfig)) || this.configuring.get(root) !== token || !this.deps.watching(root)) return
        }
        if (session) this.dispose(session)
        session = this.makeSession(root, message.epoch, config)
        session.audioConfig = audioConfig
        this.sessions.set(root, session)
        this.prepareSink(session)
        this.send(root, session, { kind: 'ready' })
        this.arm()
      } catch (error) { this.deps.log('decoder-unavailable', { error: String(error) }) }
      finally { if (this.configuring.get(root) === token) this.configuring.delete(root) }
      return
    }
    if (!session || message.epoch !== session.epoch) return
    if (message.kind === 'stop' && from === root) { this.dispose(session); return }
    if (session.tree) {
      if (message.kind === 'ready') {
        session.viewers.set(from, Date.now())
        // Do not fill a slot still occupied by a retiring edge during handoff.
        if (!session.retired.size && session.tree.add(from)) this.publish(session)
        else if (session.tree.parents.has(from)) this.send(from, session, this.topology(session))
        return
      }
      if (message.kind === 'leave') { this.removeViewer(session, from); return }
      if (!session.tree.parents.has(from)) return
      if (message.kind === 'playing') {
        const edge = session.edges.find(edge => edge.id === message.edge && edge.child === from)
        if (!edge) return
        session.playing.add(from)
        this.deps.rtp(from, true)
        const retired = [...session.retired].filter(([, old]) => old.edge.child === from)
        for (const [id] of retired) session.retired.delete(id)
        if (retired.length) this.publish(session)
        return
      }
      if (message.kind === 'fallback') {
        session.playing.delete(from)
        this.deps.rtp(from, false)
        this.removeViewer(session, from)
        return
      }
      if (message.kind === 'key') {
        if (Date.now() - session.lastKeyRequest > 500) { session.source?.requestKey(); session.lastKeyRequest = Date.now() }
        return
      }
      if (message.kind === 'capacity' &&
        Number.isInteger(message.children) && message.children >= 0 && message.children <= 3) {
        const deliveredBps = Number.isFinite(message.deliveredBps) ? Math.max(0, Math.min(1e10, message.deliveredBps)) : 0
        const rttMs = Number.isFinite(message.rttMs) ? Math.max(0, Math.min(30_000, message.rttMs)) : null
        session.tree.report(from, message.children, deliveredBps, rttMs)
        if (!session.retired.size && Date.now() - session.lastShed > 10_000 && session.tree.shed(from, message.children)) {
          session.lastShed = Date.now()
          this.deps.log('partial-shedding', { node: from, children: message.children })
          this.publish(session)
        }
        return
      }
    }
    if (message.kind === 'receipt') {
      const link = session.links.get(message.edge)
      if (!link || link.edge.child !== from || link.edge.parent !== me || !Number.isSafeInteger(message.bytes) || message.bytes < 0 ||
        !Number.isFinite(message.interval) || message.interval < 200 || message.interval > 10_000) return
      if (message.bytes >= link.reportedBytes) {
        link.deliveredBps = (message.bytes - link.reportedBytes) * 8000 / message.interval
        link.reportedBytes = message.bytes
        link.receiptAt = Date.now()
      }
      return
    }
    if (message.kind === 'topology' && from === root && !session.tree) {
      if (!this.validTopology(message, root) || message.revision <= session.revision) return
      session.revision = message.revision
      session.edges = message.edges
      this.syncLinks(session)
      this.flushSignals(session)
      return
    }
    if (message.kind === 'signal') await this.signal(session, from, message)
  }

  private validConfig(config: any): boolean {
    return config && ['avc1.640033', 'avc1.420033', 'vp8'].includes(config.codec) &&
      Number.isInteger(config.codedWidth) && Number.isInteger(config.codedHeight) &&
      config.codedWidth >= 2 && config.codedWidth <= 7680 && config.codedHeight >= 2 && config.codedHeight <= 4320 &&
      (config.temporalLayers === undefined || [1, 2, 3].includes(config.temporalLayers))
  }

  private validTopology(message: any, root: string): boolean {
    if (!Number.isSafeInteger(message.revision) || !Array.isArray(message.edges) || message.edges.length > 512) return false
    const ids = new Set<string>()
    return message.edges.every((edge: any) => {
      if (!edge || typeof edge.id !== 'string' || edge.id.length > 160 || ids.has(edge.id) ||
        typeof edge.parent !== 'string' || typeof edge.child !== 'string' || edge.parent === edge.child ||
        edge.child === root || !Number.isInteger(edge.maxLayer) || edge.maxLayer < 0 || edge.maxLayer > 2 ||
        !this.deps.eligible(edge.parent, root) || !this.deps.eligible(edge.child, root)) return false
      ids.add(edge.id)
      return true
    })
  }

  private makeSession(root: string, epoch: string, config: AlmVideoConfig): Session {
    return { root, epoch, config, revision: 0, edges: [], links: new Map(), lastFrame: Date.now(),
      lastKeyRequest: 0, lastRenew: Date.now(), viewers: new Map(), playing: new Set(), retired: new Map(), lastShed: 0,
      clock: new AlmPlayoutClock(), localLayer: this.layerFor(this.wantedHeights.get(root) ?? null, config),
      viewHeights: new Map(), capacity: new AlmCapacity(), lastSample: performance.now(), createdAt: Date.now(), audioFrames: 0 }
  }

  private validHeight(height: unknown): number | null {
    return typeof height === 'number' && Number.isFinite(height) && height >= 0 ? Math.min(4320, height) : null
  }

  private layerFor(height: number | null, config: AlmVideoConfig): number {
    return height !== null && height <= 360 ? 0 : (config.temporalLayers ?? 1) - 1
  }

  private prepareSink(session: Session): void {
    session.sink?.close()
    const notify = () => {
      if (this.sessions.get(session.root) !== session) return
      const timestamp = session.videoTimestamp
      if (timestamp === undefined || (session.audioSink && !session.audioSink.played)) return
      this.deps.stream(session.root, session.sink!.stream)
      if (session.confirmedInput !== session.input && timestamp >= (session.inputTimestamp ?? Infinity)) {
        session.confirmedInput = session.input
        this.send(session.root, session, { kind: 'playing', edge: session.input })
      }
    }
    if (session.audioConfig) {
      session.audioSink = new AlmAudioSink(session.audioConfig, session.clock, notify, error => this.fallback(session, error))
      session.audioQueue = new AlmFrameQueue(frame => {
        try { session.audioSink?.decode(frame) } catch (error) { this.fallback(session, error) }
      }, () => {}, { independent: true, ttlMs: 40 })
    }
    session.sink = new AlmVideoSink(session.config, timestamp => { session.videoTimestamp = timestamp; notify() },
      error => this.fallback(session, error), session.clock)
    // Keep the raw canvas video out of the browser's separate live-audio buffer.
    // RemoteAudio controls this same scheduled audio graph directly.
    markAlmStream(session.sink.stream, session.audioSink)
    session.queue = new AlmFrameQueue(frame => {
      try { session.sink?.decode(frame) } catch (error) { this.fallback(session, error) }
    }, () => this.requestKey(session))
  }

  private topology(session: Session): Record<string, unknown> {
    return { kind: 'topology', revision: session.revision, edges: [...session.edges, ...[...session.retired.values()].map(old => old.edge)] }
  }

  private publish(session: Session, departed?: string): void {
    const before = session.edges
    const needs = new Map<string, number>()
    const need = (node: string): number => {
      if (needs.has(node)) return needs.get(node)!
      const level = Math.max(this.layerFor(session.viewHeights.get(node) ?? null, session.config), ...session.tree!.children(node).map(need))
      needs.set(node, level); return level
    }
    session.edges = [...session.tree!.parents].map(([child, parent]) => ({
      ...(before.find(edge => edge.child === child && edge.parent === parent) ?? { id: crypto.randomUUID(), parent, child }), maxLayer: need(child),
    }))
    for (const old of before) {
      if (old.parent !== departed && !session.edges.some(edge => edge.id === old.id) && session.tree!.parents.has(old.child)) {
        session.retired.set(old.id, { edge: old, until: Date.now() + 12_000 })
      }
    }
    session.revision++
    const topology = this.topology(session)
    for (const child of session.tree!.parents.keys()) this.send(child, session, topology)
    this.syncLinks(session)
    session.source?.requestKey()
    this.deps.log('topology', { root: session.root, revision: session.revision, edges: session.edges })
  }

  private syncLinks(session: Session): void {
    const me = this.deps.id()
    const edges = session.tree ? [...session.edges, ...[...session.retired.values()].map(old => old.edge)] : session.edges
    const mine = edges.filter(edge => edge.parent === me || edge.child === me)
    for (const [id, link] of session.links) {
      if (!mine.some(edge => edge.id === id)) { session.links.delete(id); link.pc.close() }
      else link.edge = mine.find(edge => edge.id === id)!
    }
    for (const edge of mine) {
      if (edge.parent === me && !session.links.has(edge.id)) void this.createLink(session, edge, true).catch(error => this.linkFailed(session, edge, error))
    }
  }

  private async createLink(session: Session, edge: AlmEdge, offer: boolean): Promise<Link | null> {
    // Register synchronously so duplicate signals cannot create parallel links.
    if (session.links.has(edge.id)) return session.links.get(edge.id)!
    const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle', iceCandidatePoolSize: 0 })
    const link: Link = { edge, pc, candidates: [], assembler: new AlmAssembler(), seen: new Set(), openedAt: Date.now(), blocked: 0, sent: 0,
      received: 0, reportedBytes: 0, deliveredBps: null, rttMs: null, statsPending: false, receiptAt: 0 }
    session.links.set(edge.id, link)
    const other = offer ? edge.child : edge.parent
    pc.onicecandidate = event => {
      if (event.candidate) this.send(other, session, { kind: 'signal', edge: edge.id, candidate: event.candidate.toJSON() })
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.linkFailed(session, edge, new Error('ICE failed'))
    }
    pc.ondatachannel = event => {
      if (offer || event.channel.label !== 'lira-alm-v2' || event.channel.ordered || event.channel.maxRetransmits !== 0 || link.channel) {
        event.channel.close(); return
      }
      this.attachChannel(session, link, event.channel)
    }
    const ice = await this.deps.ice()
    if (this.sessions.get(session.root) !== session || session.links.get(edge.id) !== link) { pc.close(); return null }
    pc.setConfiguration({ ...pc.getConfiguration(), ...ice })
    if (offer) {
      this.attachChannel(session, link, pc.createDataChannel('lira-alm-v2', { ordered: false, maxRetransmits: 0 }))
      await pc.setLocalDescription(await pc.createOffer())
      this.send(other, session, { kind: 'signal', edge: edge.id, description: pc.localDescription?.toJSON() })
    }
    return link
  }

  private attachChannel(session: Session, link: Link, channel: RTCDataChannel): void {
    link.channel = channel
    channel.binaryType = 'arraybuffer'
    channel.onopen = () => { link.openedAt = Date.now(); this.requestKey(session) }
    channel.onclose = () => {
      if (session.links.get(link.edge.id) === link) this.linkFailed(session, link.edge, new Error('Channel closed'))
    }
    channel.onmessage = event => {
      if (link.edge.child !== this.deps.id() || !(event.data instanceof ArrayBuffer) ||
        this.sessions.get(session.root) !== session || !this.deps.watching(session.root)) return
      link.received += event.data.byteLength
      const frame = link.assembler.push(event.data)
      if (!frame) return
      const frameId = `${frame.media ?? 'video'}:${frame.sequence}`
      if (link.seen.has(frameId)) return
      link.seen.add(frameId)
      if (link.seen.size > 256) link.seen.delete(link.seen.values().next().value!)
      if (session.input !== link.edge.id) {
        if (frame.media === 'audio') return
        // A keyframe is the only safe point to switch parents, without re-encoding.
        const desired = session.edges.find(edge => edge.child === this.deps.id())
        if (!frame.key || (session.input && desired?.id !== link.edge.id)) return
        session.input = link.edge.id
        session.inputTimestamp = frame.timestamp
        session.queue?.reset()
      }
      if (frame.media !== 'audio') session.lastFrame = Date.now()
      this.forward(session, frame)
      if (frame.media === 'audio') { session.audioFrames++; session.audioQueue?.push(frame) }
      else if ((frame.temporalLayer ?? 0) <= session.localLayer)
        session.queue?.push({ ...frame, sequence: frame.layerSequences?.[session.localLayer] ?? frame.sequence })
    }
  }

  private forward(session: Session, frame: AlmFrame): void {
    const packets = packetizeFrame(frame)
    for (const link of session.links.values()) {
      if (link.edge.parent !== this.deps.id() || link.channel?.readyState !== 'open') continue
      if (frame.media !== 'audio' && (frame.temporalLayer ?? 0) > (link.edge.maxLayer ?? 2)) continue
      const bytes = packets.reduce((sum, packet) => sum + packet.byteLength, 0)
      // Never build an unbounded queue. Drop a whole frame on this edge only.
      if (link.channel.bufferedAmount + bytes > 2 * 1024 * 1024) { link.blocked++; continue }
      try {
        for (const packet of packets) link.channel.send(packet)
        link.sent += bytes
      } catch { link.blocked++ }
    }
  }

  private async signal(session: Session, from: string, message: any): Promise<void> {
    if (typeof message.edge !== 'string') return
    const all = [...session.edges, ...[...session.retired.values()].map(old => old.edge)]
    const edge = all.find(edge => edge.id === message.edge &&
      ((edge.parent === from && edge.child === this.deps.id()) || (edge.child === from && edge.parent === this.deps.id())))
    if (!edge) {
      // Signaling can overtake the topology sent on a different reliable path.
      if (this.pendingSignals.length < 64) this.pendingSignals.push({ from, message, at: Date.now() })
      return
    }
    let link = session.links.get(edge.id)
    const isOffer = message.description?.type === 'offer'
    if (!link) {
      if (!isOffer || edge.parent !== from) {
        if (message.candidate && this.pendingSignals.length < 64) this.pendingSignals.push({ from, message, at: Date.now() })
        return
      }
      link = await this.createLink(session, edge, false) ?? undefined
    }
    if (!link || link.pc.signalingState === 'closed') return
    try {
      if (message.description) {
        const description = message.description
        if (typeof description.sdp !== 'string' || description.sdp.length > 100_000 ||
          !['offer', 'answer'].includes(description.type) || (isOffer !== (edge.parent === from))) return
        await link.pc.setRemoteDescription(description)
        for (const candidate of link.candidates.splice(0)) await link.pc.addIceCandidate(candidate)
        if (isOffer) {
          await link.pc.setLocalDescription(await link.pc.createAnswer())
          this.send(from, session, { kind: 'signal', edge: edge.id, description: link.pc.localDescription?.toJSON() })
        }
        this.flushSignals(session)
      } else if (message.candidate && typeof message.candidate.candidate === 'string' && message.candidate.candidate.length <= 4096) {
        if (link.pc.remoteDescription) await link.pc.addIceCandidate(message.candidate)
        else if (link.candidates.length < 64) link.candidates.push(message.candidate)
      }
    } catch (error) { this.linkFailed(session, edge, error) }
  }

  private flushSignals(session: Session): void {
    const pending = this.pendingSignals.splice(0)
    for (const entry of pending) {
      if (entry.message.root === session.root && entry.message.epoch === session.epoch && Date.now() - entry.at < 5000)
        void this.signal(session, entry.from, entry.message)
      else if (Date.now() - entry.at < 5000) this.pendingSignals.push(entry)
    }
  }

  private requestKey(session: Session): void {
    if (session.tree) { session.source?.requestKey(); return }
    if (Date.now() - session.lastKeyRequest < 500) return
    session.lastKeyRequest = Date.now()
    this.send(session.root, session, { kind: 'key' })
  }

  private linkFailed(session: Session, edge: AlmEdge, error: unknown): void {
    if (this.sessions.get(session.root) !== session || !session.links.has(edge.id)) return
    const link = session.links.get(edge.id)!
    session.links.delete(edge.id)
    link.pc.close()
    this.deps.log('edge-failed', { edge: edge.id, error: String(error) })
    if (edge.child === this.deps.id()) this.fallback(session, error)
    // The child's watchdog reports failure to the coordinator. Other edges stay up.
  }

  private removeViewer(session: Session, id: string): void {
    if (!session.tree) return
    session.viewers.delete(id)
    session.playing.delete(id)
    this.deps.rtp(id, false)
    const detached = session.tree.remove(id)
    for (const child of detached) {
      session.playing.delete(child)
      this.deps.rtp(child, false)
      this.send(child, session, { kind: 'stop' })
    }
    for (const [key, old] of session.retired) if (old.edge.child === id || old.edge.parent === id) session.retired.delete(key)
    this.publish(session, id)
  }

  private fallback(session: Session, error: unknown): void {
    if (this.sessions.get(session.root) !== session) return
    this.deps.log('fallback', { root: session.root, error: String(error), audioFrames: session.audioFrames,
      videoAgeMs: Date.now() - session.lastFrame })
    this.send(session.root, session, { kind: 'fallback' })
    this.dispose(session)
  }

  private tick(): void {
    const now = Date.now()
    for (const session of this.sessions.values()) {
      if (session.tree) {
        for (const [viewer, seen] of session.viewers) {
          if (!this.deps.eligible(viewer, session.root) || now - seen > 30_000) this.removeViewer(session, viewer)
        }
        for (const [id, old] of session.retired) {
          if (now > old.until) {
            session.retired.delete(id)
            // A failed handoff falls back only the affected viewer.
            this.send(old.edge.child, session, { kind: 'stop' })
            this.removeViewer(session, old.edge.child)
          }
        }
      } else {
        if (!this.deps.watching(session.root) || !this.deps.eligible(session.root, session.root)) {
          this.send(session.root, session, { kind: 'leave' }); this.dispose(session); continue
        }
        if (now - session.lastRenew >= 10_000) { this.send(session.root, session, { kind: 'ready' }); session.lastRenew = now }
        if (session.audioSink && !session.audioSink.played && now - session.createdAt > 12_000) {
          this.fallback(session, new Error('Audio playback unavailable')); continue
        }
        if (now - session.lastFrame > 10_000) { this.fallback(session, new Error('No video received')); continue }
      }
      for (const link of session.links.values()) {
        if (link.channel?.readyState !== 'open' && now - link.openedAt > 12_000) this.linkFailed(session, link.edge, new Error('Channel timeout'))
      }
      const elapsed = Math.max(1, performance.now() - session.lastSample)
      session.lastSample = performance.now()
      const outgoing = [...session.links.values()].filter(link => link.edge.parent === this.deps.id())
      const incoming = [...session.links.values()].filter(link => link.edge.child === this.deps.id())
      for (const link of incoming) this.send(link.edge.parent, session, { kind: 'receipt', edge: link.edge.id, bytes: link.received, interval: elapsed })
      const rtts = outgoing.map(link => link.rttMs).filter((rtt): rtt is number => rtt !== null)
      const measured = session.capacity.observe({
        sentBps: outgoing.reduce((sum, link) => sum + link.sent, 0) * 8000 / elapsed,
        deliveredBps: outgoing.length && outgoing.every(link => link.deliveredBps !== null && now - link.receiptAt < 6000)
          ? outgoing.reduce((sum, link) => sum + link.deliveredBps!, 0) : null,
        bufferedBytes: outgoing.reduce((sum, link) => sum + (link.channel?.bufferedAmount ?? 0), 0),
        droppedFrames: outgoing.reduce((sum, link) => sum + link.blocked, 0),
        rttMs: rtts.length ? Math.max(...rtts) : null,
      }, outgoing.length)
      session.measured = measured
      for (const link of outgoing) {
        link.blocked = 0; link.sent = 0
        if (!link.statsPending && typeof link.pc.getStats === 'function') {
          link.statsPending = true
          void link.pc.getStats().then(stats => {
            stats.forEach(report => {
              if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated && typeof report.currentRoundTripTime === 'number')
                link.rttMs = report.currentRoundTripTime * 1000
            })
          }).catch(() => {}).finally(() => { link.statsPending = false })
        }
      }
      if (session.tree) {
        session.tree.report(session.root, measured.children, measured.deliveredBps, measured.rttMs)
        if (!session.retired.size && now - session.lastShed > 10_000 && session.tree.shed(session.root, measured.children)) {
          session.lastShed = now; this.publish(session)
        }
      } else this.send(session.root, session, { kind: 'capacity', ...measured })
    }
    this.pendingSignals = this.pendingSignals.filter(entry => now - entry.at < 5000)
    if (!this.sessions.size && this.timer) { clearInterval(this.timer); this.timer = null }
  }

  peerLeft(peer: string): void {
    for (const session of this.sessions.values()) {
      if (session.root === peer) this.dispose(session)
      else if (session.tree?.parents.has(peer)) this.removeViewer(session, peer)
    }
  }

  updateBitrate(bitrate: number): void {
    for (const session of this.sessions.values()) {
      const capture = session.capture
      if (!capture) continue
      const settings = capture.track.getSettings()
      const width = Math.max(2, Math.floor((settings.width || 1920) / 2) * 2)
      const height = Math.max(2, Math.floor((settings.height || 1080) / 2) * 2)
      const fps = settings.frameRate || capture.fps
      if (width !== session.config.codedWidth || height !== session.config.codedHeight || Math.abs(fps - capture.fps) >= 1) {
        void this.start(capture.track, bitrate, fps, capture.hardware, capture.audio)
        return
      }
      session.source?.updateBitrate(bitrate)
    }
  }

  describe(): Array<Record<string, unknown>> {
    return [...this.sessions.values()].map(session => ({
      root: session.root, codec: session.config.codec, role: session.tree ? 'source' : 'relay',
      revision: session.revision, edges: session.edges, input: session.input ?? null,
      temporalLayers: session.config.temporalLayers, svcObserved: session.source?.svcObserved,
      localTemporalLayer: session.localLayer, audio: !!session.audioConfig,
      ...session.clock.describe(), capacity: session.measured ?? null,
      links: [...session.links.values()].map(link => ({
        ...link.edge, state: link.pc.connectionState, bufferedBytes: link.channel?.bufferedAmount ?? 0,
        deliveredBps: link.deliveredBps, rttMs: link.rttMs,
      })),
    }))
  }

  stopSource(): void {
    this.generation++
    for (const session of this.sessions.values()) {
      if (!session.tree) continue
      for (const viewer of session.viewers.keys()) this.send(viewer, session, { kind: 'stop' })
      this.dispose(session)
    }
  }

  private dispose(session: Session): void {
    if (this.sessions.get(session.root) !== session) return
    this.sessions.delete(session.root)
    session.source?.close()
    session.audioSource?.close()
    session.clock.close()
    session.queue?.reset()
    session.audioQueue?.reset()
    session.sink?.close()
    session.audioSink?.close()
    for (const link of session.links.values()) link.pc.close()
    session.links.clear()
    if (session.tree) for (const viewer of session.playing) this.deps.rtp(viewer, false)
    else this.deps.stream(session.root, null)
  }

  close(): void {
    this.configuring.clear()
    this.stopSource()
    for (const session of this.sessions.values()) this.dispose(session)
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.pendingSignals = []
  }
}
