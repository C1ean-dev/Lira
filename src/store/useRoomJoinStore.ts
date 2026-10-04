import { create } from 'zustand'
import { sanitizeRoomCode } from '../utils/roomCode'

interface RoomJoinStore {
  /** A space the user asked to enter from somewhere that cannot join by itself. */
  pendingRoomCode: string | null
  requestJoin: (roomCode: string) => void
  clear: () => void
}

/**
 * Entering a space is done by the home screen. Anything else that wants it
 * (an invite, a friend's space) leaves the code here: the app goes back to the
 * home screen, which picks it up and joins.
 */
export const useRoomJoinStore = create<RoomJoinStore>((set) => ({
  pendingRoomCode: null,
  requestJoin: (roomCode) => {
    const code = sanitizeRoomCode(roomCode)
    if (code) set({ pendingRoomCode: code })
  },
  clear: () => set({ pendingRoomCode: null }),
}))
