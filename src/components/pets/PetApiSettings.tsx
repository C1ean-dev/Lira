import React, { useState } from 'react'
import { getRoomPetApiKey, setRoomPetApiKey } from '../../services/petApiKey'

export const PetApiSettings: React.FC<{ roomId: string; initiallyOpen?: boolean }> = ({ roomId, initiallyOpen = false }) => {
  const [open, setOpen] = useState(initiallyOpen)
  const [key, setKey] = useState(() => getRoomPetApiKey(roomId))
  return <>
    <button type="button" onClick={() => { setKey(getRoomPetApiKey(roomId)); setOpen(true) }} title="Configurar OpenRouter para o pet"
      className="px-2 py-1 rounded-lg bg-slate-800 text-slate-200 text-xs border border-slate-700">🐾 Pet IA</button>
    {open && <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70" role="dialog" aria-modal="true" aria-label="Configurar OpenRouter">
      <form className="bg-[#1e1f22] rounded-2xl p-5 w-[min(90vw,400px)] flex flex-col gap-3" onSubmit={event => { event.preventDefault(); setRoomPetApiKey(roomId, key); setOpen(false) }}>
        <label htmlFor="pet-api-key" className="text-sm font-bold text-white">Chave OpenRouter</label>
        <input id="pet-api-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} className="bg-slate-900 text-white rounded-lg p-2" />
        <p className="text-xs text-slate-300">A chave fica somente neste dispositivo até o aplicativo fechar e será usada para todos os pets da sala. As perguntas e personalidades são enviadas à OpenRouter, usando um modelo gratuito.</p>
        <div className="flex gap-2"><button type="submit" className="bg-indigo-600 rounded-lg px-3 py-2 text-white text-xs">Salvar chave</button><button type="button" onClick={() => setOpen(false)} className="text-slate-300 text-xs">Cancelar</button></div>
      </form>
    </div>}
  </>
}
