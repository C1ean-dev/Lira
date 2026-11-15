import { create } from 'zustand'
import { createWhiteboard, applyWhiteboardOperation, type WhiteboardDocument, type WhiteboardOperation } from '../collaboration/whiteboard'
interface WhiteboardStore {
  roomId: string | null
  document: WhiteboardDocument
  isOpen: boolean
  synchronized: boolean
  setSynchronized(ready: boolean): void
  setOpen(open: boolean): void
  selectRoom(roomId: string | null): void
  apply(roomId: string, operation: unknown): boolean
  reset(): void
}
export const useWhiteboardStore = create<WhiteboardStore>((set, get) => ({
  roomId: null, document: createWhiteboard(), isOpen: false, synchronized: false,
  setSynchronized: synchronized => set({ synchronized }),
  setOpen: isOpen => set({ isOpen }),
  selectRoom: roomId => { if (get().roomId !== roomId) set({ roomId, document: createWhiteboard(), isOpen: false, synchronized: false }) },
  apply: (roomId, operation) => {
    if (get().roomId !== roomId) get().selectRoom(roomId)
    const before = get().document
    const document = applyWhiteboardOperation(before, operation)
    if (document === before) return false
    set({ document }); return true
  },
  reset: () => set({ roomId: null, document: createWhiteboard(), isOpen: false, synchronized: false }),
}))
export type { WhiteboardOperation }
