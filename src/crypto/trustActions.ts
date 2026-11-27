import { resolvePeerSecurity, useSecurityStore } from '../store/useSecurityStore'
import { useGameStore } from '../store/useGameStore'
import { findFriendKey } from '../utils/userId'

function collectPeerIds(primary: string, extra: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  for (const id of [primary, ...extra]) {
    if (id) seen.add(id)
  }
  return Array.from(seen)
}

/**
 * Marks a peer's identity key as verified out-of-band (e.g., via SAS comparison)
 * and persists the trust flag on the matching friend profile when available.
 */
export function markPeerVerified(
  peerId: string,
  candidateIds: Array<string | undefined | null> = []
): boolean {
  const secStore = useSecurityStore.getState()
  const ids = collectPeerIds(peerId, candidateIds)
  const resolved = resolvePeerSecurity(secStore.peers, ids)

  const gameStore = useGameStore.getState()
  const friendKey = findFriendKey(gameStore.friends, gameStore.friendProfiles, ids)
  const existingProfile = friendKey ? gameStore.friendProfiles[friendKey] : undefined

  const publicKey = resolved?.publicKey || existingProfile?.identityKey
  const fingerprint = resolved?.fingerprint || existingProfile?.identityKeyFingerprint

  if (!publicKey || !fingerprint) return false
  if (resolved && (resolved.status === 'mitm_blocked' || resolved.status === 'key_changed')) {
    return false
  }

  for (const id of ids) {
    if (secStore.peers[id]) {
      secStore.setPeerSecurity(id, {
        ...secStore.peers[id],
        status: 'verified',
        publicKey: secStore.peers[id].publicKey || publicKey,
        fingerprint: secStore.peers[id].fingerprint || fingerprint,
      })
    }
  }
  if (!resolved) {
    secStore.setPeerSecurity(peerId, {
      status: 'verified',
      publicKey,
      fingerprint,
    })
  }

  if (friendKey) {
    gameStore.updateFriendProfile(friendKey, {
      identityKey: publicKey,
      identityKeyFingerprint: fingerprint,
      identityKeyVerified: true,
    })
  }

  for (const id of ids) {
    secStore.clearAlertsForPeer(id)
  }
  return true
}

/**
 * Clears explicit out-of-band verification for a peer without unpinning its key.
 */
export function unverifyPeer(
  peerId: string,
  candidateIds: Array<string | undefined | null> = []
): boolean {
  const secStore = useSecurityStore.getState()
  const ids = collectPeerIds(peerId, candidateIds)
  let updated = false

  for (const id of ids) {
    const entry = secStore.peers[id]
    if (entry?.status === 'verified') {
      secStore.setPeerSecurity(id, {
        ...entry,
        status: 'encrypted',
      })
      updated = true
    }
  }

  const gameStore = useGameStore.getState()
  const friendKey = findFriendKey(gameStore.friends, gameStore.friendProfiles, ids)
  if (friendKey && gameStore.friendProfiles[friendKey]?.identityKeyVerified) {
    gameStore.updateFriendProfile(friendKey, {
      identityKeyVerified: false,
    })
    updated = true
  }

  return updated
}

/**
 * Explicitly accepts a peer's newly presented identity key after a TOFU key-change warning.
 * Resets verification state so the user can re-verify the new SAS after reconnecting.
 */
export function acceptChangedPeerKey(
  peerId: string,
  candidateIds: Array<string | undefined | null> = []
): boolean {
  const secStore = useSecurityStore.getState()
  const ids = collectPeerIds(peerId, candidateIds)
  const resolved = resolvePeerSecurity(secStore.peers, ids)

  if (!resolved || resolved.status !== 'key_changed' || !resolved.publicKey || !resolved.fingerprint) {
    return false
  }

  const gameStore = useGameStore.getState()
  const friendKey = findFriendKey(gameStore.friends, gameStore.friendProfiles, ids)
  if (friendKey) {
    gameStore.updateFriendProfile(friendKey, {
      identityKey: resolved.publicKey,
      identityKeyFingerprint: resolved.fingerprint,
      identityKeyVerified: false,
    })
  }

  for (const id of ids) {
    if (secStore.peers[id]?.status === 'key_changed') {
      secStore.setPeerSecurity(id, {
        status: 'pending',
        publicKey: resolved.publicKey,
        fingerprint: resolved.fingerprint,
        reason: undefined,
      })
    }
    secStore.clearAlertsForPeer(id)
  }

  return true
}
