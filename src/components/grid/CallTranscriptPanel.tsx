import React, { useEffect, useRef } from 'react'
import { X, FileText, Square, Loader2, Download } from 'lucide-react'
import type { TranscriptEntry, TranscriptionStatus } from '../../media/callTranscription'
import type { TranscriptionDownload } from '../../media/transcriptionModule'

interface Props {
  status: TranscriptionStatus
  entries: TranscriptEntry[]
  error?: string
  installed?: boolean
  download?: TranscriptionDownload
  onStart: () => void
  onStop: () => void
  onClose: () => void
}

export const CallTranscriptPanel: React.FC<Props> = ({ status, entries, error, installed = false, download, onStart, onStop, onClose }) => {
  const log = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [entries])
  const busy = status === 'loading' || status === 'recording' || status === 'stopping'
  const percent = download?.total ? Math.min(100, Math.round(download.loaded / download.total * 100)) : undefined
  return (
    <aside id="call-transcript" aria-label="Transcrição da chamada" className="w-72 lg:w-80 max-w-full sm:max-w-[42vw] h-full min-h-0 flex flex-col shrink-0 rounded-2xl border border-[#2a3142] bg-[#12151d] text-slate-200 select-text">
      <div className="flex items-center justify-between p-3 border-b border-[#2a3142]">
        <h2 className="text-sm font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-400" />Transcrição</h2>
        <button type="button" onClick={onClose} aria-label="Fechar transcrição" title="Fechar painel (a transcrição continua)" className="p-1 rounded-lg hover:bg-slate-700"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-3 border-b border-[#2a3142] space-y-2">
        <p className="text-[11px] text-slate-400">Áudio processado neste dispositivo, em português. Ao voltar ao mapa ou mudar de sala, a transcrição é encerrada.</p>
        {!installed && <p className="text-xs leading-relaxed text-slate-300">Para usar a transcrição, é preciso baixar o módulo de reconhecimento e o modelo de voz. O download é feito uma vez e fica salvo neste dispositivo.</p>}
        <button type="button" disabled={status === 'stopping'} onClick={busy ? onStop : onStart}
          className="w-full flex justify-center items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 text-indigo-200 px-3 py-2 text-xs font-semibold hover:bg-indigo-500/25 disabled:opacity-50">
          {(status === 'loading' || status === 'stopping') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : busy ? <Square className="w-3.5 h-3.5" /> : !installed ? <Download className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
          {status === 'loading' ? 'Cancelar' : status === 'recording' ? 'Parar transcrição' : status === 'stopping' ? 'Finalizando falas…' : status === 'error' ? 'Tentar novamente' : !installed ? 'Baixar e iniciar transcrição' : entries.length ? 'Continuar transcrição' : 'Iniciar transcrição'}
        </button>
        <p role="status" className="text-[11px] text-slate-400">{status === 'loading' ? download?.phase === 'dependencies' ? `Baixando módulo de transcrição… ${percent ?? 0}%` : download?.phase === 'model' ? `Preparando modelo de voz…${percent === undefined ? '' : ` ${percent}%`}` : 'Carregando transcrição…' : status === 'recording' ? 'Transcrevendo participantes… As falas aparecem em alguns segundos.' : status === 'stopping' ? 'Processando as últimas falas…' : 'Transcrição parada'}</p>
        {status === 'loading' && Boolean(download?.total) && <progress aria-label={download!.phase === 'dependencies' ? 'Download do módulo de transcrição' : 'Download do arquivo do modelo de voz'} value={download!.loaded} max={download!.total} className="w-full h-1.5 appearance-none overflow-hidden rounded-full bg-slate-800 [&::-webkit-progress-bar]:bg-slate-800 [&::-webkit-progress-value]:bg-indigo-400 [&::-moz-progress-bar]:bg-indigo-400" />}
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
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
