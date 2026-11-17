import React, { useEffect, useRef, useState } from 'react'
import { X, FileText, Download, Sparkles, Trash2 } from 'lucide-react'
import { useMeetingStore } from '../../store/useMeetingStore'
import { generateMeetingSummary, meetingMarkdown } from '../../services/meetingSummary'
import { getRoomPetApiKey } from '../../services/petApiKey'
import { downloadText } from './downloadText'
import { useSpaceTranscription } from '../../hooks/useSpaceTranscription'
import { TranscriptionControls } from '../grid/TranscriptionControls'

export const MeetingSummaryPanel: React.FC = () => {
  const { meetings, isOpen, setOpen, setSummary, remove, storageError } = useMeetingStore()
  const transcription = useSpaceTranscription()
  const [selected, setSelected] = useState<string>()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const meeting = meetings.find(m => m.id === selected) || meetings[0]
  useEffect(() => { if (isOpen) dialog.current?.showModal() }, [isOpen])
  if (!isOpen) return null
  const generate = async () => {
    if (!meeting || busy || !meeting.endedAt) return
    const id = meeting.id
    setBusy(id); setError('')
    try { setSummary(id, await generateMeetingSummary(key || getRoomPetApiKey(meeting.roomId), meeting.entries)) }
    catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível gerar o resumo.') }
    finally { setBusy(undefined) }
  }
  return <dialog ref={dialog} onCancel={() => setOpen(false)} aria-labelledby="meeting-history-title" className="m-auto w-[min(920px,96vw)] max-h-[90vh] overflow-auto rounded-2xl border border-slate-700 bg-[#12151d] p-5 text-slate-100 backdrop:bg-black/70 select-text">
    <header className="flex items-center justify-between gap-3 mb-4">
      <h2 id="meeting-history-title" className="font-semibold flex gap-2 items-center"><FileText size={18} />Transcrições e resumo</h2>
      <button type="button" aria-label="Fechar transcrições e resumo" onClick={() => setOpen(false)} className="-my-2 -mr-2 rounded-lg p-3 text-slate-400 hover:bg-slate-800 hover:text-slate-100"><X size={20} /></button>
    </header>
    {transcription ? <section aria-label="Transcrição da sala atual" className="mb-5 space-y-3 border-b border-slate-700 pb-5">
      <h3 className="text-sm font-semibold">{transcription.canStart ? `Sala atual: ${transcription.zoneName}` : 'Transcrição no mapa 2D'}</h3>
      <TranscriptionControls {...transcription} hasEntries={transcription.entries.length > 0}
        onStart={() => { setSelected(undefined); transcription.start() }} onStop={transcription.stop} />
    </section> : <p className="mb-4 text-xs text-slate-400">Para iniciar uma transcrição, entre em um espaço e abra este painel pelo mapa 2D.</p>}
    {storageError && <p role="alert" className="mb-3 text-xs text-amber-300">Não foi possível salvar no dispositivo. Exporte a reunião antes de fechar o Lira para preservar suas falas e o resumo.</p>}
    <h3 className="mb-3 text-sm font-semibold">Transcrições e resumos salvos</h3>
    {!meetings.length ? <p className="text-sm text-slate-400">As falas ficam salvas neste dispositivo. Ao finalizar a transcrição, você pode gerar o resumo aqui.</p> : <div className="grid md:grid-cols-[200px_1fr] gap-4">
      <nav aria-label="Reuniões salvas" className="space-y-2 max-h-60 md:max-h-[65vh] overflow-auto">
        {meetings.map(m => <button type="button" key={m.id} onClick={() => { setSelected(m.id); setError('') }} aria-current={meeting?.id === m.id ? 'true' : undefined} className={`w-full rounded-xl p-3 text-left text-xs ${meeting?.id === m.id ? 'bg-indigo-600/30 border border-indigo-400' : 'bg-slate-800'}`}>
          <strong className="block break-words">{m.title}</strong>{new Date(m.startedAt).toLocaleString('pt-BR')}<span className="block text-slate-400">{m.endedAt ? `${m.entries.length} falas` : 'Transcrição em andamento'}</span>
        </button>)}
      </nav>
      {meeting && <section className="min-w-0 space-y-3">
        <h3 className="font-semibold break-words">{meeting.title}</h3>
        {meeting.endedAt && <><p className="text-xs text-slate-400">A transcrição Whisper fica neste dispositivo. Ao gerar o resumo, o texto será enviado à OpenRouter e ao provedor de IA. A chave fica apenas na memória.</p>
        <label className="block text-xs">Chave OpenRouter
          <input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" placeholder="Chave pessoal ou chave da sala já configurada" className="mt-1 w-full rounded-lg bg-slate-800 border border-slate-600 p-2" />
        </label></>}
        <div className="flex flex-wrap gap-2 text-xs">
          <button type="button" disabled={!!busy || !meeting.endedAt || !meeting.entries.length} onClick={() => void generate()} className="flex gap-2 items-center rounded-lg bg-indigo-600 px-3 py-2 disabled:opacity-40"><Sparkles size={14} />{busy === meeting.id ? 'Gerando resumo…' : 'Gerar resumo com IA'}</button>
          <button type="button" onClick={() => downloadText(`reuniao-${meeting.id}.md`, meetingMarkdown(meeting))} className="flex gap-2 items-center rounded-lg bg-slate-700 px-3 py-2"><Download size={14} />Exportar</button>
          <button type="button" disabled={!!busy || !meeting.endedAt} onClick={() => remove(meeting.id)} aria-label="Excluir reunião deste dispositivo" className="rounded-lg bg-slate-800 p-2 disabled:opacity-40"><Trash2 size={14} /></button>
        </div>
        {!meeting.endedAt && <p role="status" className="text-xs text-amber-300">Finalize a transcrição para gerar o resumo com todas as falas.</p>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        {meeting.endedAt && <div className="max-h-[35vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-800 p-4 text-sm">{meeting.summary || 'O resumo da reunião aparecerá aqui.'}</div>}
        <details open={!meeting.endedAt} className="text-xs"><summary className="cursor-pointer">Ver transcrição ({meeting.entries.length} falas)</summary><div className="max-h-60 overflow-auto space-y-2 p-2">{meeting.entries.map(e => <p key={`${e.timestamp}-${e.id}-${e.speakerId}`}><strong>{e.speakerName}:</strong> {e.text}</p>)}</div></details>
      </section>}
    </div>}
  </dialog>
}
