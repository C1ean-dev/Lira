import React, { useState } from 'react'
import { getRoomPetApiKey, setRoomPetApiKey } from '../../services/petApiKey'

export const PetApiSettings: React.FC<{ roomId: string; initiallyOpen?: boolean }> = ({ roomId, initiallyOpen = false }) => {
  const [open, setOpen] = useState(initiallyOpen)
  const [key, setKey] = useState(() => getRoomPetApiKey(roomId))
  return <>
    <button type="button" onClick={() => { setKey(getRoomPetApiKey(roomId)); setOpen(true) }} title="Configurar OpenRouter para o pet"
      className="px-2 py-1 rounded-[6px] bg-lira-surface text-lira-ink text-xs font-mono border border-lira-rule hover:border-lira-accent">🐾 Pet IA</button>
    {open && <div className="fixed inset-0 z-[150] flex items-center justify-center bg-lira-ground/80 font-mono text-lira-ink" role="dialog" aria-modal="true" aria-label="Configurar OpenRouter">
      <form className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] p-5 w-[min(90vw,400px)] flex flex-col gap-3" onSubmit={event => { event.preventDefault(); setRoomPetApiKey(roomId, key); setOpen(false) }}>
        <label htmlFor="pet-api-key" className="text-sm font-display font-bold text-lira-accent">Chave OpenRouter</label>
        <input id="pet-api-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} className="bg-lira-ground border border-lira-rule focus:border-lira-accent text-lira-ink font-mono text-xs rounded-[8px] p-2 outline-none" />
        <p className="text-xs font-mono text-lira-muted">A chave fica somente neste dispositivo até o aplicativo fechar e será usada para todos os pets da sala. As perguntas e personalidades são enviadas à OpenRouter, usando um modelo gratuito.</p>
        <div className="flex gap-2 pt-2 border-t border-dashed border-lira-rule/60"><button type="submit" className="bg-lira-accent hover:bg-lira-ink rounded-[8px] px-3 py-2 text-lira-ground font-mono font-bold text-xs">Salvar chave</button><button type="button" onClick={() => setOpen(false)} className="text-lira-muted hover:text-lira-ink font-mono text-xs px-2">Cancelar</button></div>
      </form>
    </div>}
  </>
}
