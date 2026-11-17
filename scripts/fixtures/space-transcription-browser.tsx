import React from 'react'
import { createRoot } from 'react-dom/client'
import { SpaceTranscriptionProvider } from '../../src/components/collaboration/SpaceTranscriptionProvider'
import { CollaborationButtons } from '../../src/components/collaboration/CollaborationButtons'
import { MeetingSummaryPanel } from '../../src/components/collaboration/MeetingSummaryPanel'
import { FullScreenGrid } from '../../src/components/FullScreenGrid'
import { useGameStore } from '../../src/store/useGameStore'
import { useMediaStore } from '../../src/store/useMediaStore'
import { useMapStore } from '../../src/store/useMapStore'
import { useMeetingStore } from '../../src/store/useMeetingStore'
import '../../src/index.css'

// Recognition is the only simulated boundary: no microphone, model download or AI request.
const workers: RecognitionWorker[] = []
class RecognitionWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  messages: { type: string }[] = []
  terminated = false
  constructor() { workers.push(this) }
  postMessage(message: { type: string }) {
    this.messages.push(message)
    queueMicrotask(() => {
      if (this.terminated) return
      if (message.type === 'load') {
        this.onmessage?.({ data: { type: 'ready' } })
        this.onmessage?.({ data: { type: 'result', entry: { id: 1, speakerId: 'local', speakerName: 'Ana', text: 'Decisão registrada no mapa.', timestamp: Date.now() } } })
      }
      if (message.type === 'stop') this.onmessage?.({ data: { type: 'stopped' } })
    })
  }
  terminate() { this.terminated = true }
}
Object.assign(window, { Worker: RecognitionWorker, transcriptionTesting: {
  workers, meetings: useMeetingStore, setGridOpen: useMediaStore.getState().setGridCallOpen,
} })
const game = useGameStore.getState(), map = useMapStore.getState().mapData
useGameStore.setState({ roomId: 'transcription-browser-test', isConnected: true, isOwner: false, remotePlayers: {},
  localPlayer: { ...game.localPlayer, id: 'local', name: 'Ana', currentZoneId: 'review-zone' },
})
useMapStore.setState({ mapData: { ...map, zones: [{ id: 'review-zone', name: 'Reunião de produto', color: '#6366f1', x: 0, y: 0, width: 5, height: 5 }] } })
useMediaStore.setState({ isGridCallOpen: false, localStream: null, peerStreams: {}, peerVoiceStreams: {}, peerScreenStreams: {} })
createRoot(document.getElementById('root')!).render(<SpaceTranscriptionProvider>
  <header className="flex h-14 items-center justify-between border-b border-slate-700 bg-[#12151d] px-4 text-slate-200">
    <span className="text-sm font-semibold">Lira · Mapa 2D</span><CollaborationButtons />
  </header>
  <main className="flex-1 bg-[#1b202c] p-5 text-sm text-slate-400" aria-label="Mapa 2D">Sala: Reunião de produto</main>
  <MeetingSummaryPanel /><FullScreenGrid />
</SpaceTranscriptionProvider>)
