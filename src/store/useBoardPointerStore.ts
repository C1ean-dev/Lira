import { create } from 'zustand'
import type { BoardPoint } from '../collaboration/boardEditor'

export type PointerSample = BoardPoint & { at: number }
export type BoardPointer = { points: PointerSample[]; seq: number; updated: number; kind: 'laser' | 'eraser'; name: string }
export const POINTER_TRAIL_MS = 650
export const LOCAL_BOARD_POINTER = '$local'
export const pointerTrail = (pointer: BoardPointer, now: number) => pointer.points.filter(point => now - point.at < POINTER_TRAIL_MS)
interface BoardPointerStore {
  roomId: string | null
  pointers: Record<string, BoardPointer>
  selectRoom(roomId: string | null): void
  update(actor: string, point: BoardPoint | null, seq: number, at?: number, kind?: 'laser' | 'eraser', name?: string, trail?: boolean): void
  remove(actor: string): void
  reset(): void
}
export const useBoardPointerStore = create<BoardPointerStore>((set, get) => ({
  roomId: null, pointers: {},
  selectRoom: roomId => { if (get().roomId !== roomId) set({ roomId, pointers: {} }) },
  update: (actor, point, seq, at = Date.now(), kind = 'laser', name = '', trail = true) => {
    const previous = get().pointers[actor]
    if (previous && previous.seq >= seq) return
    const points = point ? [...(trail && previous?.kind === kind ? pointerTrail(previous, at) : []), { ...point, at }].slice(-48) : []
    const entries = Object.entries(get().pointers).filter(([id]) => id !== actor).sort((a, b) => b[1].updated - a[1].updated).slice(0, 127)
    set({ pointers: { ...Object.fromEntries(entries), [actor]: { points, seq, updated: at, kind, name } } })
  },
  remove: actor => { const next = { ...get().pointers }; delete next[actor]; set({ pointers: next }) },
  reset: () => set({ roomId: null, pointers: {} }),
}))
