import { create } from 'zustand'
import { useBoardPointerStore } from './useBoardPointerStore'
import { createWhiteboard, applyWhiteboardOperation, type WhiteboardDocument, type WhiteboardOperation } from '../collaboration/whiteboard'
interface WhiteboardStore {
  roomId: string | null
  document: WhiteboardDocument
  isOpen: boolean
  synchronized: boolean
  storageError: boolean
  dark: boolean
  setDark(dark: boolean): void
  setSynchronized(ready: boolean): void
  setOpen(open: boolean): void
  selectRoom(roomId: string | null): void
  apply(roomId: string, operation: unknown): boolean
  reset(): void
}
const storageKey = (roomId: string) => `lira_whiteboard_${encodeURIComponent(roomId)}`
function loadRoom(roomId: string | null): WhiteboardDocument {
  if (!roomId) return createWhiteboard()
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(roomId))
    if (!raw) return createWhiteboard()
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.operations !== 'object' || Object.keys(parsed.operations).length > 1000) return createWhiteboard()
    return Object.values(parsed.operations).reduce<WhiteboardDocument>(applyWhiteboardOperation, createWhiteboard())
  } catch { return createWhiteboard() }
}
export const useWhiteboardStore = create<WhiteboardStore>((set, get) => ({
  roomId: null, document: createWhiteboard(), isOpen: false, synchronized: false, storageError: false, dark: false,
  setDark: dark => set({ dark }),
  setSynchronized: synchronized => set({ synchronized }),
  setOpen: isOpen => set({ isOpen }),
  selectRoom: roomId => { if (get().roomId !== roomId) { useBoardPointerStore.getState().selectRoom(roomId); set({ roomId, document: loadRoom(roomId), isOpen: false, synchronized: false, storageError: false }) } },
  apply: (roomId, operation) => {
    if (get().roomId !== roomId) get().selectRoom(roomId)
    const before = get().document
    const document = applyWhiteboardOperation(before, operation)
    if (document === before) return false
    let storageError = false
    try { globalThis.localStorage?.setItem(storageKey(roomId), JSON.stringify(document)) } catch { storageError = true }
    set({ document, storageError }); return true
  },
  reset: () => { useBoardPointerStore.getState().reset(); set({ roomId: null, document: createWhiteboard(), isOpen: false, synchronized: false, storageError: false, dark: false }) },
}))
export type { WhiteboardOperation }
