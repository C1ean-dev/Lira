/**
 * Stable user identity.
 *
 * `Player.id` is the P2P connection id while inside a room and changes on
 * every (re)connect, so it cannot identify a person. The user id generated
 * here is created once per profile, persisted, and is what friendships,
 * direct messages and presence are addressed to.
 */

const USER_ID_PREFIX = 'u-'
const USER_ID_BODY_LENGTH = 20
const USER_ID_PATTERN = /^u-[a-z0-9]{20}$/
const USER_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function generateUserId(): string {
  const bytes = new Uint8Array(USER_ID_BODY_LENGTH)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  let body = ''
  for (let i = 0; i < bytes.length; i++) {
    body += USER_ID_ALPHABET[bytes[i] % USER_ID_ALPHABET.length]
  }
  return USER_ID_PREFIX + body
}

export function isUserId(value: unknown): value is string {
  return typeof value === 'string' && USER_ID_PATTERN.test(value)
}

/**
 * The stable identity behind a player entry: `gameId` when the entry is keyed
 * by a connection id (inside a room), otherwise the id itself.
 */
export function getPlayerUserId(player: { id: string; gameId?: string }): string {
  return player.gameId || player.id
}

/**
 * Resolves the stable user id of a friend entry, or null when the entry was
 * created from a connection id / placeholder and was never linked to a user.
 */
export function getFriendUserId(friend: {
  id: string
  actualUserId?: string
  gameId?: string
}): string | null {
  if (isUserId(friend.actualUserId)) return friend.actualUserId
  if (isUserId(friend.gameId)) return friend.gameId
  if (isUserId(friend.id)) return friend.id
  return null
}

/**
 * Finds the friends-list key of a person given any of their known ids
 * (connection id, stable user id). Never matches by name.
 */
export function findFriendKey(
  friends: string[],
  friendProfiles: Record<string, { actualUserId?: string; gameId?: string }>,
  ids: Array<string | undefined | null>
): string | undefined {
  const known = ids.filter((id): id is string => !!id)
  if (known.length === 0) return undefined
  for (const key of friends) {
    if (known.includes(key)) return key
    const profile = friendProfiles[key]
    if (!profile) continue
    if (
      (profile.actualUserId && known.includes(profile.actualUserId)) ||
      (profile.gameId && known.includes(profile.gameId))
    ) {
      return key
    }
  }
  return undefined
}

const sameName = (a?: string | null, b?: string | null): boolean => {
  const left = (a || '').trim().toLowerCase()
  return !!left && left === (b || '').trim().toLowerCase()
}

/**
 * Whether a message participant (`id` + display name) is the given person.
 *
 * Ids are compared exactly. A display name only counts when the participant
 * has no stable user id to compare — entries saved before stable ids existed —
 * so nobody can pass for someone else just by using the same name.
 */
export function isSameParticipant(
  person: { id: string; actualUserId?: string; gameId?: string; name?: string },
  participantId?: string | null,
  participantName?: string | null
): boolean {
  if (participantId) {
    if (
      participantId === person.id ||
      participantId === person.actualUserId ||
      participantId === person.gameId
    ) {
      return true
    }
    if (isUserId(participantId)) return false
  }
  return sameName(participantName, person.name)
}

