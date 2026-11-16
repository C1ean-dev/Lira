import type { NetworkMessage } from '../types/p2p'
import type { BoardPoint } from '../collaboration/boardEditor'
import { PeerManager } from '../p2p/PeerManager'
import { useGameStore } from '../store/useGameStore'
import { useBoardPointerStore } from '../store/useBoardPointerStore'

let lastSent = -Infinity, lastRoom: string | null = null, sequence = 0
const validPoint = (point: any): point is BoardPoint | null => point === null || !!point &&
  Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1e7 && Math.abs(point.y) <= 1e7

export function sendBoardPointer(point: BoardPoint | null): void {
  const { roomId, isConnected, localPlayer } = useGameStore.getState(), now = Date.now()
  if (!roomId || !isConnected || !validPoint(point)) return
  if (point && roomId === lastRoom && now >= lastSent && now - lastSent < 32) return
  lastSent = point ? now : -Infinity; lastRoom = roomId; sequence = Math.max(sequence + 1, now)
  const pm = PeerManager.getInstance()
  pm.broadcast({ type: 'WHITEBOARD_POINTER', senderId: pm.getPeerId() || localPlayer.id, timestamp: now,
    payload: { roomId, point, seq: sequence } })
}

export function receiveBoardPointer(msg: NetworkMessage, peerId: string, isHost: boolean): boolean {
  if (msg.type !== 'WHITEBOARD_POINTER') return false
  const game = useGameStore.getState(), payload = msg.payload
  if (!game.roomId || payload?.roomId !== game.roomId || typeof msg.senderId !== 'string' || !msg.senderId || msg.senderId.length > 128 ||
    (isHost ? msg.senderId !== peerId : msg.senderId !== peerId && peerId !== game.connectionHostId) ||
    !Number.isSafeInteger(payload.seq) || payload.seq < 0 || !validPoint(payload.point)) return false
  const state = useBoardPointerStore.getState()
  state.selectRoom(game.roomId)
  if ((useBoardPointerStore.getState().pointers[msg.senderId]?.seq ?? -1) >= payload.seq) return false
  state.update(msg.senderId, payload.point, payload.seq, Date.now(), 'laser', game.remotePlayers[msg.senderId]?.name || 'Participante')
  return true
}
