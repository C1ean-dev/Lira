import { loadBoardRoom, saveBoardRoom } from '../collaboration/boardPersistence'
import { create } from 'zustand'
import { useBoardPointerStore } from './useBoardPointerStore'
import { createWhiteboard, applyWhiteboardOperation, type WhiteboardDocument, type WhiteboardOperation } from '../collaboration/whiteboard'
interface WhiteboardStore {
  roomId: string | null
  document: WhiteboardDocument
  isOpen: boolean
  hydrated: boolean
  synchronized: boolean
  storageError: boolean
  dark: boolean
  setDark(dark: boolean): void
  setSynchronized(ready: boolean): void
  setOpen(open: boolean): void
  selectRoom(roomId: string | null): Promise<void>
  apply(roomId: string, operation: unknown): boolean
  flushWrites(): Promise<void>
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
const pendingWrites = new Set<Promise<void>>()
let generation = 0
let hydration: Promise<void> = Promise.resolve()

export const useWhiteboardStore = create<WhiteboardStore>((set, get) => ({
  roomId: null, document: createWhiteboard(), isOpen: false, hydrated: true, synchronized: false, storageError: false, dark: false,
  setDark: dark => set({ dark }),
  setSynchronized: synchronized => set({ synchronized }),
  setOpen: isOpen => set({ isOpen }),
  selectRoom: roomId => {
    if (get().roomId === roomId) return hydration
    const token = ++generation
    useBoardPointerStore.getState().selectRoom(roomId)
    set({ roomId, document: loadRoom(roomId), isOpen: false, synchronized: false, hydrated: !roomId, storageError: false })
    hydration = roomId ? loadBoardRoom(roomId).then(document => {
      if (generation !== token) return
      const merged = Object.values(get().document.operations).reduce(applyWhiteboardOperation, document)
      set({ document: merged, hydrated: true })
    }).catch(() => { if (generation === token) set({ hydrated: true, storageError: true }) }) : Promise.resolve()
    return hydration
  },
  apply: (roomId, operation) => {
    if (get().roomId !== roomId) get().selectRoom(roomId)
    const before = get().document
    const document = applyWhiteboardOperation(before, operation)
    if (document === before) return false
    const token = generation
    set({ document })
    const write = hydration.then(() => saveBoardRoom(roomId, generation === token ? get().document : document))
      .then(() => { if (generation === token) set({ storageError: false }) })
      .catch(() => { if (generation === token) set({ storageError: true }) })
      .finally(() => { pendingWrites.delete(write) })
    pendingWrites.add(write)
    return true
  },
  flushWrites: async () => { await Promise.all([...pendingWrites]) },
  reset: () => { generation++; hydration = Promise.resolve(); useBoardPointerStore.getState().reset(); set({ roomId: null, document: createWhiteboard(), isOpen: false, hydrated: true, synchronized: false, storageError: false, dark: false }) },
}))
export type { WhiteboardOperation }
