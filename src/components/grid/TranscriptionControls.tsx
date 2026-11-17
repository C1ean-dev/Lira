import React from 'react'
import { Download, FileText, Loader2, Square } from 'lucide-react'
import type { TranscriptionStatus } from '../../media/callTranscription'
import type { TranscriptionDownload } from '../../media/transcriptionModule'

interface Props {
  status: TranscriptionStatus
  installed?: boolean
  download?: TranscriptionDownload
  error?: string
  hasEntries: boolean
  canStart?: boolean
  onStart(): void
  onStop(): void
}

export const TranscriptionControls: React.FC<Props> = ({ status, installed = false, download, error, hasEntries, canStart = true, onStart, onStop }) => {
  const busy = status === 'loading' || status === 'recording' || status === 'stopping'
  const percent = download?.total ? Math.min(100, Math.round(download.loaded / download.total * 100)) : undefined
  return <div className="space-y-2">
    <p className="text-xs leading-relaxed text-slate-400">Áudio processado neste dispositivo, em português. A transcrição continua no mapa 2D e ao fechar este painel. Ela é encerrada ao mudar de sala ou sair do espaço.</p>
    {!canStart && !busy && <p className="text-xs text-amber-300">Entre em uma sala no mapa 2D para iniciar a transcrição.</p>}
    {!installed && <p className="text-xs leading-relaxed text-slate-300">Para usar a transcrição, é preciso baixar o módulo de reconhecimento e o modelo de voz. O download é feito uma vez e fica salvo neste dispositivo.</p>}
    <button type="button" disabled={status === 'stopping' || (!canStart && !busy)} onClick={busy ? onStop : onStart}
      className="min-h-11 w-full flex justify-center items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 text-indigo-200 px-3 py-2 text-xs font-semibold hover:bg-indigo-500/25 disabled:opacity-50">
      {(status === 'loading' || status === 'stopping') ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : busy ? <Square className="w-3.5 h-3.5" /> : !installed ? <Download className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
      {status === 'loading' ? 'Cancelar' : status === 'recording' ? 'Parar transcrição' : status === 'stopping' ? 'Finalizando falas…' : status === 'error' ? 'Tentar novamente' : !installed ? 'Baixar e iniciar transcrição' : hasEntries ? 'Iniciar nova transcrição' : 'Iniciar transcrição'}
    </button>
    <p role="status" className="text-xs text-slate-400">{status === 'loading' ? download?.phase === 'dependencies' ? `Baixando módulo de transcrição… ${percent ?? 0}%` : download?.phase === 'model' ? `Preparando modelo de voz…${percent === undefined ? '' : ` ${percent}%`}` : 'Carregando transcrição…' : status === 'recording' ? 'Transcrevendo participantes… As falas aparecem em alguns segundos.' : status === 'stopping' ? 'Processando as últimas falas…' : 'Transcrição parada'}</p>
    {status === 'loading' && Boolean(download?.total) && <progress aria-label={download!.phase === 'dependencies' ? 'Download do módulo de transcrição' : 'Download do arquivo do modelo de voz'} value={download!.loaded} max={download!.total} className="w-full h-1.5 appearance-none overflow-hidden rounded-full bg-slate-800 [&::-webkit-progress-bar]:bg-slate-800 [&::-webkit-progress-value]:bg-indigo-400 [&::-moz-progress-bar]:bg-indigo-400" />}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
  </div>
}
