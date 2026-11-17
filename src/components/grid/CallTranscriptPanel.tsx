import { useMeetingStore } from '../../store/useMeetingStore'
import React, { useEffect, useRef } from 'react'
import { X, FileText } from 'lucide-react'
import type { TranscriptEntry, TranscriptionStatus } from '../../media/callTranscription'
import type { TranscriptionDownload } from '../../media/transcriptionModule'
import { TranscriptionControls } from './TranscriptionControls'

interface Props {
  status: TranscriptionStatus
  entries: TranscriptEntry[]
  error?: string
  installed?: boolean
  download?: TranscriptionDownload
  canStart?: boolean
  onStart: () => void
  onStop: () => void
  onClose: () => void
}

export const CallTranscriptPanel: React.FC<Props> = ({ status, entries, error, installed = false, download, canStart = true, onStart, onStop, onClose }) => {
  const log = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [entries])
  return (
    <aside id="call-transcript" aria-label="Transcrição da chamada" className="w-72 lg:w-80 max-w-full sm:max-w-[42vw] h-full min-h-0 flex flex-col shrink-0 rounded-2xl border border-[#2a3142] bg-[#12151d] text-slate-200 select-text">
      <div className="flex items-center justify-between p-3 border-b border-[#2a3142]">
        <h2 className="text-sm font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-400" />Transcrição</h2>
        <button type="button" onClick={onClose} aria-label="Fechar transcrição" title="Fechar painel (a transcrição continua)" className="p-1 rounded-lg hover:bg-slate-700"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-3 border-b border-[#2a3142] space-y-2">
        <TranscriptionControls status={status} installed={installed} download={download} error={error} canStart={canStart}
          hasEntries={entries.length > 0} onStart={onStart} onStop={onStop} />
        <button type="button" onClick={() => useMeetingStore.getState().setOpen(true)} className="w-full rounded-lg bg-slate-800 p-2 text-xs text-indigo-200">Ver transcrições e resumo</button>
        <p className="text-[11px] text-slate-400">As falas são salvas neste dispositivo para gerar o resumo após a chamada.</p>
      </div>
      <div ref={log} role="log" aria-live="polite" aria-label="Falas dos participantes" onScroll={() => {
        if (log.current) follow.current = log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 48
      }} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {!entries.length && <p className="text-xs text-slate-500">As falas aparecerão aqui, separadas por participante.</p>}
        {entries.map(entry => <div key={`${entry.timestamp}-${entry.id}-${entry.speakerId}`} className="rounded-xl bg-slate-800/60 p-2.5">
          <div className="flex justify-between gap-2 items-baseline mb-1">
            <span className="text-xs font-semibold text-indigo-300 break-words min-w-0">{entry.speakerName}</span>
            <time className="text-[10px] text-slate-500 shrink-0" dateTime={new Date(entry.timestamp).toISOString()}>{new Date(entry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
          </div>
          <p className="text-xs text-slate-200 whitespace-pre-wrap break-words leading-relaxed">{entry.text}</p>
        </div>)}
      </div>
    </aside>
  )
}
