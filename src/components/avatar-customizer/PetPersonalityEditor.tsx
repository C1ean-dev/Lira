import React, { useState } from 'react'
import type { PetConfig } from '../../types/game'
import { getPetPersonality, savePetPersonality } from '../../services/petPersonalities'

export const PetPersonalityEditor: React.FC<{ pet: PetConfig; onSave?(value: string): void }> = ({ pet, onSave }) => {
  const [value, setValue] = useState(() => getPetPersonality(pet))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  return <div className="w-full flex flex-col gap-2 pt-2">
    <label className="text-xs font-bold text-slate-300" htmlFor="pet-personality">Personalidade do pet</label>
    <textarea id="pet-personality" value={value} maxLength={2000} rows={3}
      onChange={event => { setValue(event.target.value); setSaved(false); setError(false) }}
      placeholder="Descreva como este pet deve falar e se comportar"
      className="w-full bg-[#1e1f22] border border-[#383a40] rounded-xl px-3 py-2 text-xs text-white" />
    <p className="text-[10px] text-slate-400">A personalidade do pet é compartilhada com a sala para gerar respostas.</p>
    <button type="button" onClick={() => { const ok = savePetPersonality(pet, value); if (ok) onSave?.(value); setSaved(ok); setError(!ok) }}
      className="self-start px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs">Salvar personalidade</button>
    {saved && <span className="text-xs text-emerald-300">Personalidade salva. Salve o perfil para aplicá-la na sala.</span>}
    {error && <span role="alert" className="text-xs text-rose-300">Não foi possível salvar a personalidade neste dispositivo.</span>}
  </div>
}
