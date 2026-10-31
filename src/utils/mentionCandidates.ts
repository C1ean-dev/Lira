import type { AvatarConfig } from '../types/game'
import type { Channel } from '../types/chat'
import type { MentionCandidate } from './chatMentions'
import { getPlayerUserId } from './userId'
import { getRoomPets } from '../services/roomPets'

type Player = { id: string; gameId?: string; name: string; currentZoneId?: string | null; avatar?: AvatarConfig }
export function buildMentionCandidates(local: Player, others: Player[], channel: Channel | undefined): MentionCandidate[] {
  const people: MentionCandidate[] = [local, ...others].map(player => ({ kind: 'person', id: getPlayerUserId(player), name: player.name }))
  if (channel?.type === 'dm' && channel.recipientId && !people.some(person => person.id === channel.recipientId)) {
    people.push({ kind: 'person', id: channel.recipientId, name: channel.name })
  }
  const pets: MentionCandidate[] = channel?.type === 'dm' ? [] : getRoomPets(local, others).map(pet => ({ kind: 'pet', id: pet.ownerId, name: pet.petName, ownerName: pet.ownerName }))
  return [...people, ...pets]
}
