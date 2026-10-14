import { buildIceServers } from './rtcIceServers'

const STUN_FALLBACK_COOLDOWN_MS = 2 * 60 * 1000
let fallbackUntil = 0

export function isStunFallbackEnabled(): boolean {
  return Date.now() < fallbackUntil
    && buildIceServers(import.meta.env, true).length > buildIceServers(import.meta.env).length
}

// This changes only future negotiations. Existing calls keep their working route.
export function enableStunFallback(): boolean {
  if (isStunFallbackEnabled()) return false
  const primary = buildIceServers(import.meta.env)
  const fallback = buildIceServers(import.meta.env, true)
  if (fallback.length === primary.length) return false
  fallbackUntil = Date.now() + STUN_FALLBACK_COOLDOWN_MS
  return true
}

export const SHARED_RTC_CONFIG: RTCConfiguration = {
  get iceServers() {
    return buildIceServers(import.meta.env, isStunFallbackEnabled())
  },
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 4,
}

const watched = new WeakSet<RTCPeerConnection>()
export function watchIceFallback(pc?: RTCPeerConnection): void {
  if (!pc?.addEventListener || watched.has(pc)) return
  watched.add(pc)
  const check = () => {
    if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') enableStunFallback()
  }
  // PeerJS closes failed connections in its non-capturing ICE handler. Observe
  // the failure first, while the state still reads "failed" rather than "closed".
  pc.addEventListener('iceconnectionstatechange', check, true)
  pc.addEventListener('connectionstatechange', check, true)
  check()
}
