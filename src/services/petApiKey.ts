// Keys stay in memory, never in room messages or persisted chat history.
const roomKeys = new Map<string, string>()
export function getRoomPetApiKey(roomId: string): string { return roomKeys.get(roomId) || '' }
export function setRoomPetApiKey(roomId: string, key: string): void {
  if (!roomId) return
  const trimmed = key.trim()
  if (trimmed) roomKeys.set(roomId, trimmed)
  else roomKeys.delete(roomId)
}
