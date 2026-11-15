import { generateUUID } from '../utils/uuid'
import { create } from 'zustand'
import type { TranscriptEntry } from '../media/callTranscription'

export interface Meeting {
  id: string
  roomId: string
  zoneId: string
  title: string
  startedAt: number
  endedAt?: number
  entries: TranscriptEntry[]
  summary?: string
}
interface MeetingStore {
  meetings: Meeting[]
  storageError: boolean
  isOpen: boolean
  setOpen(open: boolean): void
  begin(roomId: string, zoneId: string, title: string): string
  append(id: string, entry: TranscriptEntry): void
  finish(id: string): void
  setSummary(id: string, summary: string): void
  remove(id: string): void
}

// Transcripts and summaries stay on this device; API keys are never persisted.
const KEY = 'lira_meeting_history'
function load(): Meeting[] {
  try {
    const data = JSON.parse(globalThis.localStorage?.getItem(KEY) || '[]')
    return Array.isArray(data) ? data.filter(m => typeof m?.id === 'string' && typeof m.title === 'string' && Array.isArray(m.entries))
      .slice(0, 20).map(m => ({ ...m, endedAt: m.endedAt || Date.now() })) : []
  } catch { return [] }
}
export const useMeetingStore = create<MeetingStore>((set) => ({
  meetings: load(), isOpen: false, storageError: false,
  setOpen: isOpen => set({ isOpen }),
  begin: (roomId, zoneId, title) => {
    const id = generateUUID()
    set(state => ({ meetings: [{ id, roomId, zoneId, title, startedAt: Date.now(), entries: [] }, ...state.meetings].slice(0, 20) }))
    return id
  },
  append: (id, entry) => set(state => ({ meetings: state.meetings.map(meeting => meeting.id !== id ||
    meeting.entries.some(e => e.id === entry.id && e.speakerId === entry.speakerId && e.timestamp === entry.timestamp) ? meeting :
    { ...meeting, entries: [...meeting.entries, entry].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id) }) })),
  finish: id => set(state => ({ meetings: state.meetings.map(m => m.id === id ? { ...m, endedAt: Date.now() } : m) })),
  setSummary: (id, summary) => set(state => ({ meetings: state.meetings.map(m => m.id === id ? { ...m, summary } : m) })),
  remove: id => set(state => ({ meetings: state.meetings.filter(m => m.id !== id) })),
}))
useMeetingStore.subscribe((state, previous) => {
  if (state.meetings === previous.meetings) return
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state.meetings))
    if (state.storageError) useMeetingStore.setState({ storageError: false })
  } catch {
    if (!state.storageError) useMeetingStore.setState({ storageError: true })
  }
})
