import { create } from 'zustand'
import type { E2EESas } from '../crypto/sessionManager'

export type PeerSecurityStatus =
  | 'pending'
  | 'encrypted'
  | 'verified'
  | 'key_changed'
  | 'mitm_blocked'
  | 'legacy'

export interface PeerSecurityState {
  peerId: string
  status: PeerSecurityStatus
  fingerprint?: string
  publicKey?: string
  sas?: E2EESas
  dtlsBound?: boolean
  mediaEncrypted?: boolean
  callDtlsVerified?: boolean
  reason?: string
  updatedAt: number
}

export interface SecurityAlert {
  id: string
  peerId: string
  reason: string
  message: string
  timestamp: number
}

export interface SecurityInspectionTarget {
  peerId: string
  displayName?: string
  candidateIds?: string[]
}

const PEER_STATUS_PRIORITY: Record<PeerSecurityStatus, number> = {
  mitm_blocked: 6,
  key_changed: 5,
  verified: 4,
  encrypted: 3,
  legacy: 2,
  pending: 1,
}

/**
 * Resolves the highest-priority PeerSecurityState across multiple possible identifiers
 * for a participant (ephemeral peerId, persistent gameId/u-id, friend key).
 */
export function resolvePeerSecurity(
  peers: Record<string, PeerSecurityState>,
  candidateIds: Array<string | undefined | null>
): PeerSecurityState | null {
  let best: PeerSecurityState | null = null
  for (const id of candidateIds) {
    if (!id) continue
    const entry = peers[id]
    if (!entry) continue
    if (!best || PEER_STATUS_PRIORITY[entry.status] > PEER_STATUS_PRIORITY[best.status]) {
      best = entry
    }
  }
  return best
}

export interface AggregatedCallSecurity {
  status: PeerSecurityStatus | 'idle'
  mediaEncryptedCount: number
  totalPeers: number
  primaryPeer: SecurityInspectionTarget | null
}

/**
 * Aggregates security posture across a set of call or room participants.
 */
export function aggregatePeersSecurity(
  peers: Record<string, PeerSecurityState>,
  targets: Array<{ id: string; gameId?: string; name?: string }>
): AggregatedCallSecurity {
  if (targets.length === 0) {
    return {
      status: 'idle',
      mediaEncryptedCount: 0,
      totalPeers: 0,
      primaryPeer: null,
    }
  }

  let hasMitmBlocked = false
  let hasKeyChanged = false
  let allVerified = true
  let allEncryptedOrVerified = true
  let mediaEncryptedCount = 0
  let urgentTarget: SecurityInspectionTarget | null = null
  const firstTarget: SecurityInspectionTarget = {
    peerId: targets[0].id,
    displayName: targets[0].name,
    candidateIds: targets[0].gameId ? [targets[0].id, targets[0].gameId] : [targets[0].id],
  }

  for (const target of targets) {
    const candidateIds = target.gameId ? [target.id, target.gameId] : [target.id]
    const resolved = resolvePeerSecurity(peers, candidateIds)
    const status = resolved?.status ?? 'pending'
    if (resolved?.mediaEncrypted) {
      mediaEncryptedCount++
    }
    if (status === 'mitm_blocked') {
      hasMitmBlocked = true
      urgentTarget = { peerId: resolved?.peerId || target.id, displayName: target.name, candidateIds }
    } else if (status === 'key_changed' && !hasMitmBlocked) {
      hasKeyChanged = true
      urgentTarget = { peerId: resolved?.peerId || target.id, displayName: target.name, candidateIds }
    }
    if (status !== 'verified') allVerified = false
    if (status !== 'verified' && status !== 'encrypted') allEncryptedOrVerified = false
  }

  let status: PeerSecurityStatus | 'idle'
  if (hasMitmBlocked) status = 'mitm_blocked'
  else if (hasKeyChanged) status = 'key_changed'
  else if (allVerified) status = 'verified'
  else if (allEncryptedOrVerified) status = 'encrypted'
  else status = 'pending'

  return {
    status,
    mediaEncryptedCount,
    totalPeers: targets.length,
    primaryPeer: urgentTarget || firstTarget,
  }
}

interface SecurityStore {
  localPublicKey: string | null
  localFingerprint: string | null
  peers: Record<string, PeerSecurityState>
  alerts: SecurityAlert[]
  inspectionTarget: SecurityInspectionTarget | null

  setLocalIdentity: (publicKey: string, fingerprint: string) => void
  setPeerSecurity: (peerId: string, state: Omit<PeerSecurityState, 'peerId' | 'updatedAt'>) => void
  updatePeerMediaSecurity: (
    peerId: string,
    patch: { mediaEncrypted?: boolean; callDtlsVerified?: boolean }
  ) => void
  recordAlert: (alert: Omit<SecurityAlert, 'id' | 'timestamp'>) => void
  dismissAlert: (id: string) => void
  clearAlertsForPeer: (peerId: string) => void
  openInspection: (target: SecurityInspectionTarget) => void
  closeInspection: () => void
  clearPeer: (peerId: string) => void
  clearRoomPeers: () => void
  reset: () => void
}

export const useSecurityStore = create<SecurityStore>((set) => ({
  localPublicKey: null,
  localFingerprint: null,
  peers: {},
  alerts: [],
  inspectionTarget: null,

  setLocalIdentity: (localPublicKey, localFingerprint) =>
    set({ localPublicKey, localFingerprint }),

  setPeerSecurity: (peerId, next) =>
    set((state) => ({
      peers: {
        ...state.peers,
        [peerId]: {
          ...state.peers[peerId],
          peerId,
          ...next,
          updatedAt: Date.now(),
        },
      },
    })),

  updatePeerMediaSecurity: (peerId, patch) =>
    set((state) => {
      const existing = state.peers[peerId]
      if (!existing) {
        return {
          peers: {
            ...state.peers,
            [peerId]: {
              peerId,
              status: 'pending',
              ...patch,
              updatedAt: Date.now(),
            },
          },
        }
      }
      return {
        peers: {
          ...state.peers,
          [peerId]: {
            ...existing,
            ...patch,
            updatedAt: Date.now(),
          },
        },
      }
    }),

  recordAlert: (alert) =>
    set((state) => ({
      alerts: [
        ...state.alerts.slice(-19),
        {
          id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ...alert,
          timestamp: Date.now(),
        },
      ],
    })),

  dismissAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    })),

  clearAlertsForPeer: (peerId) =>
    set((state) => ({
      alerts: state.alerts.filter((a) => a.peerId !== peerId),
    })),

  openInspection: (target) => set({ inspectionTarget: target }),

  closeInspection: () => set({ inspectionTarget: null }),

  clearPeer: (peerId) =>
    set((state) => {
      if (!(peerId in state.peers)) return state
      const next = { ...state.peers }
      delete next[peerId]
      return { peers: next }
    }),

  clearRoomPeers: () =>
    set((state) => {
      const next: Record<string, PeerSecurityState> = {}
      for (const [id, entry] of Object.entries(state.peers)) {
        if (id.startsWith('u-')) {
          next[id] = entry
        }
      }
      return { peers: next }
    }),

  reset: () =>
    set({
      localPublicKey: null,
      localFingerprint: null,
      peers: {},
      alerts: [],
      inspectionTarget: null,
    }),
}))
