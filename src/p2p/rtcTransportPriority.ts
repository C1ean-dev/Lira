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
const MANUAL_SWITCH_TIMEOUT_MS = 8_000
const VOICE_LOSS_THRESHOLD = 0.10
const VOICE_MIN_PACKETS = 50
export type RelayTier = 'cloudflare' | 'metered'
type RestartTier = 'direct' | RelayTier
export type ManualTransportMode = 'direct' | 'turn'
export type ConnectionTransportInfo = {
  mode: ManualTransportMode
  relayTier?: RelayTier
  manualOverride?: ManualTransportMode
  switching: boolean
}
export type ManualTransportSwitchResult = {
  ok: boolean
  relayTier?: RelayTier
  reason?: string
}
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

export async function switchConnectionTransport(
  target: any,
  mode: ManualTransportMode,
  reason = 'manual_user_switch'
): Promise<ManualTransportSwitchResult> {
  if (!target) return { ok: false, reason: 'no_connection' }
  if (typeof target.switchTransport === 'function') {
    return target.switchTransport(mode, reason)
  }
  if (target.peerConnection && typeof target.peerConnection.switchTransport === 'function') {
    return target.peerConnection.switchTransport(mode, reason)
  }
  return { ok: false, reason: 'unsupported' }
}

export function setConnectionTransportAuto(target: any): boolean {
  if (!target) return false
  if (typeof target.setTransportAuto === 'function') {
    target.setTransportAuto()
    return true
  }
  if (target.peerConnection && typeof target.peerConnection.setTransportAuto === 'function') {
    target.peerConnection.setTransportAuto()
    return true
  }
  return false
}

export function pinConnectionTransportMode(target: any, mode: ManualTransportMode): boolean {
  if (!target) return false
  if (typeof target.pinTransportMode === 'function') {
    target.pinTransportMode(mode)
    return true
  }
  if (target.peerConnection && typeof target.peerConnection.pinTransportMode === 'function') {
    target.peerConnection.pinTransportMode(mode)
    return true
  }
  return false
}

export function getConnectionTransportInfo(target: any): ConnectionTransportInfo | null {
  if (!target) return null
  if (typeof target.getTransportInfo === 'function') {
    return target.getTransportInfo()
  }
  if (target.peerConnection && typeof target.peerConnection.getTransportInfo === 'function') {
    return target.peerConnection.getTransportInfo()
  }
  return null
}

type PeerManualTransportEntry =
  | { mode: 'direct' }
  | { mode: 'turn'; servers: RTCIceServer[]; tier: RelayTier }

type PeerTransportController = {
  prepareManualTransport: (peerId: string, mode: 'auto' | ManualTransportMode) => Promise<ManualTransportSwitchResult>
  clearManualTransport: (peerId: string) => void
  notifyRemoteClearManualTransport: (peerId: string, connectionId: string) => void
}

const peerControllers = new WeakMap<Peer, PeerTransportController>()

export async function preparePeerManualTransport(
  peer: Peer | null | undefined,
  peerId: string,
  mode: 'auto' | ManualTransportMode
): Promise<ManualTransportSwitchResult> {
  if (!peer) return { ok: false, reason: 'no_peer' }
  const controller = peerControllers.get(peer)
  if (!controller) return { ok: false, reason: 'unsupported' }
  return controller.prepareManualTransport(peerId, mode)
}

export function clearPeerManualTransport(peer: Peer | null | undefined, peerId: string): void {
  if (!peer) return
  peerControllers.get(peer)?.clearManualTransport(peerId)
}

export function notifyRemoteClearManualTransport(
  peer: Peer | null | undefined,
  peerId: string,
  connectionId: string
): void {
  if (!peer) return
  peerControllers.get(peer)?.notifyRemoteClearManualTransport(peerId, connectionId)
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
  const peerManualTransports = new Map<string, PeerManualTransportEntry>()
  const tiers: RelayTier[] = ['cloudflare', 'metered']
  const loadServersForTier = async (next: RelayTier) => next === 'cloudflare' ? options.cloudflare() : options.metered
  const add = internal._addConnection.bind(peer)
  const handle = internal._handleMessage.bind(peer)
  const signal = peer.socket.send.bind(peer.socket)
  peer.socket.send = (message: any) => {
    if (message?.type === 'OFFER' || message?.type === 'ANSWER') {
      message = { ...message, payload: { ...message.payload, liraIcePriorityVersion: 1 } }
    }
    return signal(message)
  }

  function configForPeer(peerId: string): RTCConfiguration | undefined {
    const base = internal.options?.config
    if (!base) return undefined
    const manual = peerManualTransports.get(peerId)
    if (manual?.mode === 'turn') {
      return { ...base, iceServers: manual.servers, iceTransportPolicy: 'relay' }
    }
    if (manual?.mode === 'direct') {
      return { ...base, iceServers: options.discovery, iceTransportPolicy: 'all' }
    }
    const savedRelay = incomingVoiceRelays.get(peerId)
    if (savedRelay && savedRelay.expiresAt > Date.now()) {
      return { ...base, iceServers: savedRelay.servers, iceTransportPolicy: 'relay' }
    }
    return undefined
  }

  if (typeof peer.call === 'function') {
    const origCall = peer.call.bind(peer)
    peer.call = ((remoteId: string, stream: MediaStream, callOptions?: any) => {
      const override = configForPeer(remoteId)
      if (!override || !internal.options) return origCall(remoteId, stream, callOptions)
      const previous = internal.options.config
      internal.options.config = override
      try {
        return origCall(remoteId, stream, callOptions)
      } finally {
        internal.options.config = previous
      }
    }) as typeof peer.call
  }

  peerControllers.set(peer, {
    prepareManualTransport: async (peerId, mode) => {
      if (mode === 'auto') {
        peerManualTransports.delete(peerId)
        incomingVoiceRelays.delete(peerId)
        return { ok: true }
      }
      if (mode === 'direct') {
        incomingVoiceRelays.delete(peerId)
        peerManualTransports.set(peerId, { mode: 'direct' })
        return { ok: true }
      }
      for (const next of tiers) {
        const servers = await loadServersForTier(next).catch(() => [])
        if (servers.length) {
          peerManualTransports.set(peerId, { mode: 'turn', servers, tier: next })
          return { ok: true, relayTier: next }
        }
      }
      return { ok: false, reason: 'no_turn_servers' }
    },
    clearManualTransport: (peerId) => {
      peerManualTransports.delete(peerId)
      incomingVoiceRelays.delete(peerId)
    },
    notifyRemoteClearManualTransport: (peerId, connectionId) => {
      peer.socket.send({
        type: 'CANDIDATE',
        dst: peerId,
        payload: { connectionId, liraClearManualTransport: 1 },
      } as any)
    },
  })

  function attach(conn: any) {
    const candidatePc = conn.peerConnection as RTCPeerConnection | undefined
    if (!candidatePc?.addEventListener || !candidatePc.setConfiguration) return undefined
    const pc: RTCPeerConnection = candidatePc
    let tier = -1
    let lastOfferedTier: RestartTier | undefined
    let activeRelayTier: RelayTier | undefined
    let manualOverride: ManualTransportMode | undefined
    let switching = false
    let manualSwitchTimer: ReturnType<typeof setTimeout> | undefined
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
    let everConnected = false
    const attachedAt = Date.now()
    const originator = !conn.options?._payload
    let supportsPriority = originator || conn.options?._payload?.liraIcePriorityVersion === 1
    const candidateHandler = pc.onicecandidate
    const tiers: RelayTier[] = ['cloudflare', 'metered']
    const alive = () => !stopped && pc.signalingState !== 'closed' && pc.connectionState !== 'closed'
    const iceConnected = () => ['connected', 'completed'].includes(pc.iceConnectionState)
    const connected = () => iceConnected() || pc.connectionState === 'connected'
    const clear = () => { clearTimeout(timer); timer = undefined }
    const clearManualSwitchTimer = () => { clearTimeout(manualSwitchTimer); manualSwitchTimer = undefined }
    const finishManualSwitch = () => { clearManualSwitchTimer(); switching = false }
    const armManualSwitchTimer = () => {
      clearManualSwitchTimer()
      manualSwitchTimer = setTimeout(() => { switching = false; manualSwitchTimer = undefined }, MANUAL_SWITCH_TIMEOUT_MS)
    }
    const schedule = (delay: number) => {
      clear()
      if (manualOverride === 'direct') return
      if (originator && tier < 1 && alive()) timer = setTimeout(() => { void advance() }, delay)
    }
    const serversFor = async (next: RelayTier) => next === 'cloudflare' ? options.cloudflare() : options.metered
    const configure = (servers: RTCIceServer[], relayOnly = false) => {
      const forceRelay = relayOnly && servers.length > 0
      pc.setConfiguration({
        ...pc.getConfiguration(),
        iceServers: forceRelay ? servers : [...options.discovery, ...servers],
        iceTransportPolicy: forceRelay ? 'relay' : 'all',
      })
      // PeerJS stops forwarding candidates after ICE completes. A recovered
      // connection needs its candidate sender again for the new ICE generation.
      pc.onicecandidate = candidateHandler
    }
    // Older clients cannot renegotiate the same PeerJS connection. Preserve
    // their existing authenticated Metered behavior when they initiate a call.
    if (!supportsPriority) { tier = 1; activeRelayTier = 'metered'; configure(options.metered) }
    const manualPref = conn.type === 'media' ? peerManualTransports.get(conn.peer) : undefined
    const savedRelay = incomingVoiceRelays.get(conn.peer)
    const pinnedVoiceRelay = conn.type === 'media' && !manualPref && savedRelay && savedRelay.expiresAt > Date.now() ? savedRelay : undefined
    if (savedRelay && savedRelay.expiresAt <= Date.now()) incomingVoiceRelays.delete(conn.peer)
    if (manualPref?.mode === 'turn') {
      tier = tiers.indexOf(manualPref.tier)
      activeRelayTier = manualPref.tier
      manualOverride = 'turn'
      if (!connected()) {
        switching = true
        armManualSwitchTimer()
      }
      configure(manualPref.servers, true)
    } else if (manualPref?.mode === 'direct') {
      tier = -1
      activeRelayTier = undefined
      manualOverride = 'direct'
      if (!connected()) {
        switching = true
        armManualSwitchTimer()
      }
      configure([], false)
    } else if (pinnedVoiceRelay) {
      tier = tiers.indexOf(pinnedVoiceRelay.tier)
      activeRelayTier = pinnedVoiceRelay.tier
      configure(pinnedVoiceRelay.servers, true)
    }
    const transform = (sdp: RTCSessionDescriptionInit) => {
      if (conn.options?.sdpTransform && sdp.sdp) sdp.sdp = conn.options.sdpTransform(sdp.sdp) || sdp.sdp
      return sdp
    }
    const send = (
      type: 'OFFER' | 'ANSWER',
      sdp: RTCSessionDescriptionInit,
      next: RestartTier,
      forceRelay = false,
      manualMode?: ManualTransportMode
    ) => {
      if (type === 'OFFER') lastOfferedTier = next
      peer.socket.send({
        type,
        dst: conn.peer,
        payload: {
          sdp,
          type: conn.type,
          connectionId: conn.connectionId,
          liraIceRestart: next,
          ...(forceRelay ? { liraIceForceRelay: 1 } : {}),
          ...(manualMode ? { liraManualTransport: manualMode } : {}),
        },
      } as any)
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
      const isManualDirect = () => manualOverride === 'direct'
      if (isManualDirect() || busy || voiceAttempted || !alive() || (originator && !supportsPriority) || !iceConnected() ||
          Date.now() < (voiceRetryAt.get(conn.peer) ?? 0) ||
          !pc.remoteDescription || pc.signalingState !== 'stable') return
      voiceAttempted = true
      // The original offerer can restart ICE in place. The answering endpoint
      // instead pins TURN for a normal replacement call to support older peers.
      const firstTier: RelayTier = lastOfferedTier && lastOfferedTier !== 'direct' ? lastOfferedTier : 'cloudflare'
      for (let index = tiers.indexOf(firstTier); index < tiers.length; index++) {
        const next = tiers[index]
        const servers = selectVoiceRecoveryServers(await serversFor(next).catch(() => []))
        if (isManualDirect() || !alive() || busy || !iceConnected() || pc.signalingState !== 'stable' ||
            Date.now() < (voiceRetryAt.get(conn.peer) ?? 0) ||
            (lastOfferedTier && lastOfferedTier !== 'direct' && index < tiers.indexOf(lastOfferedTier))) return
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
          activeRelayTier = next
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
        if (manualOverride === 'direct' || voiceAttempted || (originator && !supportsPriority)) return
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

    const releasePinnedVoiceRelay = () => {
      if (pinnedVoiceRelay && incomingVoiceRelays.get(conn.peer) === pinnedVoiceRelay) {
        incomingVoiceRelays.delete(conn.peer)
        logVoiceRoute('redial-relay-failed')
      }
    }

    async function advance(forceDegraded = false): Promise<boolean> {
      if (!alive() || busy) return false
      if (!forceDegraded && (voiceTrial || !originator || !supportsPriority || connected())) return false
      // Restart only after the previous offer/answer has completed; otherwise
      // a delayed initial answer could be applied to a new ICE generation.
      if (!pc.remoteDescription || pc.signalingState !== 'stable') { schedule(250); return false }
      busy = true
      clear()
      try {
        while (++tier < tiers.length) {
          const next = tiers[tier]
          const rawServers = await serversFor(next).catch(() => [])
          const servers = forceDegraded ? selectVoiceRecoveryServers(rawServers) : rawServers
          if (!alive()) return false
          if (!forceDegraded && connected()) return false
          if (!servers.length) continue
          const relayOnly = forceDegraded || !!pinnedVoiceRelay || manualOverride === 'turn'
          const offer = await makeRestartOffer(servers, relayOnly)
          if (!offer) return false
          activeRelayTier = next
          send('OFFER', offer, next, relayOnly, manualOverride === 'turn' ? 'turn' : undefined)
          schedule(RELAY_ATTEMPT_MS)
          return true
        }
        // Propagate a failure deferred while checking unavailable providers.
        if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') conn.close()
        return false
      } catch {
        if (alive() && tier < 1) schedule(0)
        else if (alive()) conn.close()
        return false
      } finally { busy = false }
    }
    async function forceDegradedUpgrade(reason: string): Promise<boolean> {
      if (!alive() || busy || manualOverride === 'direct') return false
      const now = Date.now()
      if (degradedUpgradeCount >= MAX_DEGRADED_UPGRADES_PER_CALL) {
        return false
      }
      if (now - lastDegradedUpgradeTime < DEGRADED_UPGRADE_COOLDOWN_MS) {
        return false
      }
      console.log(`[RTCTransportPriority] Executando upgrade forçado para relay (Cloudflare TURN): ${reason}`)
      if (!originator) {
        degradedUpgradeCount++
        lastDegradedUpgradeTime = now
        peer.socket.send({
          type: 'CANDIDATE',
          dst: conn.peer,
          payload: { connectionId: conn.connectionId, liraRestartRequest: true, reason },
        } as any)
        return true
      }
      if (tier < 0) tier = -1
      const sent = await advance(true)
      lastDegradedUpgradeTime = now
      if (sent) degradedUpgradeCount++
      return sent
    }

    async function switchTransport(
      mode: ManualTransportMode,
      reason = 'manual_user_switch'
    ): Promise<ManualTransportSwitchResult> {
      if (!alive()) return { ok: false, reason: 'closed' }
      if (busy || answering) return { ok: false, reason: 'busy' }
      if (originator && !supportsPriority) return { ok: false, reason: 'peer_unsupported' }

      clear()
      if (voiceTrial) {
        clearTimeout(voiceTrial.timer)
        voiceTrial = undefined
      }

      if (!originator) {
        manualOverride = mode
        switching = true
        armManualSwitchTimer()
        if (mode === 'direct') {
          incomingVoiceRelays.delete(conn.peer)
          peer.socket.send({
            type: 'CANDIDATE',
            dst: conn.peer,
            payload: { connectionId: conn.connectionId, liraTransportSwitchRequest: 'direct', reason },
          } as any)
        } else {
          peer.socket.send({
            type: 'CANDIDATE',
            dst: conn.peer,
            payload: { connectionId: conn.connectionId, liraRestartRequest: true, liraTargetTransport: 'turn', reason },
          } as any)
        }
        diagLog('p2p', 'rtc.manual-transport-switch', {
          peerId: conn.peer, connectionId: conn.connectionId, target: mode, role: 'answerer', reason,
        })
        return { ok: true }
      }

      if (!pc.remoteDescription || pc.signalingState !== 'stable') {
        return { ok: false, reason: 'not_ready' }
      }

      busy = true
      switching = true
      armManualSwitchTimer()
      try {
        if (mode === 'direct') {
          incomingVoiceRelays.delete(conn.peer)
          const offer = await makeRestartOffer([], false)
          if (!offer) {
            finishManualSwitch()
            return { ok: false, reason: 'closed' }
          }
          tier = -1
          activeRelayTier = undefined
          manualOverride = 'direct'
          send('OFFER', offer, 'direct', false, 'direct')
          diagLog('p2p', 'rtc.manual-transport-switch', {
            peerId: conn.peer, connectionId: conn.connectionId, target: 'direct', role: 'offerer', reason,
          })
          return { ok: true }
        }

        for (let index = 0; index < tiers.length; index++) {
          const next = tiers[index]
          const servers = await serversFor(next).catch(() => [])
          if (!alive()) {
            finishManualSwitch()
            return { ok: false, reason: 'closed' }
          }
          if (!servers.length) continue
          const offer = await makeRestartOffer(servers, true)
          if (!offer) {
            finishManualSwitch()
            return { ok: false, reason: 'closed' }
          }
          tier = index
          activeRelayTier = next
          manualOverride = 'turn'
          send('OFFER', offer, next, true, 'turn')
          if (index < tiers.length - 1) schedule(RELAY_ATTEMPT_MS)
          diagLog('p2p', 'rtc.manual-transport-switch', {
            peerId: conn.peer, connectionId: conn.connectionId, target: 'turn', tier: next, role: 'offerer', reason,
          })
          return { ok: true, relayTier: next }
        }

        finishManualSwitch()
        return { ok: false, reason: 'no_turn_servers' }
      } catch {
        finishManualSwitch()
        return { ok: false, reason: 'restart_failed' }
      } finally {
        busy = false
      }
    }

    function setTransportAuto() {
      manualOverride = undefined
    }

    function pinTransportMode(mode: ManualTransportMode) {
      manualOverride = mode
      if (mode === 'direct') {
        clear()
        incomingVoiceRelays.delete(conn.peer)
      }
    }

    function getTransportInfo(): ConnectionTransportInfo {
      const policy = pc.getConfiguration?.()?.iceTransportPolicy
      return {
        mode: activeRelayTier || policy === 'relay' ? 'turn' : 'direct',
        relayTier: activeRelayTier,
        manualOverride,
        switching,
      }
    }

    ;(pc as any).forceDegradedUpgrade = forceDegradedUpgrade
    ;(conn as any).forceDegradedUpgrade = forceDegradedUpgrade
    ;(pc as any).switchTransport = switchTransport
    ;(conn as any).switchTransport = switchTransport
    ;(pc as any).setTransportAuto = setTransportAuto
    ;(conn as any).setTransportAuto = setTransportAuto
    ;(pc as any).pinTransportMode = pinTransportMode
    ;(conn as any).pinTransportMode = pinTransportMode
    ;(pc as any).getTransportInfo = getTransportInfo
    ;(conn as any).getTransportInfo = getTransportInfo

    async function answer(payload: any) {
      const next = payload.liraIceRestart as RestartTier
      const isDirect = next === 'direct'
      const manualMode: ManualTransportMode | undefined =
        payload?.liraManualTransport === 'direct' || payload?.liraManualTransport === 'turn'
          ? payload.liraManualTransport
          : undefined
      const isForceRelay = !isDirect && payload?.liraIceForceRelay === 1
      if (!alive() || answering || !payload.sdp || payload.sdp.type !== 'offer') return
      if (originator && !isForceRelay && !manualMode) return
      if (!isDirect) {
        const index = tiers.indexOf(next)
        if (index < 0) return
        if (index < tier && !isForceRelay && !manualMode) return
        tier = index
        activeRelayTier = next
      } else {
        tier = -1
        activeRelayTier = undefined
        incomingVoiceRelays.delete(conn.peer)
      }
      if (manualMode) manualOverride = manualMode
      answering = true
      remoteReady = false
      try {
        const rawServers = isDirect ? [] : await serversFor(next).catch(() => [])
        const servers = isForceRelay ? selectVoiceRecoveryServers(rawServers) : rawServers
        if (!alive()) return
        configure(servers, isDirect ? false : (isForceRelay || !!pinnedVoiceRelay))
        await pc.setRemoteDescription(payload.sdp)
        if (!alive()) return
        remoteReady = true
        candidates.splice(0).forEach(message => handle(message))
        const sdp = transform(await pc.createAnswer())
        if (!alive()) return
        await pc.setLocalDescription(sdp)
        if (alive()) send('ANSWER', sdp, next, isForceRelay, manualMode)
      } catch { if (alive()) conn.close() }
      finally {
        answering = false
        candidates.length = 0
        if (connected()) finishManualSwitch()
      }
    }
    const state = (event: Event) => {
      if (!alive()) { clear(); finishManualSwitch(); return }
      const failed = pc.iceConnectionState === 'failed' || pc.connectionState === 'failed'
      if (failed) releasePinnedVoiceRelay()
      const disconnected = pc.iceConnectionState === 'disconnected' || pc.connectionState === 'disconnected'
      if (voiceTrial && (failed || disconnected)) {
        event.stopImmediatePropagation()
        return
      }
      if (connected()) { everConnected = true; clear(); finishManualSwitch(); return }
      if (manualOverride === 'direct') {
        if (!failed) return
        manualOverride = undefined
      }
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
      if (manualOverride === 'direct') return
      if (pc.signalingState === 'stable' && pc.remoteDescription && !connected()) {
        schedule(tier < 0 ? DIRECT_ATTEMPT_MS : RELAY_ATTEMPT_MS)
      }
    }
    pc.addEventListener('iceconnectionstatechange', state, true)
    pc.addEventListener('connectionstatechange', state, true)
    pc.addEventListener('signalingstatechange', signaling)
    conn.on('close', () => {
      stopped = true; clear(); finishManualSwitch()
      clearTimeout(voiceTrial?.timer)
      voiceTrial = undefined
      voiceRouteObservers.delete(conn)
      if (!everConnected && Date.now() - attachedAt >= RELAY_ATTEMPT_MS) {
        releasePinnedVoiceRelay()
      }
      pc.removeEventListener('iceconnectionstatechange', state, true)
      pc.removeEventListener('connectionstatechange', state, true)
      pc.removeEventListener('signalingstatechange', signaling)
    })
    schedule(DIRECT_ATTEMPT_MS)
    return {
      answer,
      forceDegradedUpgrade,
      switchTransport,
      setTransportAuto,
      pinTransportMode,
      getTransportInfo,
      expectsRestartAnswer: (next: RestartTier) =>
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
      conn.answer = (...args: any[]) => {
        const override = conn.type === 'media' ? configForPeer(conn.peer) : undefined
        if (!override || !internal.options) {
          const result = answer(...args)
          sessions.set(conn, attach(conn))
          return result
        }
        const previous = internal.options.config
        internal.options.config = override
        try {
          const result = answer(...args)
          sessions.set(conn, attach(conn))
          return result
        } finally {
          internal.options.config = previous
        }
      }
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
    if (message?.type === 'CANDIDATE' && payload?.liraClearManualTransport) {
      if (typeof message.src === 'string') {
        peerManualTransports.delete(message.src)
        incomingVoiceRelays.delete(message.src)
      }
      return
    }
    if (message?.type === 'CANDIDATE' && (payload?.liraTransportSwitchRequest === 'direct' || payload?.liraTransportSwitchRequest === 'turn')) {
      const conn = peer.getConnection(message.src, payload?.connectionId)
      const session = conn && sessions.get(conn)
      if (session) {
        void session.switchTransport(payload.liraTransportSwitchRequest, payload?.reason || 'remote_manual_switch')
      }
      return
    }
    if (message?.type === 'CANDIDATE' && payload?.liraRestartRequest) {
      const conn = peer.getConnection(message.src, payload?.connectionId)
      const session = conn && sessions.get(conn)
      if (session) {
        if (payload?.liraTargetTransport === 'turn') {
          void session.switchTransport('turn', payload?.reason || 'remote_manual_switch')
        } else {
          void session.forceDegradedUpgrade(payload?.reason || 'remote_restart_request')
        }
      }
      return
    }
    if (message?.type === 'CANDIDATE') {
      const conn = peer.getConnection(message.src, payload?.connectionId)
      if (conn && sessions.get(conn)?.queueCandidate(message)) return
    }
    if (message?.type === 'OFFER' && ['direct', 'cloudflare', 'metered'].includes(payload?.liraIceRestart)) {
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
