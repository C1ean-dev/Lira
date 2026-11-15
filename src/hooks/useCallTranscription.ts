import { useEffect, useRef, useState } from 'react'
import type { TranscriptEntry, TranscriptionSource, TranscriptionStatus } from '../media/callTranscription'
import { MeetingRecorder } from '../media/meetingRecorder'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { isTranscriptionInstalled, type TranscriptionDownload } from '../media/transcriptionModule'

export function useCallTranscription(sources: TranscriptionSource[], zoneId: string | null | undefined) {
  const roomId = useGameStore(s => s.roomId)
  const [status, setStatus] = useState<TranscriptionStatus>('idle')
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [error, setError] = useState<string>()
  const [installed, setInstalled] = useState(false)
  const [download, setDownload] = useState<TranscriptionDownload>()
  const session = useRef<MeetingRecorder | null>(null)
  const currentSources = useRef(sources)
  currentSources.current = sources

  useEffect(() => {
    let cancelled = false
    void isTranscriptionInstalled().then(ready => { if (!cancelled) setInstalled(ready) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setStatus('idle'); setEntries([]); setError(undefined); setDownload(undefined)
    return () => {
      const previous = session.current
      session.current = null
      previous?.detach()
    }
  }, [zoneId, roomId])

  useEffect(() => { session.current?.sync(sources) }, [sources])

  const start = () => {
    session.current?.detach()
    setEntries([])
    setError(undefined)
    setDownload(undefined)
    try {
      const worker = new Worker(new URL('../media/transcription.worker.ts', import.meta.url), { type: 'module' })
      const title = useMapStore.getState().mapData.zones.find(zone => zone.id === zoneId)?.name || 'Reunião'
      const next = new MeetingRecorder(worker, { roomId: roomId || '', zoneId: zoneId || '', title }, {
        onStatus: (nextStatus, message) => {
          if (session.current !== next) return
          setStatus(nextStatus); setError(message)
          if (nextStatus === 'recording') { setInstalled(true); setDownload(undefined) }
        },
        onEntry: entry => { if (session.current === next) setEntries(previous => [...previous, entry].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)) },
        onReady: () => next.sync(currentSources.current),
        onDownload: progress => { if (session.current === next) setDownload(progress) },
      })
      session.current = next
      void next.start()
    } catch {
      setStatus('error'); setError('Não foi possível iniciar a transcrição neste dispositivo.')
    }
  }

  return { status, entries, error, installed, download, start, stop: () => session.current?.stop() }
}
