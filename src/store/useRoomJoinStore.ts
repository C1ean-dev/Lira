import { create } from 'zustand'
import { normalizeSpaceInvite } from '../utils/spaceInviteLink'

interface RoomJoinStore {
  pendingRoomCode: string | null
  requestJoin: (roomCode: string) => void
  clear: () => void
}

export const useRoomJoinStore = create<RoomJoinStore>((set) => ({
  pendingRoomCode: null,
  requestJoin: (roomCode) => {
    try {
      const code = normalizeSpaceInvite(roomCode)
      set({ pendingRoomCode: code })
    } catch { /* Ignore malformed external invitations without leaving the current space. */ }
  },
  clear: () => set({ pendingRoomCode: null }),
}))
