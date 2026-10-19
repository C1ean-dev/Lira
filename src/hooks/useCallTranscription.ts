import { useEffect, useRef, useState } from 'react'
import { CallTranscription, type TranscriptEntry, type TranscriptionSource, type TranscriptionStatus } from '../media/callTranscription'
import { isTranscriptionInstalled, type TranscriptionDownload } from '../media/transcriptionModule'

export function useCallTranscription(sources: TranscriptionSource[], zoneId: string | null | undefined) {
  const [status, setStatus] = useState<TranscriptionStatus>('idle')
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [error, setError] = useState<string>()
  const [installed, setInstalled] = useState(false)
  const [download, setDownload] = useState<TranscriptionDownload>()
  const session = useRef<CallTranscription | null>(null)
  const currentSources = useRef(sources)
  currentSources.current = sources

  useEffect(() => {
    let cancelled = false
    void isTranscriptionInstalled().then(ready => { if (!cancelled) setInstalled(ready) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setStatus('idle'); setEntries([]); setError(undefined); setDownload(undefined)
    return () => { session.current?.dispose(); session.current = null }
  }, [zoneId])

  useEffect(() => { session.current?.sync(sources) }, [sources])

  const start = () => {
    session.current?.dispose()
    setError(undefined)
    setDownload(undefined)
    try {
      const worker = new Worker(new URL('../media/transcription.worker.ts', import.meta.url), { type: 'module' })
      const next = new CallTranscription(worker,
        (nextStatus, message) => {
          setStatus(nextStatus); setError(message)
          if (nextStatus === 'recording') { setInstalled(true); setDownload(undefined) }
        },
        entry => setEntries(previous => [...previous, entry].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)),
        () => next.sync(currentSources.current),
        setDownload,
      )
      session.current = next
      void next.start()
    } catch {
      setStatus('error'); setError('Não foi possível iniciar a transcrição neste dispositivo.')
    }
  }

  return { status, entries, error, installed, download, start, stop: () => session.current?.stop() }
}
