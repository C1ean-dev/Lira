import { create } from 'zustand'
import { sanitizeRoomCode } from '../utils/roomCode'

interface RoomJoinStore {
  pendingRoomCode: string | null
  requestJoin: (roomCode: string) => void
  clear: () => void
}

export const useRoomJoinStore = create<RoomJoinStore>((set) => ({
  pendingRoomCode: null,
  requestJoin: (roomCode) => {
    const code = sanitizeRoomCode(roomCode)
    if (code) set({ pendingRoomCode: code })
  },
  clear: () => set({ pendingRoomCode: null }),
}))
