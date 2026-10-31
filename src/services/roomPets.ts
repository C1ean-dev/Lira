import type { AvatarConfig } from '../types/game'
type Player = { id: string; name: string; currentZoneId?: string | null; avatar?: AvatarConfig }
export function getRoomPets(local: Player, others: Player[]) {
  if (!local.currentZoneId) return []
  return [local, ...others]
    .filter(player => player.currentZoneId === local.currentZoneId && player.avatar?.pet && player.avatar.pet.type !== 'none')
    .map(player => ({ ownerId: player.id, ownerName: player.name, petName: player.avatar?.pet?.name?.trim() || 'Pet' }))
}
