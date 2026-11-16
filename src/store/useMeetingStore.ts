import { z } from 'zod'
import { createStoredState } from './persistedState'
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
const meetingSchema = z.object({ id: z.string(), roomId: z.string(), zoneId: z.string(), title: z.string(),
  startedAt: z.number().finite(), endedAt: z.number().finite().optional(), entries: z.array(z.object({ id: z.number().finite(), speakerId: z.string(), speakerName: z.string(), text: z.string(), timestamp: z.number().finite() }).passthrough()), summary: z.string().optional(),
}).passthrough() as z.ZodType<Meeting>
const history = createStoredState(KEY, z.array(meetingSchema), [], {
  onWrite: error => { if (useMeetingStore.getState().storageError !== !!error) useMeetingStore.setState({ storageError: !!error }) },
})
function load(): Meeting[] {
  return history.getState().slice(0, 20).map(m => ({ ...m, endedAt: m.endedAt || Date.now() }))
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
  history.setState(state.meetings, true)
})
