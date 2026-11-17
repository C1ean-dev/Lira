import type { NetworkMessage } from '../types/p2p'
import { PeerManager } from '../p2p/PeerManager'
import { useGameStore } from '../store/useGameStore'
import { useWhiteboardStore } from '../store/useWhiteboardStore'
import { getWhiteboardFiles } from '../collaboration/boardScene'
import { validWhiteboardOperation, type WhiteboardOperation } from '../collaboration/whiteboard'

export function sendWhiteboardOperation(operation: WhiteboardOperation): boolean {
  const { roomId, isConnected } = useGameStore.getState()
  if (!roomId || (isConnected && !useWhiteboardStore.getState().synchronized) || !useWhiteboardStore.getState().apply(roomId, operation)) return false
  const snapshot = useWhiteboardStore.getState().document.operations[operation.id]
  if (isConnected) PeerManager.getInstance().broadcast({ type: 'WHITEBOARD_OP', senderId: operation.actor, payload: { schemaVersion: 2, roomId, operation: snapshot }, timestamp: Date.now() })
  return true
}
export async function requestWhiteboard(): Promise<void> {
  const roomId = useGameStore.getState().roomId
  if (!roomId) return
  const hydration = useWhiteboardStore.getState().selectRoom(roomId)
  const { isHost, isConnected } = useGameStore.getState()
  useWhiteboardStore.getState().setSynchronized(isHost || !isConnected)
  await hydration
  if (!isConnected || useGameStore.getState().roomId !== roomId) return
  const pm = PeerManager.getInstance()
  pm.broadcast({ type: 'WHITEBOARD_REQUEST', senderId: pm.getPeerId() || useGameStore.getState().localPlayer.id, payload: { schemaVersion: 2, roomId, fileIds: Object.keys(getWhiteboardFiles(useWhiteboardStore.getState().document)) }, timestamp: Date.now() })
}
export function receiveWhiteboardMessage(msg: NetworkMessage, peerId: string, isHost: boolean, myPeerId?: string | null): boolean {
  if (msg.type !== 'WHITEBOARD_OP' && msg.type !== 'WHITEBOARD_STATE' && msg.type !== 'WHITEBOARD_REQUEST') return false
  const state = useGameStore.getState()
  if (!state.roomId || msg.payload?.roomId !== state.roomId) return false
  if (isHost ? msg.senderId !== peerId : msg.senderId !== peerId && peerId !== state.connectionHostId) return false
  const board = useWhiteboardStore.getState()
  board.selectRoom(state.roomId)
  if (msg.type === 'WHITEBOARD_REQUEST') {
    if (isHost) {
      const roomId = state.roomId
      const send = () => {
        if (useGameStore.getState().roomId !== state.roomId || !useGameStore.getState().isHost) return
        const knownFiles = new Set(msg.payload.fileIds || [])
        const operations = Object.values(useWhiteboardStore.getState().document.operations).filter(operation => operation.kind !== 'file' || !knownFiles.has(operation.file.id))
        const pm = PeerManager.getInstance()
        for (let i = 0; i < Math.max(1, operations.length); i += 16) pm.broadcast({
          type: 'WHITEBOARD_STATE', senderId: myPeerId || state.localPlayer.id,
          payload: { schemaVersion: 2, roomId, to: msg.senderId, operations: operations.slice(i, i + 16), complete: i + 16 >= operations.length }, timestamp: Date.now(),
        })
      }
      if (board.hydrated) send()
      else void board.selectRoom(state.roomId).then(send)
    }
    return false
  }
  if (msg.type === 'WHITEBOARD_STATE') {
    if (isHost || peerId !== state.connectionHostId || msg.senderId !== peerId || msg.payload.to !== (myPeerId || state.localPlayer.id)) return false
    const operations = msg.payload.operations
    if (!Array.isArray(operations) || operations.length > 16 || !operations.every(validWhiteboardOperation)) return false
    for (const operation of operations) board.apply(state.roomId, operation)
    if (msg.payload.complete === true) board.setSynchronized(true)
    return false
  }
  const op = msg.payload?.operation
  if (!validWhiteboardOperation(op) || op.actor !== msg.senderId) return false
  return board.apply(state.roomId, op)
}
