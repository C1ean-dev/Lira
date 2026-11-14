import type Peer from 'peerjs'

export const DIRECT_ATTEMPT_MS = 1500
export const RELAY_ATTEMPT_MS = 3500
export const DEGRADED_UPGRADE_COOLDOWN_MS = 45000
export const MAX_DEGRADED_UPGRADES_PER_CALL = 1
type RelayTier = 'cloudflare' | 'metered'
type Options = { cloudflare: () => Promise<RTCIceServer[]>; metered: RTCIceServer[]; discovery: RTCIceServer[] }

export async function forceDegradedUpgrade(target: any, reason: string): Promise<boolean> {
  if (!target) return false
  if (typeof target.forceDegradedUpgrade === 'function') {
    return target.forceDegradedUpgrade(reason)
  }
  if (target.peerConnection && typeof target.peerConnection.forceDegradedUpgrade === 'function') {
    return target.peerConnection.forceDegradedUpgrade(reason)
  }
  return false
}

// PeerJS 1.5 treats a second OFFER as a new connection, so ICE restarts must be
// routed to the existing PC. Keep that compatibility adapter in one place.
export function installRtcTransportPriority(peer: Peer, options: Options): Peer {
  const internal = peer as any
  if (typeof internal._addConnection !== 'function' || typeof internal._handleMessage !== 'function') return peer
  const sessions = new WeakMap<object, ReturnType<typeof attach>>()
  const add = internal._addConnection.bind(peer)
  const handle = internal._handleMessage.bind(peer)
  const signal = peer.socket.send.bind(peer.socket)
  peer.socket.send = (message: any) => {
    if (message?.type === 'OFFER' || message?.type === 'ANSWER') {
      message = { ...message, payload: { ...message.payload, liraIcePriorityVersion: 1 } }
    }
    return signal(message)
  }

  function attach(conn: any) {
    const candidatePc = conn.peerConnection as RTCPeerConnection | undefined
    if (!candidatePc?.addEventListener || !candidatePc.setConfiguration) return undefined
    const pc: RTCPeerConnection = candidatePc
    let tier = -1
    let stopped = false
    let busy = false
    let answering = false
    let remoteReady = false
    const candidates: any[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let degradedUpgradeCount = 0
    let lastDegradedUpgradeTime = 0
    const originator = !conn.options?._payload
    let supportsPriority = originator || conn.options?._payload?.liraIcePriorityVersion === 1
    const candidateHandler = pc.onicecandidate
    const tiers: RelayTier[] = ['cloudflare', 'metered']
    const alive = () => !stopped && pc.signalingState !== 'closed' && pc.connectionState !== 'closed'
    const connected = () => ['connected', 'completed'].includes(pc.iceConnectionState) || pc.connectionState === 'connected'
    const clear = () => { clearTimeout(timer); timer = undefined }
    const schedule = (delay: number) => { clear(); if (originator && tier < 1 && alive()) timer = setTimeout(() => { void advance() }, delay) }
    const serversFor = async (next: RelayTier) => next === 'cloudflare' ? options.cloudflare() : options.metered
    const configure = (servers: RTCIceServer[], forceRelayOnly = false) => {
      pc.setConfiguration({ ...pc.getConfiguration(), iceServers: [...options.discovery, ...servers], iceTransportPolicy: forceRelayOnly ? 'relay' : 'all' })
      // PeerJS stops forwarding candidates after ICE completes. A recovered
      // connection needs its candidate sender again for the new ICE generation.
      pc.onicecandidate = candidateHandler
    }
    // Older clients cannot renegotiate the same PeerJS connection. Preserve
    // their existing authenticated Metered behavior when they initiate a call.
    if (!supportsPriority) { tier = 1; configure(options.metered) }
    const transform = (sdp: RTCSessionDescriptionInit) => {
      if (conn.options?.sdpTransform && sdp.sdp) sdp.sdp = conn.options.sdpTransform(sdp.sdp) || sdp.sdp
      return sdp
    }
    const send = (type: 'OFFER' | 'ANSWER', sdp: RTCSessionDescriptionInit, next: RelayTier, forceRelay = false) => {
      peer.socket.send({ type, dst: conn.peer, payload: { sdp, type: conn.type, connectionId: conn.connectionId, liraIceRestart: next, ...(forceRelay ? { liraIceForceRelay: 1 } : {}) } } as any)
    }
    async function advance(forceDegraded = false) {
      if (!alive() || busy || !originator || !supportsPriority) return
      if (!forceDegraded && connected()) return
      // Restart only after the previous offer/answer has completed; otherwise
      // a delayed initial answer could be applied to a new ICE generation.
      if (!pc.remoteDescription || pc.signalingState !== 'stable') { schedule(250); return }
      busy = true
      clear()
      try {
        while (++tier < tiers.length) {
          const next = tiers[tier]
          const servers = await serversFor(next)
          if (!alive()) return
          if (!forceDegraded && connected()) return
          if (!servers.length) continue
          configure(servers, forceDegraded)
          const offer = transform(await pc.createOffer({ iceRestart: true }))
          if (!alive()) return
          await pc.setLocalDescription(offer)
          if (!alive()) return
          send('OFFER', offer, next, forceDegraded)
          schedule(RELAY_ATTEMPT_MS)
          return
        }
        // Propagate a failure deferred while checking unavailable providers.
        if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') conn.close()
      } catch {
        if (alive() && tier < 1) schedule(0)
        else if (alive()) conn.close()
      } finally { busy = false }
    }
    async function forceDegradedUpgrade(reason: string): Promise<boolean> {
      if (!alive() || busy) return false
      const now = Date.now()
      if (degradedUpgradeCount >= MAX_DEGRADED_UPGRADES_PER_CALL) {
        return false
      }
      if (now - lastDegradedUpgradeTime < DEGRADED_UPGRADE_COOLDOWN_MS) {
        return false
      }
      degradedUpgradeCount++
      lastDegradedUpgradeTime = now
      console.log(`[RTCTransportPriority] Executando upgrade forçado para relay (Cloudflare TURN): ${reason}`)
      if (!originator) {
        peer.socket.send({
          type: 'CANDIDATE',
          dst: conn.peer,
          payload: { connectionId: conn.connectionId, liraRestartRequest: true, reason },
        } as any)
        return true
      }
      if (tier < 0) tier = -1
      await advance(true)
      return true
    }
    ;(pc as any).forceDegradedUpgrade = forceDegradedUpgrade
    ;(conn as any).forceDegradedUpgrade = forceDegradedUpgrade

    async function answer(payload: any) {
      const isForceRelay = payload?.liraIceForceRelay === 1
      if (!alive() || answering || !payload.sdp || payload.sdp.type !== 'offer') return
      if (originator && !isForceRelay) return
      const next = payload.liraIceRestart as RelayTier
      const index = tiers.indexOf(next)
      if (index < tier && !isForceRelay) return
      tier = index
      answering = true
      remoteReady = false
      try {
        const servers = await serversFor(next)
        if (!alive()) return
        configure(servers, isForceRelay)
        await pc.setRemoteDescription(payload.sdp)
        if (!alive()) return
        remoteReady = true
        candidates.splice(0).forEach(message => handle(message))
        const sdp = transform(await pc.createAnswer())
        if (!alive()) return
        await pc.setLocalDescription(sdp)
        if (alive()) send('ANSWER', sdp, next, isForceRelay)
      } catch { if (alive()) conn.close() }
      finally { answering = false; candidates.length = 0 }
    }
    const state = (event: Event) => {
      if (!alive()) { clear(); return }
      if (connected()) { clear(); return }
      if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') {
        if (supportsPriority && (tier < 1 || busy)) {
          event.stopImmediatePropagation()
          if (originator) void advance()
        }
      } else if (pc.iceConnectionState === 'disconnected' || pc.connectionState === 'disconnected') {
        if (supportsPriority && tier < 1) { event.stopImmediatePropagation(); if (originator) void advance() }
      }
    }
    const signaling = () => {
      // Give each transport a full attempt after its answer arrives, even when
      // signaling or credential issuance consumed the earlier deadline.
      if (pc.signalingState === 'stable' && pc.remoteDescription && !connected()) {
        schedule(tier < 0 ? DIRECT_ATTEMPT_MS : RELAY_ATTEMPT_MS)
      }
    }
    pc.addEventListener('iceconnectionstatechange', state, true)
    pc.addEventListener('connectionstatechange', state, true)
    pc.addEventListener('signalingstatechange', signaling)
    conn.on('close', () => {
      stopped = true; clear()
      pc.removeEventListener('iceconnectionstatechange', state, true)
      pc.removeEventListener('connectionstatechange', state, true)
      pc.removeEventListener('signalingstatechange', signaling)
    })
    schedule(DIRECT_ATTEMPT_MS)
    return {
      answer,
      forceDegradedUpgrade,
      setRemoteSupport: (supported: boolean) => { supportsPriority = supported; if (!supported) clear() },
      queueCandidate: (message: any) => {
        if (!answering || remoteReady) return false
        // Bound untrusted signaling while credentials are being fetched.
        if (candidates.length < 256) candidates.push(message)
        return true
      },
    }
  }

  function prepare(conn: any) {
    if (sessions.has(conn)) return
    if (conn.peerConnection) { sessions.set(conn, attach(conn)); return }
    // An incoming media connection creates its PC only when answer() is called.
    if (typeof conn.answer === 'function') {
      const answer = conn.answer.bind(conn)
      conn.answer = (...args: any[]) => { const result = answer(...args); sessions.set(conn, attach(conn)); return result }
    }
  }
  internal._addConnection = (id: string, conn: any) => { add(id, conn); prepare(conn) }
  internal._handleMessage = (message: any) => {
    const payload = message?.payload
    if (message?.type === 'ANSWER' && !payload?.liraIceRestart) {
      const conn = peer.getConnection(message.src, payload?.connectionId)
      if (conn) sessions.get(conn)?.setRemoteSupport(payload?.liraIcePriorityVersion === 1)
    }
    if (message?.type === 'CANDIDATE' && payload?.liraRestartRequest) {
      const conn = peer.getConnection(message.src, payload?.connectionId)
      const session = conn && sessions.get(conn)
      if (session) {
        void session.forceDegradedUpgrade(payload?.reason || 'remote_restart_request')
      }
      return
    }
    if (message?.type === 'CANDIDATE') {
      const conn = peer.getConnection(message.src, payload?.connectionId)
      if (conn && sessions.get(conn)?.queueCandidate(message)) return
    }
    if (message?.type === 'OFFER' && ['cloudflare', 'metered'].includes(payload?.liraIceRestart)) {
      const conn = peer.getConnection(message.src, payload.connectionId)
      const session = conn && sessions.get(conn)
      if (session) return session.answer(payload)
      // A delayed restart must never recreate a connection already closed.
      return
    }
    return handle(message)
  }
  return peer
}
