import type { PublicRoomInfo } from '../types/game'

export function publicRoomMetadata(room: PublicRoomInfo): Omit<PublicRoomInfo, 'hostAvatar'> {
  return {
    id: room.id, code: room.code, name: room.name, description: room.description,
    hostId: room.hostId, hostName: room.hostName, hostColor: room.hostColor,
    playerCount: room.playerCount, maxPlayers: room.maxPlayers, color: room.color,
    createdAt: room.createdAt, lastHeartbeat: room.lastHeartbeat,
    zonesCount: room.zonesCount, isOfficial: room.isOfficial, announcementId: room.announcementId,
  }
}
