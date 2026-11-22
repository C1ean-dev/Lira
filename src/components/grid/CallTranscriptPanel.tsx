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
    <aside id="call-transcript" aria-label="Transcrição da chamada" className="w-72 lg:w-80 max-w-full sm:max-w-[42vw] h-full min-h-0 flex flex-col shrink-0 rounded-[12px] border border-lira-quiet bg-lira-panel text-lira-ink font-mono select-text">
      <div className="flex items-center justify-between p-3 border-b border-dashed border-lira-rule/60">
        <h2 className="font-display text-base font-bold text-lira-accent flex items-center gap-2"><FileText className="w-4 h-4 text-lira-accent" />Transcrição</h2>
        <button type="button" onClick={onClose} aria-label="Fechar transcrição" title="Fechar painel (a transcrição continua)" className="p-1 rounded-[8px] text-lira-muted hover:text-lira-ink hover:bg-lira-surface transition-colors"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-3 border-b border-dashed border-lira-rule/60 space-y-2">
        <TranscriptionControls status={status} installed={installed} download={download} error={error} canStart={canStart}
          hasEntries={entries.length > 0} onStart={onStart} onStop={onStop} />
        <button type="button" onClick={() => useMeetingStore.getState().setOpen(true)} className="w-full rounded-[8px] border border-lira-rule bg-lira-surface hover:border-lira-accent hover:text-lira-accent p-2 text-xs font-mono text-lira-ink transition-colors">Ver transcrições e resumo</button>
        <p className="text-[11px] text-lira-muted">As falas são salvas neste dispositivo para gerar o resumo após a chamada.</p>
      </div>
      <div ref={log} role="log" aria-live="polite" aria-label="Falas dos participantes" onScroll={() => {
        if (log.current) follow.current = log.current.scrollHeight - log.current.scrollTop - log.current.clientHeight < 48
      }} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {!entries.length && <p className="text-xs text-lira-muted border border-dashed border-lira-rule/60 rounded-[8px] p-3 text-center">As falas aparecerão aqui, separadas por participante.</p>}
        {entries.map(entry => <div key={`${entry.timestamp}-${entry.id}-${entry.speakerId}`} className="rounded-[8px] bg-lira-surface border border-lira-quiet p-2.5">
          <div className="flex justify-between gap-2 items-baseline mb-1">
            <span className="text-xs font-semibold text-lira-accent break-words min-w-0">{entry.speakerName}</span>
            <time className="text-[10px] font-mono tabular-nums text-lira-muted shrink-0" dateTime={new Date(entry.timestamp).toISOString()}>{new Date(entry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
          </div>
          <p className="text-xs text-lira-ink whitespace-pre-wrap break-words leading-relaxed">{entry.text}</p>
        </div>)}
      </div>
    </aside>
  )
}
