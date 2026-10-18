import { useEffect, useRef, useState } from 'react'
import { CallTranscription, type TranscriptEntry, type TranscriptionSource, type TranscriptionStatus } from '../media/callTranscription'

export function useCallTranscription(sources: TranscriptionSource[], zoneId: string | null | undefined) {
  const [status, setStatus] = useState<TranscriptionStatus>('idle')
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [error, setError] = useState<string>()
  const session = useRef<CallTranscription | null>(null)
  const currentSources = useRef(sources)
  currentSources.current = sources

  useEffect(() => {
    setStatus('idle'); setEntries([]); setError(undefined)
    return () => { session.current?.dispose(); session.current = null }
  }, [zoneId])

  useEffect(() => { session.current?.sync(sources) }, [sources])

  const start = () => {
    session.current?.dispose()
    setError(undefined)
    try {
      const worker = new Worker(new URL('../media/transcription.worker.ts', import.meta.url), { type: 'module' })
      const next = new CallTranscription(worker,
        (nextStatus, message) => { setStatus(nextStatus); setError(message) },
        entry => setEntries(previous => [...previous, entry].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)),
        () => next.sync(currentSources.current),
      )
      session.current = next
      void next.start()
    } catch {
      setStatus('error'); setError('Não foi possível iniciar a transcrição neste dispositivo.')
    }
  }

  return { status, entries, error, start, stop: () => session.current?.stop() }
}
