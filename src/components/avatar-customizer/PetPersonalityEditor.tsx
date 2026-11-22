import React, { useState } from 'react'
import type { PetConfig } from '../../types/game'
import { getPetPersonality, savePetPersonality } from '../../services/petPersonalities'

export const PetPersonalityEditor: React.FC<{ pet: PetConfig; onSave?(value: string): void }> = ({ pet, onSave }) => {
  const [value, setValue] = useState(() => getPetPersonality(pet))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(false)
  return <div className="w-full flex flex-col gap-2 pt-2 font-mono">
    <label className="text-xs font-mono font-bold text-lira-ink" htmlFor="pet-personality">Personalidade do pet</label>
    <textarea id="pet-personality" value={value} maxLength={2000} rows={3}
      onChange={event => { setValue(event.target.value); setSaved(false); setError(false) }}
      placeholder="Descreva como este pet deve falar e se comportar"
      className="w-full bg-lira-ground border border-lira-rule rounded-[8px] px-3 py-2 text-xs font-mono text-lira-ink focus:outline-none focus:border-lira-accent" />
    <p className="text-[10px] font-mono text-lira-muted">A personalidade do pet é compartilhada com a sala para gerar respostas.</p>
    <button type="button" onClick={() => { const ok = savePetPersonality(pet, value); if (ok) onSave?.(value); setSaved(ok); setError(!ok) }}
      className="self-start px-3 py-1 rounded-[6px] bg-lira-accent hover:bg-lira-ink text-lira-ground font-mono font-bold text-xs">Salvar personalidade</button>
    {saved && <span className="text-xs font-mono text-lira-online">Personalidade salva. Salve o perfil para aplicá-la na sala.</span>}
    {error && <span role="alert" className="text-xs font-mono text-lira-error">Não foi possível salvar a personalidade neste dispositivo.</span>}
  </div>
}
