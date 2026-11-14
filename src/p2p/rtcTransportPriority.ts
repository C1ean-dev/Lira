import type Peer from 'peerjs'
import type { MediaConnection } from 'peerjs'
import { diagLog } from '../utils/diagnosticLogger'
import { selectVoiceRecoveryServers } from './voiceRecoveryServers'

export const DIRECT_ATTEMPT_MS = 1500
export const RELAY_ATTEMPT_MS = 3500
export const DEGRADED_UPGRADE_COOLDOWN_MS = 45000
export const MAX_DEGRADED_UPGRADES_PER_CALL = 1
export const VOICE_QUALITY_SAMPLE_MS = 10_000
const VOICE_LOSS_WINDOW_MS = 3 * VOICE_QUALITY_SAMPLE_MS
const VOICE_RELAY_TIMEOUT_MS = 15_000
const VOICE_RELAY_COOLDOWN_MS = 120_000
const VOICE_LOSS_THRESHOLD = 0.10
const VOICE_MIN_PACKETS = 50
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

type VoicePacketSample = { id: string; timestamp: number; packets: number; lost: number }
type VoiceDirection = 'inbound' | 'outbound'
type VoiceRouteBaseline = { direction: VoiceDirection; directLossPct: number; directRttMs?: number | null }
export type VoiceRouteSample = {
  pairId: string
  relayed: boolean
  rttMs?: number | null
  inbound?: VoicePacketSample
  outbound?: VoicePacketSample
}
const voiceRouteObservers = new WeakMap<MediaConnection, (sample?: VoiceRouteSample) => void>()

export function observeVoiceRoute(call: MediaConnection, sample?: VoiceRouteSample) {
  voiceRouteObservers.get(call)?.(sample)
}

function voiceLoss(before?: VoicePacketSample, after?: VoicePacketSample): number | undefined {
  if (!before || !after || before.id !== after.id || !(after.timestamp > before.timestamp)) return
  const packets = after.packets - before.packets
  const lost = after.lost - before.lost
  if (packets >= VOICE_MIN_PACKETS && lost <= packets) return Math.max(0, lost) / packets
}

// PeerJS 1.5 treats a second OFFER as a new connection, so ICE restarts must be
// routed to the existing PC. Keep that compatibility adapter in one place.
export function installRtcTransportPriority(peer: Peer, options: Options): Peer {
  const internal = peer as any
  if (typeof internal._addConnection !== 'function' || typeof internal._handleMessage !== 'function') return peer
  const sessions = new WeakMap<object, ReturnType<typeof attach>>()
  const voiceRetryAt = new Map<string, number>()
  const incomingVoiceRelays = new Map<string, { servers: RTCIceServer[]; tier: RelayTier; expiresAt: number }>()
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
    let lastOfferedTier: RelayTier | undefined
    let stopped = false
    let busy = false
    let answering = false
    let remoteReady = false
    let voiceAttempted = false
    let voiceTrial: { previousConfig: RTCConfiguration; baseline: VoiceRouteBaseline; timer?: ReturnType<typeof setTimeout> } | undefined
    let voiceComparison: { baseline: VoiceRouteBaseline; relay: VoiceRouteSample } | undefined
    const candidates: any[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    let degradedUpgradeCount = 0
    let lastDegradedUpgradeTime = 0
    const originator = !conn.options?._payload
    let supportsPriority = originator || conn.options?._payload?.liraIcePriorityVersion === 1
    const candidateHandler = pc.onicecandidate
    const tiers: RelayTier[] = ['cloudflare', 'metered']
    const alive = () => !stopped && pc.signalingState !== 'closed' && pc.connectionState !== 'closed'
    const iceConnected = () => ['connected', 'completed'].includes(pc.iceConnectionState)
    const connected = () => iceConnected() || pc.connectionState === 'connected'
    const clear = () => { clearTimeout(timer); timer = undefined }
    const schedule = (delay: number) => { clear(); if (originator && tier < 1 && alive()) timer = setTimeout(() => { void advance() }, delay) }
    const serversFor = async (next: RelayTier) => next === 'cloudflare' ? options.cloudflare() : options.metered
    const configure = (servers: RTCIceServer[], relayOnly = false) => {
      pc.setConfiguration({
        ...pc.getConfiguration(),
        iceServers: relayOnly ? servers : [...options.discovery, ...servers],
        iceTransportPolicy: relayOnly ? 'relay' : 'all',
      })
      // PeerJS stops forwarding candidates after ICE completes. A recovered
      // connection needs its candidate sender again for the new ICE generation.
      pc.onicecandidate = candidateHandler
    }
    // Older clients cannot renegotiate the same PeerJS connection. Preserve
    // their existing authenticated Metered behavior when they initiate a call.
    if (!supportsPriority) { tier = 1; configure(options.metered) }
    const savedRelay = incomingVoiceRelays.get(conn.peer)
    const pinnedVoiceRelay = conn.type === 'media' && savedRelay && savedRelay.expiresAt > Date.now() ? savedRelay : undefined
    if (savedRelay && savedRelay.expiresAt <= Date.now()) incomingVoiceRelays.delete(conn.peer)
    if (pinnedVoiceRelay) {
      tier = tiers.indexOf(pinnedVoiceRelay.tier)
      configure(pinnedVoiceRelay.servers, true)
    }
    const transform = (sdp: RTCSessionDescriptionInit) => {
      if (conn.options?.sdpTransform && sdp.sdp) sdp.sdp = conn.options.sdpTransform(sdp.sdp) || sdp.sdp
      return sdp
    }
    const send = (type: 'OFFER' | 'ANSWER', sdp: RTCSessionDescriptionInit, next: RelayTier, forceRelay = false) => {
      if (type === 'OFFER') lastOfferedTier = next
      peer.socket.send({ type, dst: conn.peer, payload: { sdp, type: conn.type, connectionId: conn.connectionId, liraIceRestart: next, ...(forceRelay ? { liraIceForceRelay: 1 } : {}) } } as any)
      diagLog('p2p', 'rtc.fallback-attempt', {
        peerId: conn.peer, connectionId: conn.connectionId, connectionType: conn.type,
        tier: next, role: type === 'OFFER' ? 'offerer' : 'answerer',
      }, `${conn.connectionId}:${next}`)
    }
    async function makeRestartOffer(servers: RTCIceServer[], relayOnly = false) {
      configure(servers, relayOnly)
      const offer = transform(await pc.createOffer({ iceRestart: true }))
      if (!alive()) return
      await pc.setLocalDescription(offer)
      if (alive()) return offer
    }
    const logVoiceRoute = (result: string, details: Record<string, unknown> = {}) => {
      diagLog('p2p', 'rtc.voice-route-recovery', {
        connectionId: conn.connectionId, peerId: conn.peer, result, ...details,
      }, `${conn.connectionId}:${result}`)
    }
    async function restoreVoiceRoute(result: string) {
      const trial = voiceTrial
      if (!trial) return
      clearTimeout(trial.timer)
      trial.timer = undefined
      try {
        if (!alive()) return
        if (pc.signalingState === 'have-local-offer') {
          await pc.setLocalDescription({ type: 'rollback' })
        }
        if (alive()) pc.setConfiguration(trial.previousConfig)
      } catch {
        if (alive()) conn.close()
        return
      } finally {
        voiceTrial = undefined
      }
      logVoiceRoute(result)
      if (alive() && (!iceConnected() || pc.connectionState === 'failed')) {
        conn.close()
      }
    }
    async function tryVoiceRelay(baseline: VoiceRouteBaseline) {
      if (busy || voiceAttempted || !alive() || (originator && !supportsPriority) || !iceConnected() ||
          Date.now() < (voiceRetryAt.get(conn.peer) ?? 0) ||
          !pc.remoteDescription || pc.signalingState !== 'stable') return
      voiceAttempted = true
      // The original offerer can restart ICE in place. The answering endpoint
      // instead pins TURN for a normal replacement call to support older peers.
      const firstTier = lastOfferedTier ?? 'cloudflare'
      for (let index = tiers.indexOf(firstTier); index < tiers.length; index++) {
        const next = tiers[index]
        const servers = selectVoiceRecoveryServers(await serversFor(next).catch(() => []))
        if (!alive() || busy || !iceConnected() || pc.signalingState !== 'stable' ||
            Date.now() < (voiceRetryAt.get(conn.peer) ?? 0) ||
            (lastOfferedTier && index < tiers.indexOf(lastOfferedTier))) return
        if (!servers.length) continue
        const now = Date.now()
        for (const [peerId, retryAt] of voiceRetryAt) {
          if (retryAt <= now) voiceRetryAt.delete(peerId)
        }
        voiceRetryAt.set(conn.peer, now + VOICE_RELAY_COOLDOWN_MS)
        clear()
        try {
          if (!originator) {
            // The original caller may not accept reversed restart offers. Use a
            // normal replacement call with TURN in its initial ICE generation.
            incomingVoiceRelays.set(conn.peer, { servers, tier: next, expiresAt: now + VOICE_RELAY_COOLDOWN_MS })
            logVoiceRoute('redial-relay', { tier: next, ...baseline })
            conn.close()
            return
          }
          const trial: NonNullable<typeof voiceTrial> = { previousConfig: pc.getConfiguration(), baseline }
          voiceTrial = trial
          const offer = await makeRestartOffer(servers, true)
          if (!offer) return
          tier = index
          trial.timer = setTimeout(() => { void restoreVoiceRoute('relay-not-selected') }, VOICE_RELAY_TIMEOUT_MS)
          send('OFFER', offer, next)
          logVoiceRoute('attempt', { tier: next, ...baseline })
        } catch {
          await restoreVoiceRoute('restart-failed')
        }
        return
      }
      logVoiceRoute('relay-unavailable')
    }

    if (conn.type === 'media') {
      let previous: VoiceRouteSample | undefined
      let previousAt = 0
      const lossSince: Record<VoiceDirection, number | undefined> = { inbound: undefined, outbound: undefined }
      voiceRouteObservers.set(conn, (sample) => {
        if (voiceComparison) {
          const { baseline, relay } = voiceComparison
          if (sample?.pairId === relay.pairId && sample.relayed) {
            const loss = voiceLoss(relay[baseline.direction], sample[baseline.direction])
            if (loss !== undefined) {
              logVoiceRoute('relay-quality', { ...baseline, relayLossPct: Math.round(100 * loss), relayRttMs: sample.rttMs })
            }
          }
          voiceComparison = undefined
        }
        if (voiceTrial?.timer && sample?.relayed) {
          clearTimeout(voiceTrial.timer)
          voiceComparison = { baseline: voiceTrial.baseline, relay: sample }
          voiceTrial = undefined
          logVoiceRoute('relay-selected')
        }
        if (voiceAttempted || (originator && !supportsPriority)) return
        const now = Date.now()
        const sameRoute = iceConnected() && sample && !sample.relayed && previous?.pairId === sample.pairId
          && now - previousAt <= 1.5 * VOICE_QUALITY_SAMPLE_MS
        for (const direction of ['inbound', 'outbound'] as const) {
          const loss = (sameRoute ? voiceLoss(previous?.[direction], sample[direction]) : undefined) ?? 0
          if (loss >= VOICE_LOSS_THRESHOLD) {
            lossSince[direction] ??= previousAt
            if (now - lossSince[direction] >= VOICE_LOSS_WINDOW_MS) {
              void tryVoiceRelay({ direction, directLossPct: Math.round(100 * loss), directRttMs: sample?.rttMs })
            }
          } else {
            lossSince[direction] = undefined
          }
        }
        previous = iceConnected() && !sample?.relayed ? sample : undefined
        previousAt = now
      })
    }

    async function advance(forceDegraded = false) {
      if (!alive() || busy) return
      if (!forceDegraded && (voiceTrial || !originator || !supportsPriority || connected())) return
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
          const offer = await makeRestartOffer(servers, forceDegraded || !!pinnedVoiceRelay)
          if (!offer) return
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
        configure(servers, isForceRelay || !!pinnedVoiceRelay)
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
      const failed = pc.iceConnectionState === 'failed' || pc.connectionState === 'failed'
      if (failed && pinnedVoiceRelay && incomingVoiceRelays.get(conn.peer) === pinnedVoiceRelay) {
        incomingVoiceRelays.delete(conn.peer)
        logVoiceRoute('redial-relay-failed')
      }
      const disconnected = pc.iceConnectionState === 'disconnected' || pc.connectionState === 'disconnected'
      if (voiceTrial && (failed || disconnected)) {
        event.stopImmediatePropagation()
        return
      }
      if (connected()) { clear(); return }
      if (!supportsPriority || !((failed || disconnected) && tier < 1 || failed && busy)) return
      event.stopImmediatePropagation()
      diagLog('p2p', 'rtc.fallback-trigger', {
        peerId: conn.peer, connectionId: conn.connectionId, connectionType: conn.type,
        role: originator ? 'offerer' : 'answerer',
        iceState: pc.iceConnectionState, connectionState: pc.connectionState, signalingState: pc.signalingState,
      }, conn.connectionId)
      if (originator) void advance()
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
      clearTimeout(voiceTrial?.timer)
      voiceTrial = undefined
      voiceRouteObservers.delete(conn)
      pc.removeEventListener('iceconnectionstatechange', state, true)
      pc.removeEventListener('connectionstatechange', state, true)
      pc.removeEventListener('signalingstatechange', signaling)
    })
    schedule(DIRECT_ATTEMPT_MS)
    return {
      answer,
      forceDegradedUpgrade,
      expectsRestartAnswer: (next: RelayTier) =>
        pc.signalingState === 'have-local-offer' &&
        next === lastOfferedTier &&
        (!voiceTrial || !!voiceTrial.timer),
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
    if (message?.type === 'ANSWER') {
      const conn = peer.getConnection(message.src, payload?.connectionId)
      const session = conn && sessions.get(conn)
      if (payload?.liraIceRestart) {
        if (session && !session.expectsRestartAnswer(payload.liraIceRestart)) return
      } else {
        session?.setRemoteSupport(payload?.liraIcePriorityVersion === 1)
      }
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
