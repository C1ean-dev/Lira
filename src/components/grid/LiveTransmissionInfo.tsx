import React, { useEffect, useId, useRef, useState } from 'react'
import { Info, Settings2, X } from 'lucide-react'
import { useLiveTransmissionStats } from '../../hooks/useLiveTransmissionStats'
import { useGameStore } from '../../store/useGameStore'

interface Props {
  stream: MediaStream | null
  local: boolean
  peerName: string
  onOpenSettings?: () => void
}

const measure = (value: number | null, unit: string, decimals = 1) =>
  value === null ? '—' : `${Number(value.toFixed(decimals))} ${unit}`
const limits: Record<string, string> = { none: 'Nenhuma', cpu: 'Processamento', bandwidth: 'Rede', other: 'Outro' }

export function LiveTransmissionInfo({ stream, local, peerName, onOpenSettings }: Props) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const stats = useLiveTransmissionStats(open, stream, local)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
    }
  }, [open])
  return <div ref={root} className="relative pointer-events-auto" onClick={event => event.stopPropagation()}>
    <button ref={trigger} type="button" aria-label="Informações da transmissão" title="Informações da transmissão"
      aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}
      className="w-7 h-7 rounded-full bg-black/70 text-slate-200 hover:bg-slate-700 hover:text-white flex items-center justify-center border border-white/20 shadow transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
      <Info className="w-4 h-4" aria-hidden="true" />
    </button>
    {open && <section id={id} aria-label="Estatísticas da transmissão"
      className="absolute top-9 left-0 w-72 max-w-[calc(100vw-3rem)] max-h-[60vh] overflow-y-auto rounded-2xl border border-slate-700 bg-[#12151d]/95 backdrop-blur-md text-slate-200 shadow-2xl p-3 text-xs">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold">Estatísticas da transmissão</h3>
        <button type="button" aria-label="Fechar estatísticas" onClick={() => { setOpen(false); trigger.current?.focus() }}
          className="p-1 rounded hover:bg-slate-700"><X className="w-3.5 h-3.5" /></button>
      </div>
      {!stats.length && <p role="status" className="text-slate-400 py-2">{local ? 'Aguardando dados de envio aos participantes...' : 'Aguardando dados de reprodução...'}</p>}
      {stats.map(row => <div key={row.id} className="border-t border-slate-700/70 pt-2 mt-2">
        <p className="font-semibold text-slate-300 mb-2 truncate">{local ? `Envio para ${useGameStore.getState().remotePlayers[row.peerId]?.name || 'participante'}` : `Recebido de ${peerName}`}</p>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 [&>dd]:text-right [&>dd]:font-mono [&>dt]:text-slate-400">
          <dt>Resolução</dt><dd>{row.width && row.height ? `${row.width} × ${row.height}` : '—'}</dd>
          <dt>FPS</dt><dd>{measure(row.fps, 'FPS')}</dd>
          <dt>{local ? 'Bitrate enviado' : 'Bitrate recebido'}</dt><dd>{row.bitrateKbps === null ? '—' : row.bitrateKbps >= 1000 ? measure(row.bitrateKbps / 1000, 'Mbps', 2) : measure(row.bitrateKbps, 'kbps', 0)}</dd>
          <dt>{local ? 'Dados enviados' : 'Dados recebidos'}</dt><dd>{measure(row.bytes === null ? null : row.bytes / 1048576, 'MB', 2)}</dd>
          <dt title={local ? 'Tempo médio dos pacotes na fila de envio no último intervalo' : 'Tempo médio dos quadros no buffer de reprodução no último intervalo'}>{local ? 'Fila de envio' : 'Buffer de reprodução'}</dt><dd>{measure(row.bufferMs, 'ms')}</dd>
          <dt>Latência (RTT)</dt><dd>{measure(row.rttMs, 'ms', 0)}</dd>
          <dt>Jitter</dt><dd>{measure(row.jitterMs, 'ms')}</dd>
          <dt>Perda de pacotes</dt><dd>{measure(row.lossPct, '%')}</dd>
          {!local && <><dt>Quadros descartados</dt><dd>{row.droppedFrames ?? '—'}</dd></>}
          <dt>Codec</dt><dd>{row.codec || '—'}</dd>
          {local && <><dt>Limitação de qualidade</dt><dd>{row.limitation ? limits[row.limitation] || row.limitation : '—'}</dd></>}
        </dl>
      </div>)}
      <p className="text-[10px] text-slate-500 mt-3">Atualiza a cada segundo. — indica dado ainda indisponível.</p>
      {local && onOpenSettings && <button type="button" onClick={() => { setOpen(false); onOpenSettings() }}
        className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-slate-700 hover:bg-slate-600 py-2 font-medium">
        <Settings2 className="w-3.5 h-3.5" />Resolução e FPS
      </button>}
    </section>}
  </div>
}
