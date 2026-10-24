import { create } from 'zustand'

export interface BedSession {
  id: string
  roomId: string
  furnitureId: string
  initiatorId: string
  targetId: string
  createdAt: number
  stage: 'invited' | 'active'
  acceptedAt?: number
}

// Room interactions are transient; never persist consent across reconnects.
export const useBedStore = create<{ sessions: Record<string, BedSession>; seenInvites: string[] }>(() => ({ sessions: {}, seenInvites: [] }))
