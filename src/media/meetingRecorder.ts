import { CallTranscription, type TranscriptEntry, type TranscriptionSource, type TranscriptionStatus } from './callTranscription'
import type { TranscriptionDownload } from './transcriptionModule'
import { useMeetingStore } from '../store/useMeetingStore'

interface Callbacks {
  onStatus(status: TranscriptionStatus, message?: string): void
  onEntry(entry: TranscriptEntry): void
  onReady(): void
  onDownload?(progress: TranscriptionDownload): void
}
export class MeetingRecorder {
  readonly id: string
  private capture: CallTranscription
  private detached = false
  private finished = false
  private deadline?: ReturnType<typeof setTimeout>
  constructor(worker: Worker, details: { roomId: string; zoneId: string; title: string }, callbacks: Callbacks) {
    this.id = useMeetingStore.getState().begin(details.roomId, details.zoneId, details.title)
    this.capture = new CallTranscription(worker, (status, message) => {
      if (status === 'idle' || status === 'error') {
        this.finished = true
        clearTimeout(this.deadline)
        useMeetingStore.getState().finish(this.id)
      }
      if (!this.detached) callbacks.onStatus(status, message)
    }, entry => {
      useMeetingStore.getState().append(this.id, entry)
      if (!this.detached) callbacks.onEntry(entry)
    }, () => { if (!this.detached) callbacks.onReady() }, progress => { if (!this.detached) callbacks.onDownload?.(progress) })
  }
  start() { return this.capture.start() }
  sync(sources: TranscriptionSource[]) { this.capture.sync(sources) }
  stop() { this.capture.stop() }
  detach() {
    this.detached = true
    if (this.finished) return
    this.capture.stop()
    if (!this.finished) this.deadline = setTimeout(() => { this.capture.dispose(); useMeetingStore.getState().finish(this.id) }, 60000)
  }
}
