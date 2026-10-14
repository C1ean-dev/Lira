export interface RoomSessionSnapshot {
  roomCode: string
  roomName: string
  roomDescription: string
  isPublic: boolean
  maxPlayers: number
  color: string
}

export function isRoomSessionSnapshot(value: any, roomCode: string | null): value is RoomSessionSnapshot {
  return Boolean(value && value.roomCode === roomCode && typeof value.isPublic === 'boolean'
    && typeof value.roomName === 'string' && value.roomName.length <= 200
    && typeof value.roomDescription === 'string' && value.roomDescription.length <= 2000
    && Number.isInteger(value.maxPlayers) && value.maxPlayers >= 1 && value.maxPlayers <= 1000
    && typeof value.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.color))
}
